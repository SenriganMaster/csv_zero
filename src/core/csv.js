/** CSV syntax: the RFC 4180 reader, delimiter sniffing, and the writer's quoting rule. */

/** @typedef {',' | '\t' | ';'} Delimiter */
/** @typedef {{ delimiter: Delimiter, singleColumn: boolean }} DelimiterVerdict */
/** @typedef {'recordStart' | 'fieldStart' | 'unquoted' | 'quoted' | 'quoteInQuoted' | 'afterCR'} ReaderState  Table: design.md, Q3. */
/**
 * @typedef {object} CsvReader
 * @property {(text: string) => string[][]} push  Feeds the next chunk. Returns the records it completed, in order.
 * @property {() => { records: string[][], unterminatedQuoteRow: number | null }} finish  EOF. Drops trailing blank records.
 */

/**
 * @param {Delimiter} delimiter
 * @returns {CsvReader}
 */
export function createCsvReader(delimiter) {
  // TODO hot loop over charCodeAt. Unquoted fields are sliced, not built char by char.
  //      In 'quoted', jump with indexOf('"'). A field that crosses a chunk keeps its text in `pending`.
  //      Collapse "" to " only in fields that contained one.
  // TODO a blank record [""] increments `heldBlank` instead of being returned. The next non-blank record
  //      releases the held ones first, and finish() discards them. Row indices count released records only.
  throw new Error('not implemented');
}

/**
 * Rule table: design.md, Q2. Parses the sample with each candidate through createCsvReader.
 * @param {string} sample  The decoded first 64 KiB.
 * @param {boolean} complete  The sample is the whole file, so its last record is not cut off.
 * @param {string} fileName  `.tsv` and `.csv` break ties.
 * @returns {DelimiterVerdict}
 */
export function detectDelimiter(sample, complete, fileName) {
  throw new Error('not implemented');
}

/**
 * One output record, comma-separated and CRLF-terminated. A field is quoted iff it contains `,` `"` CR or LF,
 * or starts or ends with a space or tab. `"` is doubled. Ragged records stay ragged.
 * @param {readonly string[]} fields
 * @returns {string}
 */
export function csvRecord(fields) {
  throw new Error('not implemented');
}
