export const LIMITS = Object.freeze({ rows: 1_048_576, cols: 16_384, cellChars: 32_767 });

/** @typedef {'formula' | 'leadingZero' | 'exponent' | 'date' | 'numberFormat'} RiskKind */
/** @typedef {Record<RiskKind, number>} RiskCounts */
/** @typedef {{ header: boolean, autoColumns: readonly number[] }} SheetOptions */

/** @typedef {{ width: number, auto: boolean, risks: RiskCounts }} PlannedColumn */
/** @typedef {{ v: string, xf: 0 | 5 }} AutoNumber */
/**
 * @typedef {object} SheetPlan
 * @property {number} rows
 * @property {number} cols
 * @property {boolean} header
 * @property {PlannedColumn[]} columns
 * @property {RiskCounts} risks
 * @property {number} riskTotal
 * @property {import('./messages.js').AppError[]} blockers
 * @property {import('./messages.js').AppError[]} warnings
 */

/** @type {readonly RiskKind[]} */
export const RISK_KINDS = ['formula', 'leadingZero', 'exponent', 'date', 'numberFormat'];

const LEADING_ZERO = /^-?0\d+(\.\d+)?$/;
const EXPONENT = /^-?(\d{12,}|\d+(\.\d+)?[eE][+-]?\d+)$/;
const NUMBER_FORMAT = /^(-?\d+\.\d*0|\(\d+(\.\d+)?\))$/;
const PLAIN_NUMBER = /^(\d[\d,]*(\.\d*)?|\.\d+)([eE][+-]?\d+)?%?$/;
const MONTH_DAY = /^(\d{1,2})[-/](\d{1,2})$/;
const YEAR_MONTH = /^(\d{4})[-/](\d{1,2})$/;
const YEAR_MONTH_DAY = /^(\d{1,4})([-/])(\d{1,2})\2(\d{1,2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const INTEGER = /^-?(0|[1-9]\d*)$/;
const DECIMAL = /^-?(0|[1-9]\d*)\.\d*[1-9]$/;
const GROUPED = /^-?[1-9]\d{0,2}(,\d{3})+$/;
/** General switches to exponent notation past 11 characters. */
const GENERAL_CHARS = 11;
const PRECISE_DIGITS = 15;

const SHEET_NAME_FORBIDDEN = /[\\/?*[\]:\u0000-\u001F]/g;
const SHEET_NAME_CHARS = 31;

/**
 * @param {string} text
 * @returns {RiskKind | null}
 */
export function classify(text) {
  const first = text.charCodeAt(0);
  const digit = first >= 0x30 && first <= 0x39;
  if (!digit && first !== 0x3d && first !== 0x2b && first !== 0x2d && first !== 0x40 && first !== 0x28) return null;
  if (isFormula(text, first)) return 'formula';
  if (LEADING_ZERO.test(text)) return 'leadingZero';
  if (EXPONENT.test(text)) return 'exponent';
  if (digit && isDate(text)) return 'date';
  if (NUMBER_FORMAT.test(text)) return 'numberFormat';
  return null;
}

/**
 * @param {string} text
 * @returns {AutoNumber | null}
 */
export function autoNumber(text) {
  if (text.length <= GENERAL_CHARS && (INTEGER.test(text) || DECIMAL.test(text))) {
    return String(Number(text)) === text ? { v: text, xf: 0 } : null;
  }
  if (!GROUPED.test(text)) return null;
  const v = text.replaceAll(',', '');
  return v.replace('-', '').length <= PRECISE_DIGITS && String(Number(v)) === v ? { v, xf: 5 } : null;
}

/** @param {string} text @returns {number} */
export function displayWidth(text) {
  let widest = 0;
  let line = 0;
  for (let i = 0; i < text.length; i++) {
    const code = /** @type {number} */ (text.codePointAt(i));
    if (code === 0x0a || code === 0x0d) {
      if (line > widest) widest = line;
      line = 0;
      continue;
    }
    if (code > 0xffff) i++;
    line += isWide(code) ? 2 : 1;
  }
  return line > widest ? line : widest;
}

/** @param {number} index @returns {string} */
export function columnName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(0x41 + ((n - 1) % 26)) + name;
  return name;
}

/**
 * Excel's sheet-name rules applied to a file name. 'data[1]:x.csv' → 'data_1__x', '' → 'Sheet1', 'history' → 'history_'.
 * @param {string} fileName
 * @returns {string}
 */
export function sheetName(fileName) {
  let name = fileName.replace(/\.[^.]*$/, '').replace(SHEET_NAME_FORBIDDEN, '_');
  if (name.length > SHEET_NAME_CHARS) {
    const high = name.charCodeAt(SHEET_NAME_CHARS - 1);
    name = name.slice(0, high >= 0xd800 && high <= 0xdbff ? SHEET_NAME_CHARS - 1 : SHEET_NAME_CHARS);
  }
  name = name.replace(/^'+|'+$/g, '');
  if (name === '') return 'Sheet1';
  return name.toLowerCase() === 'history' ? `${name}_` : name;
}

/**
 * @param {import('./convert.js').Analysis} analysis
 * @param {SheetOptions} options
 * @returns {SheetPlan}
 */
export function planSheet(analysis, options) {
  const auto = new Set(options.autoColumns);
  const risks = noRisks();
  const columns = analysis.columns.map((stats, index) => {
    const counts = { ...stats.risks };
    if (!options.header && stats.row0.risk) counts[stats.row0.risk]++;
    for (const kind of RISK_KINDS) risks[kind] += counts[kind];
    return { width: columnWidth(stats.width), auto: auto.has(index), risks: counts };
  });
  return {
    rows: analysis.rows,
    cols: analysis.cols,
    header: options.header,
    columns,
    risks,
    riskTotal: RISK_KINDS.reduce((total, kind) => total + risks[kind], 0),
    blockers: blockers(analysis),
    warnings: warnings(analysis),
  };
}

/** @returns {RiskCounts} */
export function noRisks() {
  return { formula: 0, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0 };
}

/**
 * @param {string} text
 * @param {number} first
 */
function isFormula(text, first) {
  if (text.length < 2) return false;
  if (first === 0x2d) return !PLAIN_NUMBER.test(text.slice(1));
  return first === 0x3d || first === 0x2b || first === 0x40;
}

/** @param {string} text */
function isDate(text) {
  const md = MONTH_DAY.exec(text);
  if (md) return isValidDate(Number(md[1]), Number(md[2]), false);
  const ym = YEAR_MONTH.exec(text);
  if (ym) return Number(ym[1]) >= 1900 && Number(ym[2]) >= 1 && Number(ym[2]) <= 12;
  const ymd = YEAR_MONTH_DAY.exec(text);
  if (!ymd) return false;
  const year = fullYear(ymd[1]);
  const month = Number(ymd[3]);
  const day = Number(ymd[4]);
  return year !== null && isValidDate(month, day, isLeapYear(year)) && `${year}/${month}/${day}` !== text;
}

/**
 * Excel reads a one- or two-digit year as 1930-2029. Three digits, or four before 1900, is not a date.
 * @param {string} digits
 */
function fullYear(digits) {
  const year = Number(digits);
  if (digits.length <= 2) return year < 30 ? 2000 + year : 1900 + year;
  return digits.length === 4 && year >= 1900 ? year : null;
}

/** @param {number} month @param {number} day @param {boolean} leap */
function isValidDate(month, day, leap) {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= (month === 2 && leap ? 29 : DAYS_IN_MONTH[month - 1]);
}

/** @param {number} year */
function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** @param {number} code */
function isWide(code) {
  return (
    code >= 0x1100 &&
    (code <= 0x115f ||
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3041 && code <= 0x33ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1f64f) ||
      (code >= 0x1f900 && code <= 0x1f9ff) ||
      (code >= 0x20000 && code <= 0x3fffd))
  );
}

