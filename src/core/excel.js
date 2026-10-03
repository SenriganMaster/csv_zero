/** What Excel does with text: CSV mangling, limits, widths, names, and the plan for one sheet. */

export const LIMITS = Object.freeze({ rows: 1_048_576, cols: 16_384, cellChars: 32_767 });

/** @typedef {'formula' | 'leadingZero' | 'exponent' | 'date' | 'numberFormat'} RiskKind  In priority order. */
/** @typedef {Record<RiskKind, number>} RiskCounts */
/** @typedef {{ header: boolean, autoColumns: readonly number[] }} SheetOptions  Unlisted columns are 文字列. */

/** @typedef {{ width: number, auto: boolean, risks: RiskCounts }} PlannedColumn  Width in Excel units. Counts cover data rows. */
/** @typedef {{ v: string, xf: 0 | 5 }} AutoNumber  The `<v>` text and the cellXfs index (0 General, 5 `#,##0`). */
/**
 * @typedef {object} SheetPlan
 * @property {number} rows  Records written, header included.
 * @property {number} cols
 * @property {boolean} header  Bold row 1 and a frozen pane.
 * @property {PlannedColumn[]} columns
 * @property {RiskCounts} risks  What double-clicking the CSV would change, all columns, data rows only.
 * @property {number} riskTotal
 * @property {import('./messages.js').AppError[]} blockers  Non-empty means xlsx cannot be written. CSV still can.
 * @property {import('./messages.js').AppError[]} warnings
 */

/**
 * What ja-JP Excel would visibly change if this text sat in a CSV opened by double-click.
 * The first matching kind wins (rule table: design.md, Q4). Counts only changes we are sure of.
 * @param {string} text
 * @returns {RiskKind | null}
 */
export function classify(text) {
  // TODO fast path: return null unless the first char is a digit or one of = + - @ (
  // TODO date: build Excel's display `yyyy/m/d` (two-digit years 00-29 become 20xx, 30-99 become 19xx)
  //      and count the cell only when that display differs from the text.
  throw new Error('not implemented');
}

/**
 * A numeric cell for a 自動 column, or null when the cell must stay text. Only values whose Excel display equals
 * the text qualify, so 自動 never changes what the user sees (rules: docs/DESIGN.md, Q5).
 * @param {string} text
 * @returns {AutoNumber | null}  '1200' → { v: '1200', xf: 0 }, '1,234' → { v: '1234', xf: 5 }, '-3.5' → { v: '-3.5', xf: 0 },
 *   '0012' → null, '1.50' → null, '1E5' → null, '123456789012' → null, '-0' → null
 */
export function autoNumber(text) {
  throw new Error('not implemented');
}

/** The widest line, counting East Asian Wide and Fullwidth characters as 2. @param {string} text @returns {number} */
export function displayWidth(text) {
  throw new Error('not implemented');
}

/** 0 → 'A', 25 → 'Z', 26 → 'AA', 16383 → 'XFD'. @param {number} index @returns {string} */
export function columnName(index) {
  throw new Error('not implemented');
}

/**
 * Excel's sheet-name rules applied to a file name. 'data[1]:x.csv' → 'data_1__x', '' → 'Sheet1', 'history' → 'history_'.
 * @param {string} fileName
 * @returns {string}
 */
export function sheetName(fileName) {
  throw new Error('not implemented');
}

/**
 * Everything the UI and the xlsx writer need to know about the sheet under these options.
 * Pure and O(cols), so the header and 自動 toggles never touch the worker.
 * @param {import('./convert.js').Analysis} analysis
 * @param {SheetOptions} options
 * @returns {SheetPlan}
 */
export function planSheet(analysis, options) {
  // TODO header off: add each column's row0.risk into the data-row counts.
  // TODO width = min(60, max(8, ceil(stats.width * 1.1) + 2)).
  // TODO blockers from LIMITS and analysis.overlong; warnings from replaced, ragged, unterminatedQuoteRow,
  //      and detected.delimiter.singleColumn.
  throw new Error('not implemented');
}
