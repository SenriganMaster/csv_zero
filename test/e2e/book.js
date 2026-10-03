import { expect } from '@playwright/test';
import { unzip } from '../helpers/unzip.js';

/**
 * @typedef {object} SheetCell
 * @property {string} ref
 * @property {number} col
 * @property {number} row
 * @property {string | null} t
 * @property {string | null} s
 * @property {string} v
 * @property {string | null} text
 */

/**
 * @typedef {object} Workbook
 * @property {SheetCell[]} cells
 * @property {number} cellMarks
 * @property {string[]} numFmts
 * @property {string[]} badParts
 * @property {string[]} strings
 */

/** XML entities, then OOXML `_xHHHH_`. `_x005F_` is the escape for `_`, so one left-to-right pass turns `_x005F_x0041_` back into `_x0041_`. @param {string} text */
export function unescapeCellText(text) {
  const decoded = text
    .replaceAll('&#13;', '\r')
    .replaceAll('&#10;', '\n')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&amp;', '&');
  return decoded.replace(/_x([0-9A-Fa-f]{4})_/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** @param {Buffer | Uint8Array} bytes @returns {Workbook} */
export function readWorkbook(bytes) {
  const files = unzip(bytes);
  const sheet = textPart(files, 'xl/worksheets/sheet1.xml');
  const styles = textPart(files, 'xl/styles.xml');
  const shared = textPart(files, 'xl/sharedStrings.xml');
  const strings = readSharedStrings(shared);
  const cells = readCells(sheet, strings);
  const badParts = [];
  for (const [name, data] of files) {
    const xml = data.toString('utf8');
    // <font> and <fill> are not formulas. A formula tag is <f> or <f ...>.
    if (xml.includes('<f>') || xml.includes('<f ') || xml.includes('inlineStr')) badParts.push(name);
  }
  return {
    cells,
    cellMarks: sheet.match(/<c r="/g)?.length ?? 0,
    numFmts: cellXfNumFmts(styles),
    badParts,
    strings,
  };
}

/**
 * Every cell is shared-string text with numFmtId 49, empty fields are absent, and the grid equals `records`.
 * @param {Workbook} book
 * @param {string[][]} records
 */
export function assertTextWorkbook(book, records) {
  expect(book.badParts).toEqual([]);
  expect(book.cells).toHaveLength(book.cellMarks);
  const width = records.reduce((max, record) => Math.max(max, record.length), 0);
  const expected = records.map((record) => record.concat(Array(width - record.length).fill('')));
  const grid = expected.map((record) => record.map(() => ''));
  for (const cell of book.cells) {
    expect(cell.t, cell.ref).toBe('s');
    expect(cell.s, cell.ref).not.toBeNull();
    expect(book.numFmts[Number(cell.s)], `${cell.ref} style ${cell.s}`).toBe('49');
    const sourceRow = expected[cell.row - 1];
    expect(sourceRow, cell.ref).toBeDefined();
    expect(sourceRow[cell.col], `${cell.ref} should be a non-empty field`).not.toBe('');
    expect(cell.text, cell.ref).toBe(sourceRow[cell.col]);
    grid[cell.row - 1][cell.col] = cell.text ?? '';
  }
  expect(grid).toEqual(expected);
}

/** @param {Map<string, Buffer>} files @param {string} name */
function textPart(files, name) {
  const data = files.get(name);
  if (!data) throw new Error(`missing ${name}`);
  return data.toString('utf8');
}

/** @param {string} xml */
function readSharedStrings(xml) {
  /** @type {string[]} */
  const strings = [];
  for (const match of xml.matchAll(/<si><t(?: xml:space="preserve")?>([^<]*)<\/t><\/si>/g)) {
    strings.push(unescapeCellText(match[1]));
  }
  const marks = xml.match(/<si>/g)?.length ?? 0;
  if (strings.length !== marks) throw new Error(`shared strings parsed ${strings.length} of ${marks}`);
  return strings;
}

/** @param {string} styles */
function cellXfNumFmts(styles) {
  const start = styles.indexOf('<cellXfs');
  const end = styles.indexOf('</cellXfs>');
  if (start < 0 || end < start) throw new Error('cellXfs missing');
  return [...styles.slice(start, end).matchAll(/<xf\b[^>]*\bnumFmtId="(\d+)"/g)].map((match) => match[1]);
}

/**
 * @param {string} sheet
 * @param {string[]} strings
 * @returns {SheetCell[]}
 */
function readCells(sheet, strings) {
  /** @type {SheetCell[]} */
  const cells = [];
  const pattern = /<c r="([A-Z]+)(\d+)"(?: s="(\d+)")?(?: t="([A-Za-z]+)")?><v>([^<]*)<\/v><\/c>/g;
  for (const match of sheet.matchAll(pattern)) {
    const ref = `${match[1]}${match[2]}`;
    const t = match[4] ?? null;
    const v = match[5];
    const text = t === 's' ? strings[Number(v)] : null;
    if (t === 's' && text === undefined) throw new Error(`shared string ${v} missing for ${ref}`);
    cells.push({
      ref,
      col: columnIndex(match[1]),
      row: Number(match[2]),
      t,
      s: match[3] ?? null,
      v,
      text: text ?? null,
    });
  }
  return cells;
}

/** @param {string} letters */
function columnIndex(letters) {
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}
