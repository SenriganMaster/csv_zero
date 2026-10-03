import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { autoNumber, classify, columnName, displayWidth, planSheet, sheetName } from '../../src/core/excel.js';

describe('classify', () => {
  /** @type {[string, import('../../src/core/excel.js').RiskKind | null][]} */
  const cases = [
    ['=SUM(A1)', 'formula'],
    ['+81-90-1234-5678', 'formula'],
    ['-A1', 'formula'],
    ['@SUM(A1)', 'formula'],
    ['+1', 'formula'],
    ['--1', 'formula'],
    ['-1-2', 'formula'],
    ['=', null],
    ['-', null],
    ['-1', null],
    ['-1,234', null],
    ['-1.5', null],
    ['-50%', null],
    ['0001', 'leadingZero'],
    ['0600000', 'leadingZero'],
    ['09012345678', 'leadingZero'],
    ['00', 'leadingZero'],
    ['01.50', 'leadingZero'],
    ['-0012', 'leadingZero'],
    ['0', null],
    ['0.5', null],
    ['1234567890123', 'exponent'],
    ['123456789012', 'exponent'],
    ['-123456789012', 'exponent'],
    ['12345678901', null],
    ['1E5', 'exponent'],
    ['1.5e-3', 'exponent'],
    ['-1E5', 'exponent'],
    ['1-2', 'date'],
    ['1/2', 'date'],
    ['12/31', 'date'],
    ['2/29', null],
    ['13/1', null],
    ['0/1', null],
    ['2024-01', 'date'],
    ['2024/1', 'date'],
    ['1899-12', null],
    ['2024-13', null],
    ['2024-01-02', 'date'],
    ['2024/01/02', 'date'],
    ['2024/1/2', null],
    ['24/1/2', 'date'],
    ['1-2-3', 'date'],
    ['2024/2/29', null],
    ['2024-2-29', 'date'],
    ['2023-2-29', null],
    ['123/1/2', null],
    ['2024/1-2', null],
    ['1.50', 'numberFormat'],
    ['1.0', 'numberFormat'],
    ['0.50', 'numberFormat'],
    ['-1.50', 'numberFormat'],
    ['(120)', 'numberFormat'],
    ['(1.5)', 'numberFormat'],
    ['(abc)', null],
    ['1.23', null],
    ['12:30', null],
    ['2024年1月2日', null],
    ['1,234', null],
    ['50%', null],
    ['¥1,000', null],
    [' 1', null],
    ['１２３', null],
    ['abc', null],
    ['', null],
  ];
  for (const [text, kind] of cases) {
    test(JSON.stringify(text), () => assert.equal(classify(text), kind));
  }
});

describe('autoNumber', () => {
  /** @type {[string, import('../../src/core/excel.js').AutoNumber | null][]} */
  const cases = [
    ['1200', { v: '1200', xf: 0 }],
    ['0', { v: '0', xf: 0 }],
    ['-3.5', { v: '-3.5', xf: 0 }],
    ['0.1', { v: '0.1', xf: 0 }],
    ['12345678901', { v: '12345678901', xf: 0 }],
    ['-1234567890', { v: '-1234567890', xf: 0 }],
    ['1,234', { v: '1234', xf: 5 }],
    ['-1,234,567', { v: '-1234567', xf: 5 }],
    ['123,456,789,012,345', { v: '123456789012345', xf: 5 }],
    ['1,234,567,890,123,456', null],
    ['123456789012', null],
    ['0012', null],
    ['1.50', null],
    ['1E5', null],
    ['-0', null],
    ['+5', null],
    ['0.0000001', null],
    ['.5', null],
    ['5.', null],
    ['1,23', null],
    ['1,2345', null],
    ['0,123', null],
    [' 1', null],
    ['', null],
  ];
  for (const [text, expected] of cases) {
    test(JSON.stringify(text), () => assert.deepEqual(autoNumber(text), expected));
  }
});

test('displayWidth counts Wide and Fullwidth as 2 and takes the widest line', () => {
  /** @type {[string, number][]} */
  const cases = [
    ['', 0],
    ['abc', 3],
    ['あいう', 6],
    ['ｶﾅ', 2],
    ['①', 1],
    ['ＡＢ', 4],
    ['한글', 4],
    ['〇ー', 4],
    ['𠮷', 2],
    ['😀', 2],
    ['a\nbcd', 3],
    ['漢字\r\nab', 4],
  ];
  assert.deepEqual(cases.map(([text]) => [text, displayWidth(text)]), cases);
});

test('columnName', () => {
  /** @type {[number, string][]} */
  const cases = [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [52, 'BA'], [701, 'ZZ'], [702, 'AAA'], [16383, 'XFD']];
  assert.deepEqual(cases.map(([index]) => [index, columnName(index)]), cases);
});

