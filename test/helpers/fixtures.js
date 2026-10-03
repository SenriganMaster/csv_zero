import fs from 'node:fs';

/** Every fixture that converts, with the Python codec and delimiter for an independent parse. @type {[string, string, string][]} */
export const CONVERTIBLE = [
  ['sjis-bank.csv', 'cp932', ','],
  ['excel-mangle.csv', 'cp932', ','],
  ['utf8bom-postal.csv', 'utf-8-sig', ','],
  ['utf8-plain.csv', 'utf-8', ','],
  ['tab.tsv', 'utf-8', '\t'],
  ['quoted-newline.csv', 'utf-8', ','],
  ['long-numbers.csv', 'utf-8', ','],
  ['formulas.csv', 'utf-8', ','],
  ['ragged.csv', 'utf-8', ','],
  ['semicolon.csv', 'utf-8', ';'],
  ['single-column.csv', 'utf-8', ','],
  ['blank-lines.csv', 'utf-8', ','],
  ['unterminated-quote.csv', 'utf-8', ','],
  ['utf16le-bom.csv', 'utf-16', ','],
  ['control-chars.csv', 'utf-8', ','],
];

/** @param {string} name @returns {Uint8Array} */
export function fixture(name) {
  return new Uint8Array(fs.readFileSync(new URL(`../fixtures/${name}`, import.meta.url)));
}

/** A file Source the way main.js builds one from a dropped file. @param {string} name */
export function fileSource(name) {
  return { kind: /** @type {const} */ ('file'), blob: new Blob([fixture(name)]), name };
}

/** @param {AsyncIterable<string>} texts */
export async function join(texts) {
  let all = '';
  for await (const text of texts) all += text;
  return all;
}
