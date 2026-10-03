import { columnName } from './excel.js';

/**
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

const COUNT = new Intl.NumberFormat('ja-JP');
const BYTE_UNITS = ['KB', 'MB', 'GB'];

/** @type {Record<import('./text.js').Encoding, string>} */
const ENCODING_NAMES = {
  'utf-8': 'UTF-8',
  shift_jis: 'Shift_JIS（CP932）',
  'euc-jp': 'EUC-JP',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
};

/** @type {Record<import('./csv.js').Delimiter, string>} */
const DELIMITER_NAMES = { ',': 'カンマ（,）', '\t': 'タブ', ';': 'セミコロン（;）' };

/**
 * @param {AppError} error
 * @returns {string}
 */
export function describe(error) {
  switch (error.code) {
    case 'EMPTY_FILE':
      return 'ファイルが空です。中身の入ったCSVファイルを選んでください。';
    case 'FILE_TOO_LARGE':
      return `ファイルが大きすぎます（${formatBytes(error.bytes)}）。このツールで扱えるのは200MBまでです。`;
    case 'NOT_CSV_XLSX':
      return 'これはExcel（.xlsx）やZIPのファイルです。CSVなどのテキストファイルを選んでください。';
    case 'NOT_CSV_XLS':
      return 'これは古い形式のExcelファイル（.xls）です。CSVなどのテキストファイルを選んでください。';
    case 'NOT_CSV_BINARY':
      return 'テキストではないファイルのようです（画像・PDF・圧縮ファイルなど）。CSVファイルを選んでください。';
    case 'READ_FAILED':
      return 'ファイルを読み込めませんでした。ファイルを移動・編集していないか確認して、もう一度選んでください。';
    case 'OUT_OF_MEMORY':
      return 'ブラウザのメモリが足りず処理できませんでした。ほかのタブを閉じるか、パソコンのブラウザでお試しください。';
    case 'WORKER_FAILED':
      return '処理中に予期しないエラーが起きました。ページを再読み込みして、もう一度お試しください。';
    case 'TOO_MANY_ROWS':
      return `行数（${formatCount(error.rows)}行）がExcelの上限1,048,576行を超えるため、xlsxでは保存できません。CSV（UTF-8 BOM付き）なら保存できます。`;
    case 'TOO_MANY_COLUMNS':
      return `列数（${formatCount(error.cols)}列）がExcelの上限16,384列を超えるため、xlsxでは保存できません。区切り文字が合っているか確認してください。`;
    case 'CELL_TOO_LONG':
      return `1つのセルに入る上限（32,767文字）を超える値が${formatCount(error.count)}件あります（最初: ${cellName(error)}）。引用符（"）の閉じ忘れがないか確認してください。`;
    case 'XLSX_UNSUPPORTED':
      return 'このブラウザはxlsxの作成に対応していません。最新のChrome・Edge・Safari・Firefoxでお試しください。CSV（UTF-8 BOM付き）での保存は使えます。';
    case 'OUTPUT_TOO_LARGE':
      return '作成するxlsxが4GBを超えるため保存できません。ファイルを分けてお試しください。';
    case 'DECODE_REPLACED':
      return `文字コードを正しく読めなかった文字が${formatCount(error.count)}文字あります（最初: ${cellName(error)}）。文字コードを切り替えると直ることがあります。`;
    case 'UNTERMINATED_QUOTE':
      return `${rowName(error.row)}で始まる引用符（"）が閉じられていません。ファイルの最後までを1つのセルとして読み込みました。`;
    case 'RAGGED_ROWS':
      return `ほかの行と列の数が違う行が${formatCount(error.count)}行あります（最初: ${rowName(error.row)}）。足りない列は空欄として扱います。`;
    case 'SINGLE_COLUMN':
      return '区切り文字が見つからなかったため、1列のデータとして読み込みました。必要なら区切り文字を選び直してください。';
    default:
      return unreachable(error);
  }
}

/** @type {Record<import('./excel.js').RiskKind, { short: string, label: string, example: string }>} */
export const RISK_LABELS = {
  formula: { short: '数式化', label: '数式として扱われる', example: '=SUM(A1)、+81-90-1234-5678 → 計算される' },
  leadingZero: { short: '先頭0', label: '先頭の0が消える', example: '0001 → 1' },
  exponent: { short: '指数表記', label: '指数表記・桁落ち', example: '1234567890123 → 1.23457E+12' },
  date: { short: '日付化', label: '日付に変わる', example: '1-2 → 1月2日' },
  numberFormat: { short: '表記変化', label: '数値になり表記が変わる', example: '1.50 → 1.5' },
};

/** @param {import('./text.js').EncodingVerdict} verdict @returns {string} */
export function encodingLabel(verdict) {
  if (verdict.asciiOnly) return 'ASCII（英数字・記号のみ）';
  return verdict.bom ? `${ENCODING_NAMES[verdict.encoding]}（BOM付き）` : ENCODING_NAMES[verdict.encoding];
}

/** @param {import('./csv.js').Delimiter} delimiter @returns {string} */
export function delimiterLabel(delimiter) {
  return DELIMITER_NAMES[delimiter];
}

/** @param {number} n @returns {string} */
export function formatCount(n) {
  return COUNT.format(n);
}

/** @param {number} bytes @returns {string} */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let unit = 0;
  for (; value >= 1023.95 && unit < BYTE_UNITS.length - 1; unit++) value /= 1024;
  return `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** @param {number} row */
function rowName(row) {
  return `${formatCount(row + 1)}行目`;
}

/** @param {{ row: number, col: number }} cell */
function cellName({ row, col }) {
  return `${rowName(row)}・${columnName(col)}列`;
}

/** @param {never} error @returns {never} */
function unreachable(error) {
  throw new Error(`no wording for ${JSON.stringify(error)}`);
}
