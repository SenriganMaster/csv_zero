import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, write } from '../../src/core/convert.js';
import { planSheet } from '../../src/core/excel.js';
import { fileSource, fixture } from '../helpers/fixtures.js';

const AUTO = /** @type {const} */ ({ encoding: 'auto', delimiter: 'auto' });
const TEXT_ONLY = { header: true, autoColumns: [] };
const HOOKS = { onPreview() {}, onProgress() {} };
/** 2.5 MiB, so three 1 MiB slices, in 2,560 records. */
const THREE_SLICES = `${'a'.repeat(1023)}\n`.repeat(2560);

/** @param {string | Uint8Array} content @param {string} [name] */
const memorySource = (content, name = 'memo.csv') => ({ kind: /** @type {const} */ ('file'), blob: new Blob([content]), name });

/**
 * @param {import('../../src/core/convert.js').Source} source
 * @param {import('../../src/core/convert.js').ParseChoice} [choice]
 */
async function analysisOf(source, choice = AUTO) {
  const read = await analyze(source, choice, HOOKS);
  assert.ok(read.ok, JSON.stringify(read));
  return read.value;
}

/** The analysis without its preview records and per-column stats. @param {import('../../src/core/convert.js').Analysis} analysis */
const summary = ({ records, columns, ...rest }) => rest;

/**
 * The csv output after its BOM.
 * @param {import('../../src/core/convert.js').Source} source
 * @param {import('../../src/core/convert.js').Analysis} analysis
 */
