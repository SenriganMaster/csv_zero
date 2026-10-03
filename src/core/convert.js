/** The two operations a worker runs. Each one re-reads the source, so a job is a pure function of its request. */

import { detectEncoding, decodeText, SNIFF_BYTES } from './text.js';
import { createCsvReader, detectDelimiter, csvRecord } from './csv.js';
import { classify, displayWidth, planSheet, sheetName, LIMITS } from './excel.js';
import { writeXlsx } from './xlsx.js';

/** @import { Encoding, EncodingVerdict } from './text.js' */
/** @import { Delimiter, DelimiterVerdict } from './csv.js' */
/** @import { RiskKind, RiskCounts, SheetOptions } from './excel.js' */
/** @import { Result } from './messages.js' */

/** @typedef {{ kind: 'file' | 'paste', blob: Blob, name: string }} Source  The blob is the only copy of the data. */
/** @typedef {{ encoding: Encoding | 'auto', delimiter: Delimiter | 'auto' }} ParseChoice  What the selects show. */
/** @typedef {{ encoding: Encoding, delimiter: Delimiter }} ParseSettings  Resolved. A write reuses it verbatim. */
/** @typedef {{ encoding: EncodingVerdict, delimiter: DelimiterVerdict }} Detected  What 自動 picks for this file. */
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
 * }} Analysis
 */
/** @typedef {'xlsx' | 'csv'} Format */
/** @typedef {{ blob: Blob, name: string }} OutputFile */

export const PREVIEW = Object.freeze({ records: 101, fields: 200, chars: 1000, budget: 1_000_000 });

/**
 * Detects, decodes, parses, and measures the whole file once.
 * @param {Source} source
 * @param {ParseChoice} choice
 * @param {{ onPreview(preview: Preview): void, onProgress(ratio: number): void }} hooks
 *   onPreview fires once, at PREVIEW.records records or at EOF, which is usually inside the first slice.
 * @returns {Promise<Result<Analysis>>}
 */
export async function analyze(source, choice, hooks) {
  // TODO detectEncoding, then decodeText(blob.slice(0, SNIFF_BYTES)) for detectDelimiter unless the delimiter is forced.
  // TODO per field: classify, displayWidth (skipped when 2 * length <= the column's width so far),
  //      length > LIMITS.cellChars, U+FFFD (checked only once the decoder has produced one; see DESIGN.md Q2 for the
  //      subtraction of correctly encoded U+FFFD).
  // TODO a field-count histogram gives `ragged`: records whose count differs from the most common one, blank records excluded.
  // TODO zero records after finish() is EMPTY_FILE.
  throw new Error('not implemented');
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
  // TODO xlsx: writeXlsx(recordBatches(...), planSheet(analysis, options), sheetName(source.name)).
  // TODO csv: EF BB BF, then csvRecord() per record, encoded in parts of about 1 MiB.
  throw new Error('not implemented');
}

/**
 * Decoded and parsed records, one batch per slice. analyze and both writers iterate this generator.
 * @param {Blob} blob
 * @param {ParseSettings} settings
 * @param {(ratio: number) => void} onProgress  Bytes read divided by blob.size.
 * @returns {AsyncGenerator<string[][], { unterminatedQuoteRow: number | null }, void>}
 */
async function* recordBatches(blob, settings, onProgress) {
  throw new Error('not implemented');
}
