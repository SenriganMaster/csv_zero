/** Bytes to text. Owns every encoding rule: magic numbers, BOMs, UTF-16 sniffing, UTF-8 versus CP932. */

/** @typedef {'utf-8' | 'shift_jis' | 'euc-jp' | 'utf-16le' | 'utf-16be'} Encoding  shift_jis is WHATWG Shift_JIS, which is CP932. euc-jp is manual only. */
/**
 * @typedef {{ encoding: Encoding, bom: boolean, asciiOnly: boolean }} EncodingVerdict
 *   asciiOnly: 自動 read the whole file and found no byte at 80 or above. Always false for a forced encoding.
 */

export const SLICE_BYTES = 1 << 20;
export const SNIFF_BYTES = 64 << 10;

const XLSX_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];
const XLS_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** @type {Partial<Record<Encoding, number[]>>} */
const BOMS = { 'utf-8': [0xef, 0xbb, 0xbf], 'utf-16le': [0xff, 0xfe], 'utf-16be': [0xfe, 0xff] };
/**
 * U+FFFD as each encoding writes it, with the code unit it must align to. CP932 and EUC-JP cannot encode U+FFFD,
 * so every U+FFFD they decode stands for undecodable bytes.
 * @type {Partial<Record<Encoding, { bytes: number[], unit: number }>>}
 */
const ENCODED_REPLACEMENT = {
  'utf-8': { bytes: [0xef, 0xbf, 0xbd], unit: 1 },
  'utf-16le': { bytes: [0xfd, 0xff], unit: 2 },
  'utf-16be': { bytes: [0xff, 0xfd], unit: 2 },
};
const NO_BYTES = new Uint8Array(0);

/**
 * Rejects files that are not text and picks an encoding (rule table: design.md, Q2).
 * Reads the blob in slices and holds one slice at a time.
 * @param {Blob} blob
 * @param {Encoding | 'auto'} choice  A forced encoding still runs the rejection rules 1-3 and 7.
 * @returns {Promise<import('./messages.js').Result<EncodingVerdict>>}
 */
export async function detectEncoding(blob, choice) {
  if (blob.size === 0) return { ok: false, error: { code: 'EMPTY_FILE' } };
  const head = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
  const sniffed = sniff(head);
  if (typeof sniffed === 'string') return { ok: false, error: { code: sniffed } };
  if (choice !== 'auto') {
    const bom = BOMS[choice];
    return { ok: true, value: { encoding: choice, bom: bom !== undefined && startsWith(head, bom), asciiOnly: false } };
  }
  return { ok: true, value: sniffed ?? (await utf8OrShiftJis(blob)) };
}

/**
 * The decoded text in file order, one string per slice. The streaming decoder carries multibyte
 * sequences across slices and strips a BOM that matches `encoding`. Never fatal: bad bytes become U+FFFD.
 * @param {Blob} blob
 * @param {Encoding} encoding
 * @param {(bytesRead: number) => void} onBytes
 * @param {number} [sliceBytes]  Tests pass tiny slices to put boundaries inside characters.
 * @returns {AsyncGenerator<string, number, void>}  Returns how many U+FFFD stand for undecodable bytes, which leaves
 *   out every correctly encoded U+FFFD (design.md, Q2).
 */
export async function* decodeText(blob, encoding, onBytes, sliceBytes = SLICE_BYTES) {
  const decoder = new TextDecoder(encoding);
  const damage = createDamageCount(encoding);
  let read = 0;
  for await (const bytes of slices(blob, sliceBytes)) {
    const text = decoder.decode(bytes, { stream: true });
    damage.add(bytes, text);
    read += bytes.length;
    onBytes(read);
    yield text;
  }
  const rest = decoder.decode();
  damage.add(NO_BYTES, rest);
  if (rest !== '') yield rest;
  return damage.total();
}

/**
 * Rules 2-7, which look only at the first SNIFF_BYTES. Rule 6 only sees heads that rule 7 would call binary, since
 * UTF-16 text is full of NULs and 8-bit text has almost none.
 * @param {Uint8Array} head
 * @returns {'NOT_CSV_XLSX' | 'NOT_CSV_XLS' | 'NOT_CSV_BINARY' | EncodingVerdict | null}  null leaves the choice to rules 8-10.
 */
function sniff(head) {
  if (startsWith(head, XLSX_SIGNATURE)) return 'NOT_CSV_XLSX';
  if (startsWith(head, XLS_SIGNATURE)) return 'NOT_CSV_XLS';
  for (const encoding of /** @type {const} */ (['utf-8', 'utf-16le', 'utf-16be'])) {
    if (startsWith(head, /** @type {number[]} */ (BOMS[encoding]))) return { encoding, bom: true, asciiOnly: false };
  }
  let controls = 0;
  for (const byte of head) if (isControl(byte)) controls++;
  if (controls <= head.length * 0.01) return null;
  const utf16 = utf16WithoutBom(head);
  return utf16 ? { encoding: utf16, bom: false, asciiOnly: false } : 'NOT_CSV_BINARY';
}

/**
 * Rules 8-10 over the whole file.
 * @param {Blob} blob
 * @returns {Promise<EncodingVerdict>}
 */