async function csvText(source, analysis) {
  const out = await write('csv', source, analysis, TEXT_ONLY, () => {});
  assert.ok(out.ok);
  const bytes = new Uint8Array(await out.value.blob.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  return new TextDecoder().decode(bytes);
}

/**
 * @param {string} encoding @param {boolean} bom @param {boolean} asciiOnly
 * @param {string} delimiter @param {boolean} singleColumn
 */
const detected = (encoding, bom, asciiOnly, delimiter, singleColumn = false) => ({
  settings: { encoding, delimiter },
  detected: { encoding: { encoding, bom, asciiOnly }, delimiter: { delimiter, singleColumn } },
});
const CLEAN = { overlong: null, replaced: null, ragged: null, unterminatedQuoteRow: null };

describe('analyze', () => {
  /** @type {[string, object][]} */
  const fixtures = [
    ['sjis-bank.csv', { ...detected('shift_jis', false, false, ','), rows: 31, cols: 12, ...CLEAN }],
    ['utf8bom-postal.csv', { ...detected('utf-8', true, false, ','), rows: 12, cols: 4, ...CLEAN }],
    ['utf8-plain.csv', { ...detected('utf-8', false, false, ','), rows: 4, cols: 5, ...CLEAN }],
    ['tab.tsv', { ...detected('utf-8', false, false, '\t'), rows: 4, cols: 4, ...CLEAN }],
    ['quoted-newline.csv', { ...detected('utf-8', false, true, ','), rows: 4, cols: 4, ...CLEAN }],
    ['ragged.csv', { ...detected('utf-8', false, true, ','), rows: 4, cols: 4, ...CLEAN, ragged: { count: 2, row: 1 } }],
    ['semicolon.csv', { ...detected('utf-8', false, false, ';'), rows: 4, cols: 3, ...CLEAN }],
    ['single-column.csv', { ...detected('utf-8', false, false, ',', true), rows: 4, cols: 1, ...CLEAN }],
    ['blank-lines.csv', { ...detected('utf-8', false, false, ','), rows: 5, cols: 2, ...CLEAN }],
    ['unterminated-quote.csv', { ...detected('utf-8', false, true, ','), rows: 3, cols: 2, ...CLEAN, unterminatedQuoteRow: 2 }],
    ['utf16le-bom.csv', { ...detected('utf-16le', true, false, ','), rows: 2, cols: 2, ...CLEAN }],
    ['control-chars.csv', { ...detected('utf-8', false, false, ','), rows: 10, cols: 3, ...CLEAN }],
  ];
  for (const [name, expected] of fixtures) {
    test(name, async () => assert.deepEqual(summary(await analysisOf(fileSource(name))), expected));
  }

  /** @type {[string, Uint8Array, string][]} */
  const failures = [
    ['empty.csv', fixture('empty.csv'), 'EMPTY_FILE'],
    ['only blank lines', new TextEncoder().encode('\r\n\r\n\n'), 'EMPTY_FILE'],
    ['only a BOM', Uint8Array.of(0xef, 0xbb, 0xbf), 'EMPTY_FILE'],
    ['fake.xlsx', fixture('fake.xlsx'), 'NOT_CSV_XLSX'],
  ];
  for (const [label, bytes, code] of failures) {
    test(`${label} is ${code}`, async () => {
      assert.deepEqual(await analyze(memorySource(bytes), AUTO, HOOKS), { ok: false, error: { code } });
    });
  }

  test('risk counts per column, header row apart', async () => {
    const mangle = await analysisOf(fileSource('excel-mangle.csv'));
    assert.deepEqual(mangle.columns.map((column) => [column.risks, column.row0.risk]), [
      [{ formula: 0, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0 }, null],
      [{ formula: 1, leadingZero: 1, exponent: 1, date: 1, numberFormat: 1 }, null],
      [{ formula: 0, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0 }, null],
    ]);
    const numbers = await analysisOf(fileSource('long-numbers.csv'));
    assert.deepEqual(numbers.columns[1].risks, { formula: 0, leadingZero: 1, exponent: 10, date: 0, numberFormat: 3 });
    const formulas = await analysisOf(fileSource('formulas.csv'));
    assert.deepEqual(formulas.columns[1].risks, { formula: 5, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0 });
    const bank = planSheet(await analysisOf(fileSource('sjis-bank.csv')), TEXT_ONLY);
    assert.deepEqual([bank.risks, bank.riskTotal], [{ formula: 2, leadingZero: 112, exponent: 1, date: 17, numberFormat: 0 }, 132]);
  });

  test('widths take the widest line of every record, header included', async () => {
    const analysis = await analysisOf(memorySource('見出し,b\r\n"漢字\r\nab",abcdefghij\r\n'));
    assert.deepEqual(analysis.columns.map((column) => column.width), [6, 10]);
  });

  test('forced UTF-8 on Shift_JIS reports the cells with U+FFFD', async () => {
    const analysis = await analysisOf(fileSource('sjis-bank.csv'), { encoding: 'utf-8', delimiter: 'auto' });
    assert.deepEqual(summary(analysis), { ...detected('utf-8', false, false, ','), rows: 31, cols: 12, ...CLEAN, replaced: { count: 149, row: 0, col: 0 } });
  });

  test('a correctly encoded U+FFFD is not damage', async () => {
    const analysis = await analysisOf(memorySource('名前,記号\r\n山田,\uFFFD\r\n'));
    assert.equal(analysis.replaced, null);
    assert.deepEqual(analysis.records[1], ['山田', '\uFFFD']);
  });

  test('a forced delimiter is used as is, with no SINGLE_COLUMN', async () => {
    const analysis = await analysisOf(fileSource('tab.tsv'), { encoding: 'auto', delimiter: ',' });
    assert.deepEqual(analysis.detected.delimiter, { delimiter: ',', singleColumn: false });
    assert.deepEqual(analysis.records[1], ['00012\tボールペン（黒）\t1', '000\t35']);
    assert.deepEqual(analysis.ragged, { count: 1, row: 1 });
  });

  test('a paste is UTF-8 whatever the encoding choice says', async () => {
    const paste = { kind: /** @type {const} */ ('paste'), blob: new Blob(['コード\t名前\n0001\tテスト\n']), name: '貼り付けデータ' };
    const analysis = await analysisOf(paste, { encoding: 'shift_jis', delimiter: 'auto' });
    assert.deepEqual(summary(analysis), { ...detected('utf-8', false, false, '\t'), rows: 2, cols: 2, ...CLEAN });
    const out = await write('xlsx', paste, analysis, TEXT_ONLY, () => {});
    assert.ok(out.ok);
    assert.equal(out.value.name, '貼り付けデータ_text.xlsx');
  });

  test('a tie between field counts goes to the wider one; blank records never count as ragged', async () => {
    assert.deepEqual((await analysisOf(memorySource('a,b,c\n1,2\n3,4,5\n6,7\n'))).ragged, { count: 2, row: 1 });
    assert.equal((await analysisOf(memorySource('a,b\n\n1,2\n'))).ragged, null);
  });

  test('preview keeps 101 records of 200 fields of 1,000 characters', async () => {
    const rows = Array.from({ length: 300 }, (_, row) => Array.from({ length: 250 }, (_, col) => `r${row}c${col}`));
    rows[0][0] = 'x'.repeat(5000);
    let previews = 0;
    const read = await analyze(memorySource(rows.map((row) => row.join(',')).join('\n')), AUTO, { onPreview: () => previews++, onProgress() {} });
    assert.ok(read.ok);
    assert.deepEqual([previews, read.value.rows, read.value.cols], [1, 300, 250]);
    assert.equal(read.value.records.length, 101);
    assert.ok(read.value.records.every((record) => record.length === 200));
    assert.deepEqual([read.value.records[0][0], read.value.records[100][199]], ['x'.repeat(1000), 'r100c199']);
  });

  test('preview stops adding records once it holds 1,000,000 characters', async () => {
    const line = Array.from({ length: 200 }, () => 'y'.repeat(1000)).join(',');
    const analysis = await analysisOf(memorySource(Array.from({ length: 10 }, () => line).join('\n')));
    assert.equal(analysis.records.length, 5);
  });

  test('onPreview fires once, before EOF, with the records the analysis keeps', async () => {
    /** @type {string[]} */
    const events = [];
    /** @type {import('../../src/core/convert.js').Preview | null} */
    let preview = null;
    const source = memorySource(THREE_SLICES);
    const read = await analyze(source, AUTO, {
      onPreview(value) {
        events.push('preview');
        preview = value;
      },
      onProgress: (ratio) => events.push(String(ratio)),
    });
    assert.ok(read.ok);
    assert.deepEqual(events, ['0.4', 'preview', '0.8', '1']);
    assert.deepEqual(preview, { settings: read.value.settings, detected: read.value.detected, records: read.value.records });
    assert.equal(read.value.rows, 2560);
  });

  test('an analysis survives structured cloning', async () => {
    const analysis = await analysisOf(fileSource('sjis-bank.csv'));
    assert.deepEqual(structuredClone(analysis), analysis);
  });
});

describe('write', () => {
  test('csv: UTF-8 with BOM, CRLF, minimal quoting', async () => {
    /** @type {[string, string][]} */
    const cases = [
      ['quoted-newline.csv', 'id,memo,note,extra\r\n1,"line1\r\nline2",,\r\n2,"first\nsecond","He said ""hi""",x\r\n3,,,\r\n'],
      ['ragged.csv', 'a,b,c\r\n1,2\r\n3,4,5,6\r\n7,8,9\r\n'],
      ['blank-lines.csv', '\r\nコード,名前\r\n\r\n0001,みずほ\r\n0005,三菱UFJ\r\n'],
      ['tab.tsv', '商品コード,商品名,単価,在庫数\r\n00012,ボールペン（黒）,"1,000",35\r\n00103,ノート A5,250,120\r\n01000,付箋 75mm,180,0\r\n'],
      ['unterminated-quote.csv', 'id,memo\r\n1,ok\r\n2,"open quote\r\n3,never closed\r\n"\r\n'],
      [
        'control-chars.csv',
        'id,value,note\r\n1,a\u0001b,U+0001\r\n2,c\u001Fd,U+001F\r\n3,_x0041_,literal\r\n4,"  x  ",spaces\r\n5,"cr\ronly",lone CR\r\n' +
          '6,制御文字のない行,padding\r\n7,もう一つの普通の行,padding\r\n8,行数を足して制御文字を1%未満にする,padding\r\n9,テキストとして判定されるための行,padding\r\n',
      ],
    ];
    for (const [name, text] of cases) {
      const source = fileSource(name);
      assert.equal(await csvText(source, await analysisOf(source)), text, name);
    }
  });

  test('csv: a Shift_JIS file comes out as the same text in UTF-8', async () => {
    const source = fileSource('sjis-bank.csv');
    assert.equal(await csvText(source, await analysisOf(source)), new TextDecoder('shift_jis').decode(fixture('sjis-bank.csv')));
  });

  test('re-reads with analysis.settings and never re-detects', async () => {
    const source = fileSource('sjis-bank.csv');
    const forced = await analysisOf(source, { encoding: 'utf-8', delimiter: 'auto' });
    assert.ok((await csvText(source, forced)).includes('\uFFFD'));
  });

  test('names the outputs after the source', async () => {
    for (const [name, xlsx, csv] of [
      ['sjis-bank.csv', 'sjis-bank_text.xlsx', 'sjis-bank_utf8bom.csv'],
      ['data.backup.txt', 'data.backup_text.xlsx', 'data.backup_utf8bom.csv'],
      ['noext', 'noext_text.xlsx', 'noext_utf8bom.csv'],
    ]) {
      const source = memorySource('a,b\r\n', name);
      const analysis = await analysisOf(source);
      const names = [];
      for (const format of /** @type {const} */ (['xlsx', 'csv'])) {
        const out = await write(format, source, analysis, TEXT_ONLY, () => {});
        assert.ok(out.ok);
        names.push(out.value.name);
      }
      assert.deepEqual(names, [xlsx, csv]);
    }
  });

  test('a cell over 32,767 characters blocks xlsx but not csv', async () => {
    const source = memorySource(`a,b\r\n1,${'z'.repeat(32_768)}\r\n2,${'z'.repeat(32_767)}\r\n3,${'z'.repeat(40_000)}\r\n`);
    const analysis = await analysisOf(source);
    assert.deepEqual(analysis.overlong, { count: 2, row: 1, col: 1 });
    assert.deepEqual(await write('xlsx', source, analysis, TEXT_ONLY, () => {}), { ok: false, error: { code: 'CELL_TOO_LONG', count: 2, row: 1, col: 1 } });
    assert.equal((await write('csv', source, analysis, TEXT_ONLY, () => {})).ok, true);
  });

  test('progress is bytes read over blob size', async () => {
    const source = memorySource(THREE_SLICES);
    const analysis = await analysisOf(source);
    /** @type {number[]} */
    const ratios = [];
    assert.ok((await write('xlsx', source, analysis, TEXT_ONLY, (ratio) => ratios.push(ratio))).ok);
    assert.deepEqual(ratios, [0.4, 0.8, 1]);
  });
});
