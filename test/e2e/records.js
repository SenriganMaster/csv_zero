import { createCsvReader } from '../../src/core/csv.js';

/** Page stat text → TextDecoder label. A BOM suffix is display-only; TextDecoder strips the BOM. */
const ENCODINGS = {
  'ASCII（英数字・記号のみ）': 'utf-8',
  'UTF-8': 'utf-8',
  'Shift_JIS（CP932）': 'shift_jis',
  'EUC-JP': 'euc-jp',
  'UTF-16 LE': 'utf-16le',
  'UTF-16 BE': 'utf-16be',
};

const DELIMITERS = {
  'カンマ（,）': ',',
  タブ: '\t',
  'セミコロン（;）': ';',
};

/** @param {string} label */
export function encodingFromLabel(label) {
  const encoding = ENCODINGS[label.replace(/（BOM付き）$/, '')];
  if (!encoding) throw new Error(`unknown encoding label ${JSON.stringify(label)}`);
  return encoding;
}

/** @param {string} label */
export function delimiterFromLabel(label) {
  const delimiter = DELIMITERS[label];
  if (!delimiter) throw new Error(`unknown delimiter label ${JSON.stringify(label)}`);
  return /** @type {import('../../src/core/csv.js').Delimiter} */ (delimiter);
}

/**
 * @param {Uint8Array | Buffer} bytes
 * @param {string} encoding
 * @param {import('../../src/core/csv.js').Delimiter} delimiter
 * @returns {string[][]}
 */
export function recordsFromBytes(bytes, encoding, delimiter) {
  const text = new TextDecoder(encoding).decode(bytes);
  const reader = createCsvReader(delimiter);
  const records = reader.push(text);
  records.push(...reader.finish().records);
  return records;
}

/** Outside quotes, every record ends with CRLF. Quoted fields may contain CR or LF. @param {string} text */
export function crlfRecordEnds(text) {
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index++;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted || (char !== '\r' && char !== '\n')) continue;
    if (char !== '\r' || text[index + 1] !== '\n') return false;
    index++;
  }
  return !quoted && text.endsWith('\r\n');
}