async function utf8OrShiftJis(blob) {
  const decoder = new TextDecoder('utf-8');
  const damage = createDamageCount('utf-8');
  let high = 0;
  for await (const bytes of slices(blob, SLICE_BYTES)) {
    high += highBytes(bytes);
    damage.add(bytes, decoder.decode(bytes, { stream: true }));
  }
  damage.add(NO_BYTES, decoder.decode());
  const replaced = damage.total();
  if (replaced === 0) return { encoding: 'utf-8', bom: false, asciiOnly: high === 0 };
  if (replaced <= high * 0.01) return { encoding: 'utf-8', bom: false, asciiOnly: false };
  return { encoding: 'shift_jis', bom: false, asciiOnly: false };
}

/**
 * U+FFFD in the decoder's output minus the correctly encoded U+FFFD in its input. The last bytes of each slice are
 * kept, so a sequence split across slices counts once, in the slice that completes it. That slice's text also holds
 * its U+FFFD, so slices whose text has none are never scanned.
 * @param {Encoding} encoding
 */
function createDamageCount(encoding) {
  const encoded = ENCODED_REPLACEMENT[encoding];
  let tail = NO_BYTES;
  let offset = 0;
  let total = 0;
  return {
    /** @param {Uint8Array} bytes @param {string} text  What the decoder returned for these bytes. */
    add(bytes, text) {
      const found = countReplacements(text);
      if (found > 0) total += encoded ? found - countEncoded(tail, bytes, offset - tail.length, encoded) : found;
      if (encoded) tail = lastBytes(tail, bytes, encoded.bytes.length - 1);
      offset += bytes.length;
    },
    total: () => total,
  };
}

/**
 * @param {Uint8Array} tail
 * @param {Uint8Array} bytes
 * @param {number} start  File offset of tail[0].
 * @param {{ bytes: number[], unit: number }} encoded
 */
function countEncoded(tail, bytes, start, { bytes: sequence, unit }) {
  const joined = new Uint8Array(tail.length + bytes.length);
  joined.set(tail);
  joined.set(bytes, tail.length);
  let count = 0;
  for (let i = joined.indexOf(sequence[0]); i !== -1; i = joined.indexOf(sequence[0], i + 1)) {
    if ((start + i) % unit === 0 && sequence.every((byte, k) => joined[i + k] === byte)) count++;
  }
  return count;
}

/** @param {Uint8Array} tail @param {Uint8Array} bytes @param {number} n */
function lastBytes(tail, bytes, n) {
  if (bytes.length >= n) return bytes.slice(bytes.length - n);
  const joined = new Uint8Array(tail.length + bytes.length);
  joined.set(tail);
  joined.set(bytes, tail.length);
  return joined.slice(Math.max(0, joined.length - n));
}

/** @param {string} text */
function countReplacements(text) {
  let count = 0;
  for (let i = text.indexOf('\uFFFD'); i !== -1; i = text.indexOf('\uFFFD', i + 1)) count++;
  return count;
}

/**
 * The byte order whose code units hold a CSV's TAB, LF, CR, comma or semicolon at least once per 200 units, with
 * at most 1% control units. Read in the other order, those characters become U+0900, U+0A00 and so on. NUL parity
 * cannot decide it: 　 (U+3000) and 一 (U+4E00) put their 00 byte where ASCII puts its 00 in the other order.
 * @param {Uint8Array} head
 * @returns {'utf-16le' | 'utf-16be' | null}
 */
function utf16WithoutBom(head) {
  const units = head.length >> 1;
  const le = { structure: 0, controls: 0 };
  const be = { structure: 0, controls: 0 };
  for (let i = 0; i < units; i++) {
    const first = head[2 * i];
    const second = head[2 * i + 1];
    if (second === 0) countUnit(le, first);
    if (first === 0) countUnit(be, second);
  }
  const [encoding, best] = le.structure >= be.structure ? /** @type {const} */ (['utf-16le', le]) : /** @type {const} */ (['utf-16be', be]);
  return best.structure >= units * 0.005 && best.controls <= units * 0.01 ? encoding : null;
}

/** @param {{ structure: number, controls: number }} counts @param {number} low  A code unit below U+0100. */
function countUnit(counts, low) {
  if (low === 0x09 || low === 0x0a || low === 0x0d || low === 0x2c || low === 0x3b) counts.structure++;
  else if (isControl(low)) counts.controls++;
}

/**
 * 00-08, 0E-1A and 1C-1F, the C0 controls that text does not use. TAB, LF, VT, FF and CR are whitespace,
 * and ESC starts ISO-2022-JP escapes.
 * @param {number} byte
 */
function isControl(byte) {
  return byte <= 0x08 || (byte >= 0x0e && byte <= 0x1a) || (byte >= 0x1c && byte <= 0x1f);
}

/** @param {Uint8Array} bytes */
function highBytes(bytes) {
  let count = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] >= 0x80) count++;
  return count;
}

/** @param {Uint8Array} bytes @param {readonly number[]} prefix */
function startsWith(bytes, prefix) {
  return bytes.length >= prefix.length && prefix.every((byte, i) => bytes[i] === byte);
}

/**
 * @param {Blob} blob
 * @param {number} size
 * @returns {AsyncGenerator<Uint8Array, void, void>}
 */
async function* slices(blob, size) {
  for (let start = 0; start < blob.size; start += size) {
    yield new Uint8Array(await blob.slice(start, start + size).arrayBuffer());
  }
}
