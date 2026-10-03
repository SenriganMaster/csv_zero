/** ZIP container over the browser's gzip CompressionStream. Deflate and CRC-32 are both native. No Zip64. */

/** @typedef {{ name: string, data: Uint8Array[], crc: number, size: number, compressedSize: number }} ZipEntry */

/**
 * Compresses one entry. Each chunk is written after `writer.ready` while a second task drains the readable
 * side, so at most one chunk waits inside the stream.
 * @param {string} name  ASCII only, so the UTF-8 name flag stays off.
 * @param {AsyncIterable<Uint8Array> | Iterable<Uint8Array>} chunks
 * @returns {Promise<ZipEntry>}
 */
export async function deflateEntry(name, chunks) {
  // TODO drop the RFC 1952 header: 10 bytes, plus FEXTRA, FNAME, FCOMMENT, and FHCRC when FLG sets them.
  // TODO hold back the last 8 bytes across chunk boundaries. They are CRC-32 LE, then ISIZE, which is ignored
  //      because ISIZE is mod 2^32; `size` is counted from the input instead.
  throw new Error('not implemented');
}

/**
 * Local file headers (CRC and sizes are known, so there are no data descriptors), entry data, central directory, EOCD.
 * The DOS time is fixed at 1980-01-01 00:00, so equal inputs give equal bytes.
 * @param {ZipEntry[]} entries
 * @param {string} type
 * @returns {import('./messages.js').Result<Blob>}  OUTPUT_TOO_LARGE when a size or an offset reaches 2^32.
 */
export function zipBlob(entries, type) {
  throw new Error('not implemented');
}
