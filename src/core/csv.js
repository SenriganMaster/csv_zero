/** @typedef {',' | '\t' | ';'} Delimiter */
/** @typedef {{ delimiter: Delimiter, singleColumn: boolean }} DelimiterVerdict */
/** @typedef {'recordStart' | 'fieldStart' | 'unquoted' | 'quoted' | 'quoteInQuoted' | 'afterCR'} ReaderState */
/**
 * @typedef {object} CsvReader
 * @property {(text: string) => string[][]} push
 * @property {() => { records: string[][], unterminatedQuoteRow: number | null }} finish
 */

const QUOTE = 0x22;
const LF = 0x0a;
const CR = 0x0d;
/** @type {readonly Delimiter[]} */
const CANDIDATES = ['\t', ',', ';'];
const SAMPLE_RECORDS = 50;
const NEEDS_QUOTES = /[",\r\n]|^[ \t]|[ \t]$/;

/**
 * @param {Delimiter} delimiter
 * @returns {CsvReader}
 */
export function createCsvReader(delimiter) {
  const separator = delimiter.charCodeAt(0);
  /** @type {ReaderState} */
  let state = 'recordStart';
  /** @type {string[]} */
  let record = [];
  let pending = '';
  let heldBlank = 0;
  let released = 0;
  let quoteRow = 0;

  /** @param {string[][]} out */
  function endRecord(out) {
    for (; heldBlank > 0; heldBlank--) {
      out.push(['']);
      released++;
    }
    out.push(record);
    released++;
    record = [];
  }

  return {
    push(text) {
      /** @type {string[][]} */
      const out = [];
      const end = text.length;
      let i = 0;
      let start = 0;
      while (i < end) {
        switch (state) {
          case 'afterCR':
            if (text.charCodeAt(i) === LF) i++;
            state = 'recordStart';
            break;
          case 'recordStart':
          case 'fieldStart': {
            const c = text.charCodeAt(i);
            if (c === QUOTE) {
              quoteRow = released + heldBlank;
              state = 'quoted';
              start = ++i;
            } else if (c === separator) {
              record.push('');
              state = 'fieldStart';
              i++;
            } else if (c === CR || c === LF) {
              if (state === 'recordStart') heldBlank++;
              else {
                record.push('');
                endRecord(out);
              }
              state = c === CR ? 'afterCR' : 'recordStart';
              i++;
            } else {
              state = 'unquoted';
              start = i++;
            }
            break;
          }
          case 'unquoted': {
            let j = i;
            for (; j < end; j++) {
              const c = text.charCodeAt(j);
              if (c === separator || c === LF || c === CR) break;
            }
            if (j === end) {
              i = end;
              break;
            }
            record.push(pending + text.slice(start, j));
            pending = '';
            const c = text.charCodeAt(j);
            if (c === separator) state = 'fieldStart';
            else {
              endRecord(out);
              state = c === CR ? 'afterCR' : 'recordStart';
            }
            i = j + 1;
            break;
          }
          case 'quoted': {
            const j = text.indexOf('"', i);
            if (j === -1) {
              i = end;
              break;
            }
            pending += text.slice(start, j);
            state = 'quoteInQuoted';
            i = j + 1;
            break;
          }
          case 'quoteInQuoted': {
            const c = text.charCodeAt(i);
            if (c === QUOTE) {
              pending += '"';
              state = 'quoted';
              start = ++i;
            } else if (c === separator || c === CR || c === LF) {
              record.push(pending);
              pending = '';
              if (c === separator) state = 'fieldStart';
              else {
                endRecord(out);
                state = c === CR ? 'afterCR' : 'recordStart';
              }
              i++;
            } else {
              state = 'unquoted';
              start = i;
            }
            break;
          }
        }
      }
      if (state === 'unquoted' || state === 'quoted') pending += text.slice(start, end);
      return out;
    },

    finish() {
      /** @type {string[][]} */
      const records = [];
      const unterminatedQuoteRow = state === 'quoted' ? quoteRow : null;
      switch (state) {
        case 'fieldStart':
          record.push('');
          endRecord(records);
          break;
        case 'unquoted':
        case 'quoted':
        case 'quoteInQuoted':
          record.push(pending);
          pending = '';
          endRecord(records);
          break;
        case 'recordStart':
        case 'afterCR':
          break;
      }
      heldBlank = 0;
      state = 'recordStart';
      return { records, unterminatedQuoteRow };
    },
  };
}

/**
 * @param {string} sample
 * @param {boolean} complete
 * @param {string} fileName
 * @returns {DelimiterVerdict}
 */
export function detectDelimiter(sample, complete, fileName) {
  const preferred = /\.tsv$/i.test(fileName) ? '\t' : /\.csv$/i.test(fileName) ? ',' : null;
  const ranked = CANDIDATES.map((delimiter) => ({ delimiter, ...shapeOf(sample, complete, delimiter) }))
    .filter((candidate) => candidate.fields >= 2)
    .sort(
      (a, b) =>
        a.others - b.others ||
        b.fields - a.fields ||
        Number(b.delimiter === preferred) - Number(a.delimiter === preferred) ||
        CANDIDATES.indexOf(a.delimiter) - CANDIDATES.indexOf(b.delimiter),
    );
  return ranked.length === 0 ? { delimiter: ',', singleColumn: true } : { delimiter: ranked[0].delimiter, singleColumn: false };
}

/**
 * @param {string} sample
 * @param {boolean} complete
 * @param {Delimiter} delimiter
 * @returns {{ fields: number, others: number }}
 */
function shapeOf(sample, complete, delimiter) {
  const reader = createCsvReader(delimiter);
  const parsed = reader.push(sample);
  const records = (complete ? parsed.concat(reader.finish().records) : parsed)
    .filter((record) => !isBlank(record))
    .slice(0, SAMPLE_RECORDS);
  /** @type {Map<number, number>} */
  const counts = new Map();
  for (const record of records) counts.set(record.length, (counts.get(record.length) ?? 0) + 1);
  let fields = 0;
  let most = 0;
  for (const [length, count] of counts) {
    if (count > most || (count === most && length > fields)) {
      fields = length;
      most = count;
    }
  }
  return { fields, others: records.length - most };
}

/**
 * @param {readonly string[]} fields
 * @returns {string}
 */
export function csvRecord(fields) {
  let line = '';
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (i > 0) line += ',';
    line += NEEDS_QUOTES.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
  }
  return `${line}\r\n`;
}

/** @param {readonly string[]} record */
export function isBlank(record) {
  return record.length === 1 && record[0] === '';
}

/**
 * A field is a slice of its decoded chunk, and engines keep the whole chunk alive for as long as any slice of it
 * lives. Prepending flattens into a new string, which slice(1) then cuts.
 * @param {string} field
 */
export function detach(field) {
  return (' ' + field).slice(1);
}