test('sheetName', () => {
  /** @type {[string, string][]} */
  const cases = [
    ['data[1]:x.csv', 'data_1__x'],
    ['a/b\\c?d*e.csv', 'a_b_c_d_e'],
    ['tab\tname.csv', 'tab_name'],
    ['x.tar.gz', 'x.tar'],
    ['貼り付けデータ', '貼り付けデータ'],
    ["'quoted'.csv", 'quoted'],
    ["''.csv", 'Sheet1'],
    ['.csv', 'Sheet1'],
    ['', 'Sheet1'],
    ['history.csv', 'history_'],
    ['HISTORY', 'HISTORY_'],
    ['histories.csv', 'histories'],
    [`${'a'.repeat(40)}.csv`, 'a'.repeat(31)],
    [`${'a'.repeat(30)}𠮷.csv`, 'a'.repeat(30)],
    [`${'a'.repeat(29)}𠮷b.csv`, `${'a'.repeat(29)}𠮷`],
    [`${'a'.repeat(30)}'b.csv`, 'a'.repeat(30)],
  ];
  assert.deepEqual(cases.map(([name]) => [name, sheetName(name)]), cases);
});

describe('planSheet', () => {
  /** @param {Partial<import('../../src/core/excel.js').RiskCounts>} counts */
  const risks = (counts = {}) => ({ formula: 0, leadingZero: 0, exponent: 0, date: 0, numberFormat: 0, ...counts });
  /** @param {object} overrides @returns {import('../../src/core/convert.js').Analysis} */
  const analysis = (overrides = {}) => ({
    settings: { encoding: 'utf-8', delimiter: ',' },
    detected: { encoding: { encoding: 'utf-8', bom: false, asciiOnly: false }, delimiter: { delimiter: ',', singleColumn: false } },
    records: [],
    rows: 3,
    cols: 4,
    columns: [
      { width: 0, risks: risks({ leadingZero: 2 }), row0: { risk: 'leadingZero' } },
      { width: 6, risks: risks({ date: 1 }), row0: { risk: null } },
      { width: 10, risks: risks(), row0: { risk: 'formula' } },
      { width: 53, risks: risks(), row0: { risk: null } },
    ],
    overlong: null,
    replaced: null,
    ragged: null,
    unterminatedQuoteRow: null,
    ...overrides,
  });

  test('header on: row 1 is never counted, widths follow the formula, 自動 columns are marked', () => {
    assert.deepEqual(planSheet(analysis(), { header: true, autoColumns: [1] }), {
      rows: 3,
      cols: 4,
      header: true,
      columns: [
        { width: 8, auto: false, risks: risks({ leadingZero: 2 }) },
        { width: 9, auto: true, risks: risks({ date: 1 }) },
        { width: 13, auto: false, risks: risks() },
        { width: 60, auto: false, risks: risks() },
      ],
      risks: risks({ leadingZero: 2, date: 1 }),
      riskTotal: 3,
      blockers: [],
      warnings: [],
    });
  });

  test('header off: row 1 risks join the counts', () => {
    const plan = planSheet(analysis(), { header: false, autoColumns: [] });
    assert.deepEqual(plan.columns.map((column) => column.risks), [risks({ leadingZero: 3 }), risks({ date: 1 }), risks({ formula: 1 }), risks()]);
    assert.deepEqual(plan.risks, risks({ formula: 1, leadingZero: 3, date: 1 }));
    assert.equal(plan.riskTotal, 5);
  });

  test('does not mutate the analysis', () => {
    const input = analysis();
    planSheet(input, { header: false, autoColumns: [] });
    assert.deepEqual(input, analysis());
  });

  test('limits block xlsx; issues become warnings in a fixed order', () => {
    const plan = planSheet(
      analysis({
        rows: 1_048_577,
        cols: 16_385,
        overlong: { count: 2, row: 5, col: 1 },
        replaced: { count: 7, row: 0, col: 3 },
        ragged: { count: 1, row: 2 },
        unterminatedQuoteRow: 2,
      }),
      { header: true, autoColumns: [] },
    );
    assert.deepEqual(plan.blockers, [
      { code: 'TOO_MANY_ROWS', rows: 1_048_577 },
      { code: 'TOO_MANY_COLUMNS', cols: 16_385 },
      { code: 'CELL_TOO_LONG', count: 2, row: 5, col: 1 },
    ]);
    assert.deepEqual(plan.warnings, [
      { code: 'DECODE_REPLACED', count: 7, row: 0, col: 3 },
      { code: 'RAGGED_ROWS', count: 1, row: 2 },
      { code: 'UNTERMINATED_QUOTE', row: 2 },
    ]);
  });

  test('SINGLE_COLUMN only when the sheet has one column', () => {
    const detected = { encoding: { encoding: 'utf-8', bom: false, asciiOnly: false }, delimiter: { delimiter: ',', singleColumn: true } };
    const options = { header: true, autoColumns: [] };
    const single = analysis({ detected, cols: 1, columns: analysis().columns.slice(0, 1) });
    assert.deepEqual(planSheet(single, options).warnings, [{ code: 'SINGLE_COLUMN' }]);
    assert.deepEqual(planSheet(analysis({ detected }), options).warnings, []);
  });

  test('exactly at the limits nothing blocks', () => {
    assert.deepEqual(planSheet(analysis({ rows: 1_048_576, cols: 16_384 }), { header: true, autoColumns: [] }).blockers, []);
  });
});
