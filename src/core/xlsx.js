/** SpreadsheetML: package parts, styles, the shared-string table, and exact-text cells. Sheet and table XML are streamed. */

import { deflateEntry, zipBlob } from './zip.js';
import { autoNumber, columnName } from './excel.js';

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** cellXfs indices in styles.xml. Table: docs/DESIGN.md, Q5. */
export const XF = Object.freeze({ general: 0, text: 1, textWrap: 2, header: 3, headerWrap: 4, grouped: 5 });

/** Dedupe bounds for the shared-string Map. Strings past either bound get a fresh index and stay out of the Map. */
export const SST_DEDUPE = Object.freeze({ maxChars: 64, maxEntries: 500_000 });

/**
 * @param {AsyncIterable<string[][]>} batches  Records in file order.
 * @param {import('./excel.js').SheetPlan} plan
 * @param {string} name  Already passed through sheetName().
 * @returns {Promise<import('./messages.js').Result<Blob>>}  Fails only with OUTPUT_TOO_LARGE.
 */
export async function writeXlsx(batches, plan, name) {
  // TODO entries: [Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels, xl/styles.xml,
  //      xl/worksheets/sheet1.xml and xl/sharedStrings.xml. The last two are fed from one pass over the batches
  //      through two deflateEntry() streams. <sst> carries no count or uniqueCount.
  throw new Error('not implemented');
}

/**
 * Text as the content of <t>, read back exactly by Excel and LibreOffice. Table: docs/DESIGN.md, Q5.
 * @param {string} text
 * @returns {string}  'a\r\nb' → 'a&#13;\nb', '_x0041_' → '_x005F_x0041_', '\u0001' → '_x0001_'
 */
export function escapeText(text) {
  throw new Error('not implemented');
}

/** True when the first or last char is <= U+0020. Excel trims <t> without xml:space="preserve". @param {string} text @returns {boolean} */
export function needsPreserve(text) {
  throw new Error('not implemented');
}