/** @param {number} width */
function columnWidth(width) {
  return Math.min(60, Math.max(8, Math.ceil((width * 11) / 10) + 2));
}

/**
 * @param {import('./convert.js').Analysis} analysis
 * @returns {import('./messages.js').AppError[]}
 */
function blockers({ rows, cols, overlong }) {
  /** @type {import('./messages.js').AppError[]} */
  const found = [];
  if (rows > LIMITS.rows) found.push({ code: 'TOO_MANY_ROWS', rows });
  if (cols > LIMITS.cols) found.push({ code: 'TOO_MANY_COLUMNS', cols });
  if (overlong) found.push({ code: 'CELL_TOO_LONG', ...overlong });
  return found;
}

/**
 * @param {import('./convert.js').Analysis} analysis
 * @returns {import('./messages.js').AppError[]}
 */
function warnings({ replaced, ragged, unterminatedQuoteRow, detected, cols }) {
  /** @type {import('./messages.js').AppError[]} */
  const found = [];
  if (replaced) found.push({ code: 'DECODE_REPLACED', ...replaced });
  if (ragged) found.push({ code: 'RAGGED_ROWS', ...ragged });
  if (unterminatedQuoteRow !== null) found.push({ code: 'UNTERMINATED_QUOTE', row: unterminatedQuoteRow });
  if (detected.delimiter.singleColumn && cols === 1) found.push({ code: 'SINGLE_COLUMN' });
  return found;
}
