import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, write } from '../../src/core/convert.js';
import { columnName } from '../../src/core/excel.js';
import { escapeText, needsPreserve, XLSX_TYPE } from '../../src/core/xlsx.js';
import { CONVERTIBLE, fileSource, fixture } from '../helpers/fixtures.js';
import { hasPython, pythonCsv, readZip } from '../helpers/python.js';

const NO_PYTHON = hasPython ? false : 'python3 is missing';
const AUTO = /** @type {const} */ ({ encoding: 'auto', delimiter: 'auto' });
const HOOKS = { onPreview() {}, onProgress() {} };
const TEXT_ONLY = { header: true, autoColumns: [] };
const PARTS = [
  '[Content_Types].xml',
  '_rels/.rels',
  'xl/workbook.xml',
  'xl/_rels/workbook.xml.rels',
  'xl/styles.xml',
  'xl/worksheets/sheet1.xml',
  'xl/sharedStrings.xml',
];

/**
 * @param {import('../../src/core/convert.js').Source} source
 * @param {import('../../src/core/excel.js').SheetOptions} options
 */
async function toXlsx(source, options = TEXT_ONLY) {
  const read = await analyze(source, AUTO, HOOKS);
  assert.ok(read.ok);
  const out = await write('xlsx', source, read.value, options, () => {});
  assert.ok(out.ok);
  return { analysis: read.value, file: out.value, archive: await readZip(out.value.blob) };
}

/** @param {string} text @param {string} [name] */
const textSource = (text, name = 'memo.csv') => ({ kind: /** @type {const} */ ('file'), blob: new Blob([text]), name });

describe('escapeText and needsPreserve', () => {
  test('escapeText', () => {
    /** @type {[string, string][]} */
    const cases = [
      ['a\r\nb', 'a&#13;\nb'],
      ['cr\ronly', 'cr&#13;only'],
      ['_x0041_', '_x005F_x0041_'],
      ['_xabcd_ and _XABCD_', '_x005F_xabcd_ and _XABCD_'],
      ['_x00', '_x00'],
      ['_x12345_', '_x12345_'],
      ['\u0001', '_x0001_'],
      ['\u000B\u000C\u001F', '_x000B__x000C__x001F_'],
      ['\uFFFE\uFFFF', '_xFFFE__xFFFF_'],
      ['a&b<c>d', 'a&amp;b&lt;c&gt;d'],
      ['tab\tlf\n', 'tab\tlf\n'],
      ['"\'', '"\''],
      ['=SUM(A1)', '=SUM(A1)'],
      ['①髙𠮷', '①髙𠮷'],
    ];
    assert.deepEqual(cases.map(([text]) => [text, escapeText(text)]), cases);
  });

  test('needsPreserve', () => {
    /** @type {[string, boolean][]} */
    const cases = [['  x  ', true], [' x', true], ['x ', true], ['\tx', true], ['x\n', true], ['\rx', true], ['x', false], ['a b', false], ['\u3000x', false]];
    assert.deepEqual(cases.map(([text]) => [text, needsPreserve(text)]), cases);
  });
});

