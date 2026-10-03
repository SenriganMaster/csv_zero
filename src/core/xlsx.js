/** SpreadsheetML: package parts, styles, the shared-string table, and exact-text cells. Sheet and table XML are streamed. */

import { deflateEntry, zipBlob } from './zip.js';
import { detach } from './csv.js';
import { autoNumber, columnName } from './excel.js';

/** @import { Bytes } from './zip.js' */

export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** cellXfs indices in styles.xml. Table: docs/DESIGN.md, Q5. */
export const XF = Object.freeze({ general: 0, text: 1, textWrap: 2, header: 3, headerWrap: 4, grouped: 5 });

/** Dedupe bounds for the shared-string Map. Strings past either bound get a fresh index and stay out of the Map. */
export const SST_DEDUPE = Object.freeze({ maxChars: 64, maxEntries: 500_000 });

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

const CONTENT_TYPES =
  `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  `<Override PartName="/xl/workbook.xml" ContentType="${CONTENT_TYPE}.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CONTENT_TYPE}.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPE}.styles+xml"/>` +
  `<Override PartName="/xl/sharedStrings.xml" ContentType="${CONTENT_TYPE}.sharedStrings+xml"/>` +
  '</Types>';

const ROOT_RELS =
  `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>` +
  '</Relationships>';

const WORKBOOK_RELS =
  `${XML_DECLARATION}<Relationships xmlns="${PACKAGE_REL_NS}">` +
  `<Relationship Id="rId1" Type="${REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="${REL_NS}/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId3" Type="${REL_NS}/sharedStrings" Target="sharedStrings.xml"/>` +
  '</Relationships>';

const FONT = '<sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/>';
const STYLES =
  `${XML_DECLARATION}<styleSheet xmlns="${MAIN_NS}">` +
  `<fonts count="2"><font>${FONT}</font><font><b/>${FONT}</font></fonts>` +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="6">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment wrapText="1"/></xf>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
  '<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf>' +
  '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

const SST_HEAD = `${XML_DECLARATION}<sst xmlns="${MAIN_NS}">`;
const ESCAPED = /[&<>\r\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|_(?=x[0-9A-Fa-f]{4}_)/g;
/** @type {Record<string, string>} */
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '\r': '&#13;', _: '_x005F_' };
const LINE_BREAK = /[\n\r]/;

/**
 * @param {AsyncIterable<string[][]>} batches  Records in file order.
 * @param {import('./excel.js').SheetPlan} plan
 * @param {string} name  Already passed through sheetName().
 * @returns {Promise<import('./messages.js').Result<Blob>>}  Fails only with OUTPUT_TOO_LARGE.
 */
export async function writeXlsx(batches, plan, name) {
  const encoder = new TextEncoder();
  /** @type {[string, string][]} */
  const fixed = [
    ['[Content_Types].xml', CONTENT_TYPES],
    ['_rels/.rels', ROOT_RELS],
    ['xl/workbook.xml', workbookXml(name)],
    ['xl/_rels/workbook.xml.rels', WORKBOOK_RELS],
    ['xl/styles.xml', STYLES],
  ];
  const parts = await Promise.all(fixed.map(([part, xml]) => deflateEntry(part, [encoder.encode(xml)])));
  const strings = handoff();
  const streamed = await Promise.all([
    deflateEntry('xl/worksheets/sheet1.xml', sheetXml(batches, plan, strings)),
    deflateEntry('xl/sharedStrings.xml', strings),
  ]);
  return zipBlob([...parts, ...streamed], XLSX_TYPE);
}

/**
 * Text as the content of <t>, read back exactly by Excel and LibreOffice. Table: docs/DESIGN.md, Q5.
 * @param {string} text
 * @returns {string}  'a\r\nb' → 'a&#13;\nb', '_x0041_' → '_x005F_x0041_', '\u0001' → '_x0001_'
 */
export function escapeText(text) {
  return text.replace(ESCAPED, (c) => ENTITIES[c] ?? `_x${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_`);
}

/** True when the first or last char is <= U+0020. Excel trims <t> without xml:space="preserve". @param {string} text @returns {boolean} */
export function needsPreserve(text) {
  return text.charCodeAt(0) <= 0x20 || text.charCodeAt(text.length - 1) <= 0x20;
}

