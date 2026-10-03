import { inflateRawSync } from 'node:zlib';

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * @param {Buffer | Uint8Array} input
 * @returns {Map<string, Buffer>}
 */
export function unzip(input) {
  const zip = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const eocd = findEocd(zip);
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > zip.length) throw new Error('central directory exceeds the archive');

  /** @type {Map<string, Buffer>} */
  const files = new Map();
  let at = centralOffset;
  const end = centralOffset + centralSize;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || zip.readUInt32LE(at) !== CENTRAL_SIG) throw new Error('bad central directory entry');
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const compressedSize = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const localOffset = zip.readUInt32LE(at + 42);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 0x8) throw new Error(`data descriptor is not supported: ${name}`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error(`zip64 is not supported: ${name}`);
    }
    files.set(name, readEntry(zip, localOffset, method, compressedSize, size, name));
  }
  return files;
}

/** @param {Buffer} zip */
function findEocd(zip) {
  const min = Math.max(0, zip.length - 22 - 65535);
  for (let at = zip.length - 22; at >= min; at--) {
    if (zip.readUInt32LE(at) !== EOCD_SIG) continue;
    const commentLength = zip.readUInt16LE(at + 20);
    if (at + 22 + commentLength === zip.length) return at;
  }
  throw new Error('end of central directory not found');
}

/**
 * @param {Buffer} zip
 * @param {number} localOffset
 * @param {number} method
 * @param {number} compressedSize
 * @param {number} size
 * @param {string} name
 */
function readEntry(zip, localOffset, method, compressedSize, size, name) {
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_SIG) {
    throw new Error(`bad local header: ${name}`);
  }
  const nameLength = zip.readUInt16LE(localOffset + 26);
  const extraLength = zip.readUInt16LE(localOffset + 28);
  const dataAt = localOffset + 30 + nameLength + extraLength;
  const compressed = zip.subarray(dataAt, dataAt + compressedSize);
  if (compressed.length !== compressedSize) throw new Error(`truncated entry: ${name}`);
  if (method === 0) {
    if (compressed.length !== size) throw new Error(`stored size mismatch: ${name}`);
    return Buffer.from(compressed);
  }
  if (method !== 8) throw new Error(`unsupported compression method ${method}: ${name}`);
  const data = inflateRawSync(compressed);
  if (data.length !== size) throw new Error(`inflated size mismatch: ${name}`);
  return data;
}
