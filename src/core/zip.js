/** @typedef {Uint8Array<ArrayBuffer>} Bytes */
/** @typedef {{ name: string, data: Bytes[], crc: number, size: number, compressedSize: number }} ZipEntry */

const GZIP_TRAILER = 8;
const FHCRC = 2;
const FEXTRA = 4;
const FNAME = 8;
const FCOMMENT = 16;
const DEFLATE = 8;
const VERSION = 20;
const DOS_DATE = (1 << 5) | 1;
/** 0xFFFFFFFF itself tells readers to look for Zip64 fields, so it is out of range too. */
const ZIP32_LIMIT = 0xffffffff;
const LOCAL_HEADER = 30;
const CENTRAL_HEADER = 46;
const END_OF_DIRECTORY = 22;

/**
 * @param {string} name
 * @param {AsyncIterable<Bytes> | Iterable<Bytes>} chunks
 * @returns {Promise<ZipEntry>}
 */
export async function deflateEntry(name, chunks) {
  const gzip = new CompressionStream('gzip');
  const writer = gzip.writable.getWriter();
  const output = drain(gzip.readable);
  let size = 0;
  // writer.ready cannot bound this: Node's CompressionStream accepts 16,384 chunks before it signals backpressure.
  let written = Promise.resolve();
  for await (const chunk of chunks) {
    await written;
    size += chunk.length;
    written = writer.write(chunk);
  }
  await written;
  await writer.close();
  const parts = await output;
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const start = headerLength(parts);
  const trailer = range(parts, total - GZIP_TRAILER, total);
  return {
    name,
    data: slice(parts, start, total - GZIP_TRAILER),
    crc: (trailer[0] | (trailer[1] << 8) | (trailer[2] << 16) | (trailer[3] << 24)) >>> 0,
    size,
    compressedSize: total - GZIP_TRAILER - start,
  };
}

/**
 * @param {ZipEntry[]} entries
 * @param {string} type
 * @returns {import('./messages.js').Result<Blob>}
 */
export function zipBlob(entries, type) {
  const encoder = new TextEncoder();
  /** @type {Bytes[]} */
  const parts = [];
  /** @type {Bytes[]} */
  const directory = [];
  let offset = 0;
  for (const entry of entries) {
    if (entry.size >= ZIP32_LIMIT || entry.compressedSize >= ZIP32_LIMIT || offset >= ZIP32_LIMIT) return tooLarge();
    const name = encoder.encode(entry.name);
    const local = new Uint8Array(LOCAL_HEADER + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    writeCommonFields(view, 4, entry, name.length);
    local.set(name, LOCAL_HEADER);
    directory.push(centralHeader(entry, name, offset));
    parts.push(local, ...entry.data);
    offset += local.length + entry.compressedSize;
  }
  const directorySize = directory.reduce((sum, header) => sum + header.length, 0);
  if (offset >= ZIP32_LIMIT || offset + directorySize >= ZIP32_LIMIT) return tooLarge();
  const end = new Uint8Array(END_OF_DIRECTORY);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, directorySize, true);
  view.setUint32(16, offset, true);
  return { ok: true, value: new Blob([...parts, ...directory, end], { type }) };
}

/**
 * @param {ZipEntry} entry
 * @param {Uint8Array} name
 * @param {number} offset
 */
function centralHeader(entry, name, offset) {
  const header = new Uint8Array(CENTRAL_HEADER + name.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, VERSION, true);
  writeCommonFields(view, 6, entry, name.length);
  view.setUint32(42, offset, true);
  header.set(name, CENTRAL_HEADER);
  return header;
}

/**
 * @param {DataView} view
 * @param {number} at
 * @param {ZipEntry} entry
 * @param {number} nameLength
 */
function writeCommonFields(view, at, entry, nameLength) {
  view.setUint16(at, VERSION, true);
  view.setUint16(at + 4, DEFLATE, true);
  view.setUint16(at + 8, DOS_DATE, true);
  view.setUint32(at + 10, entry.crc, true);
  view.setUint32(at + 14, entry.compressedSize, true);
  view.setUint32(at + 18, entry.size, true);
  view.setUint16(at + 22, nameLength, true);
}

/** @returns {import('./messages.js').Result<Blob>} */
function tooLarge() {
  return { ok: false, error: { code: 'OUTPUT_TOO_LARGE' } };
}

/**
 * RFC 1952 header length: 10 bytes, plus FEXTRA, FNAME, FCOMMENT and FHCRC when FLG sets them.
 * @param {Bytes[]} parts
 */
function headerLength(parts) {
  const flags = byteAt(parts, 3);
  let length = 10;
  if (flags & FEXTRA) length += 2 + (byteAt(parts, length) | (byteAt(parts, length + 1) << 8));
  if (flags & FNAME) while (byteAt(parts, length++) !== 0);
  if (flags & FCOMMENT) while (byteAt(parts, length++) !== 0);
  if (flags & FHCRC) length += 2;
  return length;
}

/** @param {Bytes[]} parts @param {number} index */
function byteAt(parts, index) {
  return range(parts, index, index + 1)[0];
}

/** @param {Bytes[]} parts @param {number} start @param {number} end */
function range(parts, start, end) {
  const out = new Uint8Array(end - start);
  let at = 0;
  for (const part of slice(parts, start, end)) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** @param {Bytes[]} parts @param {number} start @param {number} end */
function slice(parts, start, end) {
  /** @type {Bytes[]} */
  const out = [];
  let offset = 0;
  for (const part of parts) {
    const from = Math.max(start, offset);
    const to = Math.min(end, offset + part.length);
    if (from < to) out.push(part.subarray(from - offset, to - offset));
    offset += part.length;
  }
  return out;
}

/**
 * @param {ReadableStream<Bytes>} readable
 * @returns {Promise<Bytes[]>}
 */
async function drain(readable) {
  const reader = readable.getReader();
  /** @type {Bytes[]} */
  const parts = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return parts;
    parts.push(value);
  }
}
