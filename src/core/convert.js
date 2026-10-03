/** The two operations a worker runs. Each one re-reads the source, so a job is a pure function of its request. */

import { detectEncoding, decodeText, SNIFF_BYTES } from './text.js';
import { createCsvReader, detectDelimiter, csvRecord, detach, isBlank } from './csv.js';
import { classify, displayWidth, noRisks, planSheet, sheetName, LIMITS } from './excel.js';
import { writeXlsx } from './xlsx.js';

/** @import { Encoding, EncodingVerdict } from './text.js' */
/** @import { Delimiter, DelimiterVerdict } from './csv.js' */
/** @import { RiskKind, RiskCounts, SheetOptions } from './excel.js' */
/** @import { Result } from './messages.js' */

/** @typedef {{ kind: 'file' | 'paste', blob: Blob, name: string }} Source  The blob is the only copy of the data. */
/** @typedef {{ encoding: Encoding | 'auto', delimiter: Delimiter | 'auto' }} ParseChoice  What the selects show. */
/** @typedef {{ encoding: Encoding, delimiter: Delimiter }} ParseSettings  Resolved. A write reuses it verbatim. */
/**
 * @typedef {{ encoding: EncodingVerdict, delimiter: DelimiterVerdict }} Detected  The verdicts behind the settings:
 *   what 自動 picked, or the forced value. A paste is always UTF-8.
 */
/**
 * Display only: PREVIEW.records records, fewer once they hold PREVIEW.budget characters, at least one.
 * Each keeps PREVIEW.fields fields of PREVIEW.chars characters.
 * @typedef {{ settings: ParseSettings, detected: Detected, records: string[][] }} Preview
 */
/**
 * @typedef {object} ColumnStats
 * @property {number} width  Max displayWidth over every record, row 0 included.
 * @property {RiskCounts} risks  Records 1 to rows-1.
 * @property {{ risk: RiskKind | null }} row0  planSheet adds it when the header option is off.
 */

/** @typedef {{ count: number, row: number, col: number }} CellIssue  The first cell, plus how many share the issue. */
/**
 * @typedef {Preview & {
 *   rows: number, cols: number, columns: ColumnStats[],
 *   overlong: CellIssue | null, replaced: CellIssue | null,
 *   ragged: { count: number, row: number } | null, unterminatedQuoteRow: number | null,
 * }} Analysis  columns stops at LIMITS.cols, the columns Excel opens. cols counts them all.
 */
/** @typedef {'xlsx' | 'csv'} Format */
/** @typedef {{ blob: Blob, name: string }} OutputFile */

export const PREVIEW = Object.freeze({ records: 101, fields: 200, chars: 1000, budget: 1_000_000 });

const UTF8_BOM = Uint8Array.of(0xef, 0xbb, 0xbf);

/**
 * Detects, decodes, parses, and measures the whole file once.
 * @param {Source} source
 * @param {ParseChoice} choice
 * @param {{ onPreview(preview: Preview): void, onProgress(ratio: number): void }} hooks
 *   onPreview fires once, at PREVIEW.records records or at EOF, which is usually inside the first slice.
 * @returns {Promise<Result<Analysis>>}
 */
export async function analyze(source, choice, hooks) {
  const encoding = await detectEncoding(source.blob, source.kind === 'paste' ? 'utf-8' : choice.encoding);
  if (!encoding.ok) return encoding;
  const delimiter =
    choice.delimiter === 'auto'
      ? await sniffDelimiter(source, encoding.value.encoding)
      : { delimiter: choice.delimiter, singleColumn: false };
  /** @type {ParseSettings} */
  const settings = { encoding: encoding.value.encoding, delimiter: delimiter.delimiter };
  /** @type {Preview} */
  const preview = { settings, detected: { encoding: encoding.value, delimiter }, records: [] };
  const tally = createTally(preview.records);
  const batches = recordBatches(source.blob, settings, hooks.onProgress);
  let previewed = false;
  let next = await batches.next();
  for (; !next.done; next = await batches.next()) {
    for (const record of next.value) tally.add(record);
    if (!previewed && tally.previewFull()) {
      hooks.onPreview(preview);
      previewed = true;
    }
  }
  if (tally.rows() === 0) return { ok: false, error: { code: 'EMPTY_FILE' } };
  if (!previewed) hooks.onPreview(preview);
  return { ok: true, value: { ...preview, ...tally.result(next.value.damaged), unterminatedQuoteRow: next.value.unterminatedQuoteRow } };
}

/**
 * Writes the whole file in one format. Re-reads with analysis.settings and never re-detects.
 * @param {Format} format
 * @param {Source} source
 * @param {Analysis} analysis
 * @param {SheetOptions} options  Ignored for csv.
 * @param {(ratio: number) => void} onProgress
 * @returns {Promise<Result<OutputFile>>}  Named '<base>_text.xlsx' or '<base>_utf8bom.csv'.
 */
export async function write(format, source, analysis, options, onProgress) {
  const base = source.name.replace(/\.[^.]*$/, '');
  const batches = recordBatches(source.blob, analysis.settings, onProgress);
  if (format === 'csv') return { ok: true, value: { blob: await csvBlob(batches), name: `${base}_utf8bom.csv` } };
  const plan = planSheet(analysis, options);
  if (plan.blockers.length > 0) return { ok: false, error: plan.blockers[0] };
  const xlsx = await writeXlsx(batches, plan, sheetName(source.name));
  return xlsx.ok ? { ok: true, value: { blob: xlsx.value, name: `${base}_text.xlsx` } } : xlsx;
}