describe('write xlsx', { skip: NO_PYTHON }, () => {
  for (const [name, codec, delimiter] of CONVERTIBLE) {
    test(`${name}: every cell resolves to the source text, as text`, async () => {
      const records = pythonCsv(fixture(name), codec, delimiter);
      while (records.length > 0 && records.at(-1)?.join('') === '' && records.at(-1)?.length === 1) records.pop();
      const { analysis, archive } = await toXlsx(fileSource(name));
      assert.equal(analysis.settings.delimiter, delimiter);
      assert.equal(analysis.rows, records.length);
      assert.equal(archive.bad, null);
      assert.deepEqual(archive.entries.map(([part, method]) => [part, method]), PARTS.map((part) => [part, 8]));

      /** @type {Record<string, string>} */
      const expected = {};
      records.forEach((record, row) =>
        record.forEach((field, col) => {
          if (field !== '') expected[`${columnName(col)}${row + 1}`] = field;
        }),
      );
      const texts = Object.fromEntries(Object.entries(archive.cells).map(([ref, cell]) => [ref, cell.text]));
      assert.deepEqual(texts, expected);
      for (const [ref, cell] of Object.entries(archive.cells)) {
        const wrap = /[\r\n]/.test(cell.text ?? '');
        const style = /^[A-Z]+1$/.test(ref) ? (wrap ? '4' : '3') : wrap ? '2' : '1';
        assert.deepEqual([cell.t, cell.s], ['s', style], ref);
      }

      const sheet = archive.parts['xl/worksheets/sheet1.xml'];
      const range = `A1:${columnName(analysis.cols - 1)}${analysis.rows}`;
      assert.doesNotMatch(sheet, /inlineStr|<f[ >]/);
      assert.ok(sheet.includes(`<dimension ref="${range}"/>`));
      assert.ok(sheet.includes(`<ignoredError sqref="${range}" numberStoredAsText="1"/>`));
      assert.ok(sheet.includes('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'));
      assert.equal(sheet.match(/<col [^>]*style="1"\/>/g)?.length, analysis.cols);
      assert.equal(new Set(archive.strings).size, archive.strings.length, 'short strings are deduplicated');
    });
  }

  test('sjis-bank.csv keeps the values Excel would mangle', async () => {
    const { file, archive } = await toXlsx(fileSource('sjis-bank.csv'));
    assert.deepEqual([file.name, file.blob.type], ['sjis-bank_text.xlsx', XLSX_TYPE]);
    const text = (/** @type {string} */ ref) => archive.cells[ref].text;
    assert.deepEqual(
      ['A2', 'C2', 'H2', 'I2', 'J2', 'K2', 'L3', 'G3', 'G4', 'L4', 'L5', 'L8', 'I9', 'L10'].map(text),
      ['0001', '001', '0600000', '09012345678', '2026/10/05', '12,345', '1-2', '髙橋 美咲', 'ｶ)ﾐﾄﾞﾘｼｮｳｼﾞ', '請求書 No.1023\n10月・11月分', '年会費①', '=SUM(A1)', '+81-90-1234-5678', '1234567890123456'],
    );
    assert.equal(archive.strings.filter((value) => value === '0001').length, 1);
  });

  test('control-chars.csv writes C0 controls, _x escapes, padding and lone CR exactly', async () => {
    const { archive } = await toXlsx(fileSource('control-chars.csv'));
    assert.deepEqual(['B2', 'B3', 'B4', 'B5', 'B6'].map((ref) => archive.cells[ref].text), ['a\u0001b', 'c\u001Fd', '_x0041_', '  x  ', 'cr\ronly']);
    const sst = archive.parts['xl/sharedStrings.xml'];
    for (const xml of ['<t>a_x0001_b</t>', '<t>c_x001F_d</t>', '<t>_x005F_x0041_</t>', '<t xml:space="preserve">  x  </t>', '<t>cr&#13;only</t>']) {
      assert.ok(sst.includes(xml), xml);
    }
    assert.ok(sst.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si>'));
  });

  test('quoted-newline.csv keeps CRLF inside a cell and wraps it with xf 2', async () => {
    const { archive } = await toXlsx(fileSource('quoted-newline.csv'));
    assert.deepEqual(archive.cells.B2, { s: '2', t: 's', v: archive.cells.B2.v, text: 'line1\r\nline2' });
    assert.deepEqual(archive.cells.B3.text, 'first\nsecond');
    assert.deepEqual(Object.keys(archive.cells).filter((ref) => ref.endsWith('4')), ['A4']);
  });

  test('header off: no frozen pane and row 1 is plain text', async () => {
    const { archive } = await toXlsx(fileSource('utf8-plain.csv'), { header: false, autoColumns: [] });
    assert.doesNotMatch(archive.parts['xl/worksheets/sheet1.xml'], /<pane/);
    assert.deepEqual([archive.cells.A1.s, archive.cells.A1.text], ['1', '社員番号']);
  });

  test('自動 columns hold numbers whose display matches the text, and nothing else', async () => {
    const { archive } = await toXlsx(fileSource('tab.tsv'), { header: true, autoColumns: [2, 3] });
    const { cells } = archive;
    assert.deepEqual(
      ['C2', 'D2', 'C3', 'D3', 'C4', 'D4'].map((ref) => cells[ref]),
      [
        { s: '5', t: null, v: '1000' },
        { s: null, t: null, v: '35' },
        { s: null, t: null, v: '250' },
        { s: null, t: null, v: '120' },
        { s: null, t: null, v: '180' },
        { s: null, t: null, v: '0' },
      ],
    );
    assert.deepEqual([cells.C1.s, cells.C1.text, cells.A2.s, cells.A2.text], ['3', '単価', '1', '00012']);
    const sheet = archive.parts['xl/worksheets/sheet1.xml'];
    assert.ok(
      sheet.includes(
        '<cols><col min="1" max="1" width="13" customWidth="1" style="1"/><col min="2" max="2" width="20" customWidth="1" style="1"/>' +
          '<col min="3" max="3" width="8" customWidth="1"/><col min="4" max="4" width="9" customWidth="1"/></cols>',
      ),
    );
  });

  test('自動 leaves long digits, exponents, trailing zeros and -0 as text', async () => {
    const { archive } = await toXlsx(fileSource('long-numbers.csv'), { header: true, autoColumns: [1] });
    const column = Object.entries(archive.cells).filter(([ref]) => /^B\d+$/.test(ref) && ref !== 'B1');
    assert.equal(column.length, 15);
    for (const [ref, cell] of column) assert.deepEqual([cell.t, cell.s], ['s', '1'], ref);
  });

  test('styles.xml holds the six cellXfs and 游ゴシック', async () => {
    const { archive } = await toXlsx(fileSource('utf8-plain.csv'));
    const styles = archive.parts['xl/styles.xml'];
    assert.ok(styles.includes('<font><sz val="11"/><name val="游ゴシック"/><family val="3"/><charset val="128"/></font>'));
    assert.deepEqual(
      [...styles.matchAll(/<xf numFmtId="(\d+)" fontId="(\d)"[^>]*?(\/>|><alignment wrapText="1"\/>)/g)].map((m) => [m[1], m[2], m[3] !== '/>']),
      [['0', '0', false], ['0', '0', false], ['49', '0', false], ['49', '0', true], ['49', '1', false], ['49', '1', true], ['3', '0', false]],
    );
  });

  test('strings past SST_DEDUPE.maxChars are not deduplicated', async () => {
    const long = 'x'.repeat(65);
    const max = 'y'.repeat(64);
    const { archive } = await toXlsx(textSource(`a,b\r\n${long},${max}\r\n${long},${max}\r\n`));
    assert.deepEqual(archive.strings, ['a', 'b', long, max, long]);
  });

  test('the sheet name is escaped in workbook.xml', async () => {
    const { archive, file } = await toXlsx(textSource('a,b\r\n', 'R&D "q" <1>.csv'));
    assert.equal(file.name, 'R&D "q" <1>_text.xlsx');
    assert.ok(archive.parts['xl/workbook.xml'].includes('<sheet name="R&amp;D &quot;q&quot; &lt;1&gt;" sheetId="1" r:id="rId1"/>'));
  });

  test('equal inputs give equal bytes', async () => {
    const bytes = async () => new Uint8Array(await (await toXlsx(fileSource('sjis-bank.csv'))).file.blob.arrayBuffer());
    assert.deepEqual(await bytes(), await bytes());
  });
});
