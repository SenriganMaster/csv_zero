/** Errors are values. This module owns the error union and every Japanese string the page builds at runtime. */

/**
 * Rows and columns are 0-based here. describe() prints Excel row numbers and column letters.
 * @typedef {(
 *   | { code: 'EMPTY_FILE' } | { code: 'FILE_TOO_LARGE', bytes: number }
 *   | { code: 'NOT_CSV_XLSX' } | { code: 'NOT_CSV_XLS' } | { code: 'NOT_CSV_BINARY' }
 *   | { code: 'READ_FAILED' } | { code: 'OUT_OF_MEMORY' } | { code: 'WORKER_FAILED', detail: string }
 *   | { code: 'TOO_MANY_ROWS', rows: number } | { code: 'TOO_MANY_COLUMNS', cols: number }
 *   | { code: 'CELL_TOO_LONG', count: number, row: number, col: number }
 *   | { code: 'XLSX_UNSUPPORTED' } | { code: 'OUTPUT_TOO_LARGE' }
 *   | { code: 'DECODE_REPLACED', count: number, row: number, col: number }
 *   | { code: 'UNTERMINATED_QUOTE', row: number } | { code: 'RAGGED_ROWS', count: number, row: number }
 *   | { code: 'SINGLE_COLUMN' }
 * )} AppError
 */
/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: AppError }} Result
 */

/**
 * The sentence shown for an error. Wording table: design.md, Q9.
 * @param {AppError} error
 * @returns {string}
 */
export function describe(error) {
  // TODO switch (error.code) with a `never` default, so a new code fails tsc until it has wording.
  throw new Error('not implemented');
}

/** Key order is display order. @type {Record<import('./excel.js').RiskKind, { short: string, label: string, example: string }>} */
export const RISK_LABELS = {
  formula: { short: '数式化', label: '数式として扱われる', example: '=SUM(A1)、+81-90-1234-5678 → 計算される' },
  leadingZero: { short: '先頭0', label: '先頭の0が消える', example: '0001 → 1' },
  exponent: { short: '指数表記', label: '指数表記・桁落ち', example: '1234567890123 → 1.23457E+12' },
  date: { short: '日付化', label: '日付に変わる', example: '1-2 → 1月2日' },
  numberFormat: { short: '表記変化', label: '数値になり表記が変わる', example: '1.50 → 1.5' },
};

/** 'Shift_JIS（CP932）', 'UTF-8（BOM付き）', 'UTF-16 LE'. @param {import('./text.js').EncodingVerdict} verdict @returns {string} */
export function encodingLabel(verdict) {
  throw new Error('not implemented');
}

/** 'カンマ（,）', 'タブ', 'セミコロン（;）'. @param {import('./csv.js').Delimiter} delimiter @returns {string} */
export function delimiterLabel(delimiter) {
  throw new Error('not implemented');
}

/** '1,234'. @param {number} n @returns {string} */
export function formatCount(n) {
  throw new Error('not implemented');
}

/** '20.3 MB'. @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
  throw new Error('not implemented');
}