/**
 * Decoded and parsed records, one batch per slice. analyze and both writers iterate this generator.
 * @param {Blob} blob
 * @param {ParseSettings} settings
 * @param {(ratio: number) => void} onProgress  Bytes read divided by blob.size.
 * @returns {AsyncGenerator<string[][], { unterminatedQuoteRow: number | null, damaged: boolean }, void>}
 *   damaged: the decoder replaced undecodable bytes with U+FFFD.
 */
async function* recordBatches(blob, settings, onProgress) {
  const reader = createCsvReader(settings.delimiter);
  const texts = decodeText(blob, settings.encoding, (read) => onProgress(read / blob.size));
  let next = await texts.next();
  for (; !next.done; next = await texts.next()) {
    const records = reader.push(next.value);
    if (records.length > 0) yield records;
  }
  const { records, unterminatedQuoteRow } = reader.finish();
  if (records.length > 0) yield records;
  return { unterminatedQuoteRow, damaged: next.value > 0 };
}

/**
 * The delimiter verdict from the decoded first SNIFF_BYTES.
 * @param {Source} source
 * @param {Encoding} encoding
 */
async function sniffDelimiter(source, encoding) {
  let sample = '';
  for await (const text of decodeText(source.blob.slice(0, SNIFF_BYTES), encoding, () => {})) sample += text;
  return detectDelimiter(sample, source.blob.size <= SNIFF_BYTES, source.name);
}

/**
 * The O(cols) counters behind an Analysis, filling `shown` with the preview records on the way.
 * @param {string[][]} shown
 */
function createTally(shown) {
  /** @type {ColumnStats[]} */
  const columns = [];
  /** Field count of non-blank records → how many have it, and the first one's row. @type {Map<number, { count: number, row: number }>} */
  const shapes = new Map();
  /** @type {CellIssue} */
  const overlong = { count: 0, row: 0, col: 0 };
  /** @type {CellIssue} */
  const replaced = { count: 0, row: 0, col: 0 };
  let rows = 0;
  let cols = 0;
  let previewChars = 0;

  return {
    /** @param {string[]} record */
    add(record) {
      const row = rows++;
      cols = Math.max(cols, record.length);
      const counted = Math.min(record.length, LIMITS.cols);
      while (columns.length < counted) columns.push({ width: 0, risks: noRisks(), row0: { risk: null } });
      if (!isBlank(record)) {
        const shape = shapes.get(record.length);
        if (shape) shape.count++;
        else shapes.set(record.length, { count: 1, row });
      }
      for (let col = 0; col < record.length; col++) {
        const text = record[col];
        if (text === '') continue;
        if (text.length > LIMITS.cellChars) note(overlong, row, col);
        if (text.includes('\uFFFD')) note(replaced, row, col);
        if (col >= counted) continue;
        const stats = columns[col];
        const risk = classify(text);
        if (row === 0) stats.row0.risk = risk;
        else if (risk !== null) stats.risks[risk]++;
        if (2 * text.length > stats.width) stats.width = Math.max(stats.width, displayWidth(text));
      }
      if (shown.length < PREVIEW.records && previewChars < PREVIEW.budget) {
        const fields = record.slice(0, PREVIEW.fields).map((field) => detach(field.slice(0, PREVIEW.chars)));
        for (const field of fields) previewChars += field.length;
        shown.push(fields);
      }
    },
    previewFull: () => shown.length === PREVIEW.records || previewChars >= PREVIEW.budget,
    rows: () => rows,
    /** @param {boolean} damaged */
    result: (damaged) => ({
      rows,
      cols,
      columns,
      overlong: overlong.count > 0 ? overlong : null,
      replaced: damaged && replaced.count > 0 ? replaced : null,
      ragged: raggedRecords(shapes),
    }),
  };
}

/** @param {CellIssue} issue @param {number} row @param {number} col */
function note(issue, row, col) {
  if (issue.count++ > 0) return;
  issue.row = row;
  issue.col = col;
}

/**
 * Records whose field count differs from the most common one. A tie goes to the wider count, since short records
 * are the ones that get padded.
 * @param {Map<number, { count: number, row: number }>} shapes
 * @returns {{ count: number, row: number } | null}
 */
function raggedRecords(shapes) {
  let common = 0;
  let most = 0;
  for (const [fields, { count }] of shapes) {
    if (count > most || (count === most && fields > common)) {
      common = fields;
      most = count;
    }
  }
  let count = 0;
  let row = Infinity;
  for (const [fields, shape] of shapes) {
    if (fields === common) continue;
    count += shape.count;
    row = Math.min(row, shape.row);
  }
  return count === 0 ? null : { count, row };
}

/**
 * UTF-8 with a BOM, CRLF, and csvRecord quoting, encoded one part per batch.
 * @param {AsyncIterable<string[][]>} batches
 */
async function csvBlob(batches) {
  const encoder = new TextEncoder();
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const parts = [UTF8_BOM];
  for await (const records of batches) {
    let text = '';
    for (const record of records) text += csvRecord(record);
    parts.push(encoder.encode(text));
  }
  return new Blob(parts, { type: 'text/csv' });
}
