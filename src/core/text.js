/** Bytes to text. Owns every encoding rule: magic numbers, BOMs, UTF-16 sniffing, UTF-8 versus CP932. */

/** @typedef {'utf-8' | 'shift_jis' | 'euc-jp' | 'utf-16le' | 'utf-16be'} Encoding  shift_jis is WHATWG Shift_JIS, which is CP932. euc-jp is manual only. */
/** @typedef {{ encoding: Encoding, bom: boolean, asciiOnly: boolean }} EncodingVerdict */

export const SLICE_BYTES = 1 << 20;
export const SNIFF_BYTES = 64 << 10;

/**
 * Rejects files that are not text and picks an encoding (rule table: design.md, Q2).
 * Reads the blob in slices and holds one slice at a time.
 * @param {Blob} blob
 * @param {Encoding | 'auto'} choice  A forced encoding still runs the rejection rules 1-3 and 7.
 * @returns {Promise<import('./messages.js').Result<EncodingVerdict>>}
 */
export async function detectEncoding(blob, choice) {
  // TODO rules 1-7 look only at the first SNIFF_BYTES.
  // TODO rules 8-10: one non-fatal TextDecoder('utf-8') over every slice with { stream: true }.
  //      Count U+FFFD in the output and bytes >= 0x80 in the input; drop each decoded string at once.
  throw new Error('not implemented');
}

/**
 * The decoded text in file order, one string per slice. The streaming decoder carries multibyte
 * sequences across slices and strips a BOM that matches `encoding`. Never fatal: bad bytes become U+FFFD.
 * @param {Blob} blob
 * @param {Encoding} encoding
 * @param {(bytesRead: number) => void} onBytes
 * @param {number} [sliceBytes]  Tests pass tiny slices to put boundaries inside characters.
 * @returns {AsyncGenerator<string, void, void>}
 */
export async function* decodeText(blob, encoding, onBytes, sliceBytes = SLICE_BYTES) {
  throw new Error('not implemented');
}