/** The sheet name is ST_Xstring too, so it gets the cell escaping plus the attribute quote. @param {string} name */
function workbookXml(name) {
  return (
    `${XML_DECLARATION}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews>` +
    `<sheets><sheet name="${escapeText(name).replaceAll('"', '&quot;')}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
}

/**
 * sheet1.xml, one chunk per batch, while the strings it introduces go to `strings` as sharedStrings.xml chunks.
 * Empty fields write no <c>, and records without cells write no <row>.
 * @param {AsyncIterable<string[][]>} batches
 * @param {import('./excel.js').SheetPlan} plan
 * @param {ReturnType<typeof handoff>} strings
 * @returns {AsyncGenerator<Bytes, void, void>}
 */
async function* sheetXml(batches, plan, strings) {
  const refs = plan.columns.map((_, index) => columnName(index));
  const auto = plan.columns.map((column) => column.auto);
  const range = `A1:${refs[refs.length - 1]}${plan.rows}`;
  const table = createStringTable();
  const xml = createXmlBytes();
  xml.text(sheetHead(plan, range));
  let row = 0;
  for await (const records of batches) {
    for (const record of records) {
      row++;
      const header = plan.header && row === 1;
      let open = false;
      for (let col = 0; col < record.length; col++) {
        const text = record[col];
        if (text === '') continue;
        if (!open) {
          xml.ascii('<row r="');
          xml.integer(row);
          xml.ascii('">');
          open = true;
        }
        xml.ascii('<c r="');
        xml.ascii(refs[col]);
        xml.integer(row);
        const number = auto[col] && !header ? autoNumber(text) : null;
        if (number === null) {
          xml.ascii('" s="');
          xml.integer(textStyle(text, header));
          xml.ascii('" t="s"><v>');
          xml.integer(table.indexOf(text));
        } else {
          if (number.xf !== XF.general) {
            xml.ascii('" s="');
            xml.integer(number.xf);
          }
          xml.ascii('"><v>');
          xml.ascii(number.v);
        }
        xml.ascii('</v></c>');
      }
      if (open) xml.ascii('</row>');
    }
    yield xml.take();
    await strings.put(table.take());
  }
  xml.text(`</sheetData><ignoredErrors><ignoredError sqref="${range}" numberStoredAsText="1"/></ignoredErrors></worksheet>`);
  yield xml.take();
  await strings.put(table.end());
  await strings.end();
}

/** @param {string} text @param {boolean} header */
function textStyle(text, header) {
  const wrap = LINE_BREAK.test(text);
  return header ? (wrap ? XF.headerWrap : XF.header) : wrap ? XF.textWrap : XF.text;
}

/**
 * Everything before the first <row>, in schema order.
 * @param {import('./excel.js').SheetPlan} plan
 * @param {string} range
 */
function sheetHead(plan, range) {
  const pane = plan.header ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' : '';
  const cols = plan.columns
    .map(
      (column, index) =>
        `<col min="${index + 1}" max="${index + 1}" width="${column.width}" customWidth="1"${column.auto ? '' : ' style="1"'}/>`,
    )
    .join('');
  return (
    `${XML_DECLARATION}<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="${range}"/>` +
    `<sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews><cols>${cols}</cols><sheetData>`
  );
}

/** Indices into sharedStrings.xml, and the bytes of the <si> elements not yet handed on. */
function createStringTable() {
  /** @type {Map<string, number>} */
  const known = new Map();
  const xml = createXmlBytes();
  xml.text(SST_HEAD);
  let size = 0;
  return {
    /** @param {string} text */
    indexOf(text) {
      if (text.length <= SST_DEDUPE.maxChars) {
        const index = known.get(text);
        if (index !== undefined) return index;
        if (known.size < SST_DEDUPE.maxEntries) known.set(detach(text), size);
      }
      xml.ascii(needsPreserve(text) ? '<si><t xml:space="preserve">' : '<si><t>');
      xml.text(escapeText(text));
      xml.ascii('</t></si>');
      return size++;
    },
    take: () => xml.take(),
    end() {
      xml.ascii('</sst>');
      return xml.take();
    },
  };
}

/**
 * Bytes of XML, handed on one chunk at a time. Markup goes in byte by byte and text through encodeInto, so cell
 * markup builds no strings for the collector to clear.
 */
function createXmlBytes() {
  const encoder = new TextEncoder();
  let bytes = new Uint8Array(1 << 20);
  let length = 0;
  /** @param {number} extra */
  function reserve(extra) {
    if (length + extra <= bytes.length) return;
    const grown = new Uint8Array(Math.max(2 * bytes.length, length + extra));
    grown.set(bytes.subarray(0, length));
    bytes = grown;
  }
  return {
    /** @param {string} text  ASCII only. */
    ascii(text) {
      reserve(text.length);
      for (let i = 0; i < text.length; i++) bytes[length++] = text.charCodeAt(i);
    },
    /** @param {number} n  A non-negative integer. */
    integer(n) {
      let digits = 1;
      for (let rest = n; rest >= 10; rest = Math.floor(rest / 10)) digits++;
      reserve(digits);
      for (let at = length + digits - 1, rest = n; at >= length; at--, rest = Math.floor(rest / 10)) bytes[at] = 0x30 + (rest % 10);
      length += digits;
    },
    /** @param {string} text */
    text(text) {
      reserve(3 * text.length);
      length += encoder.encodeInto(text, bytes.subarray(length)).written;
    },
    /** The bytes written since the last take(). */
    take() {
      const chunk = bytes.slice(0, length);
      length = 0;
      return chunk;
    },
  };
}

/**
 * Hands chunks from the sheet pass to the sharedStrings.xml stream. put() settles once the consumer has taken the
 * chunk, so at most one chunk waits between the two compressors.
 */
function handoff() {
  /** @type {((chunk: Bytes | null) => void) | null} */
  let taker = null;
  /** @type {{ chunk: Bytes | null, taken: () => void } | null} */
  let offer = null;
  /** @param {Bytes | null} chunk @returns {Promise<void>} */
  const give = (chunk) =>
    new Promise((taken) => {
      if (taker) {
        taker(chunk);
        taker = null;
        taken();
      } else offer = { chunk, taken };
    });
  /** @returns {Promise<Bytes | null>} */
  const take = () =>
    new Promise((resolve) => {
      if (offer) {
        resolve(offer.chunk);
        offer.taken();
        offer = null;
      } else taker = resolve;
    });
  return {
    /** @param {Bytes} chunk */
    put: (chunk) => give(chunk),
    end: () => give(null),
    async *[Symbol.asyncIterator]() {
      for (let chunk = await take(); chunk !== null; chunk = await take()) yield chunk;
    },
  };
}
