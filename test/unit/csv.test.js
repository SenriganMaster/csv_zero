import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCsvReader, csvRecord, detectDelimiter } from '../../src/core/csv.js';
import { fixture } from '../helpers/fixtures.js';

/**
 * @param {string[]} chunks
 * @param {import('../../src/core/csv.js').Delimiter} [delimiter]
 */
function read(chunks, delimiter = ',') {
  const reader = createCsvReader(delimiter);
  const records = chunks.flatMap((chunk) => reader.push(chunk));
  const end = reader.finish();
  return { records: [...records, ...end.records], unterminatedQuoteRow: end.unterminatedQuoteRow };
}

/** @type {[string, string, string[][], number | null][]} */
const MATRIX = [
  ['recordStart, quote', '"a"', [['a']], null],
  ['recordStart, delimiter', ',a', [['', 'a']], null],
  ['recordStart, CR', '\ra', [[''], ['a']], null],
  ['recordStart, LF', '\na', [[''], ['a']], null],
  ['recordStart, other', 'a', [['a']], null],
  ['recordStart, EOF', 'a\n', [['a']], null],
  ['fieldStart, quote', 'a,"b"', [['a', 'b']], null],
  ['fieldStart, delimiter', 'a,,b', [['a', '', 'b']], null],
  ['fieldStart, CR', 'a,\rb', [['a', ''], ['b']], null],
  ['fieldStart, LF', 'a,\nb', [['a', ''], ['b']], null],
  ['fieldStart, other', 'a,b', [['a', 'b']], null],
  ['fieldStart, EOF', 'a,', [['a', '']], null],
  ['unquoted, quote', 'a"b,c', [['a"b', 'c']], null],
  ['unquoted, delimiter', 'ab,c', [['ab', 'c']], null],
  ['unquoted, CR', 'ab\rc', [['ab'], ['c']], null],
  ['unquoted, LF', 'ab\nc', [['ab'], ['c']], null],
  ['unquoted, other', 'abc', [['abc']], null],
  ['unquoted, EOF', 'x,ab', [['x', 'ab']], null],
  ['quoted, delimiter', '"a,b"', [['a,b']], null],
  ['quoted, CR', '"a\rb"', [['a\rb']], null],
  ['quoted, LF', '"a\nb"', [['a\nb']], null],
  ['quoted, CRLF', '"a\r\nb"', [['a\r\nb']], null],
  ['quoted, other', '"ab"', [['ab']], null],
  ['quoted, EOF', 'x\n"ab\nc', [['x'], ['ab\nc']], 1],
  ['quoteInQuoted, quote', '"a""b"', [['a"b']], null],
  ['quoteInQuoted, delimiter', '"a",b', [['a', 'b']], null],
  ['quoteInQuoted, CR', '"a"\rb', [['a'], ['b']], null],
  ['quoteInQuoted, LF', '"a"\nb', [['a'], ['b']], null],
  ['quoteInQuoted, other', '"ab"c,d', [['abc', 'd']], null],
  ['quoteInQuoted, EOF', 'x,"a"', [['x', 'a']], null],
  ['afterCR, quote', 'a\r"b"', [['a'], ['b']], null],
  ['afterCR, delimiter', 'a\r,b', [['a'], ['', 'b']], null],
  ['afterCR, CR', 'a\r\rb', [['a'], [''], ['b']], null],
  ['afterCR, LF', 'a\r\nb', [['a'], ['b']], null],
  ['afterCR, other', 'a\rb', [['a'], ['b']], null],
  ['afterCR, EOF', 'a\r', [['a']], null],
  ['empty input', '', [], null],
  ['interior blank lines stay, trailing ones vanish', '\na\n\n\nb\r\n\r\n\n', [[''], ['a'], [''], [''], ['b']], null],
  ['only blank lines', '\r\n\n\r', [], null],
  ['a held blank line counts toward the quote row', 'a\n\n"b\nc', [['a'], [''], ['b\nc']], 2],
  ['"" in a field that crosses a line', '"a""\n""b",c\r\n', [['a"\n"b', 'c']], null],
  ['an empty quoted field', '"",""', [['', '']], null],
  ['a quote right after a closing quote', '"a"""', [['a"']], null],
  ['surrogate pairs and kana', '𠮷,"①\n髙"\n', [['𠮷', '①\n髙']], null],
];

describe('createCsvReader', () => {
  for (const [label, input, records, unterminatedQuoteRow] of MATRIX) {
    test(label, () => {
      const expected = { records, unterminatedQuoteRow };
      assert.deepEqual(read([input]), expected);
      for (let at = 0; at <= input.length; at++) {
        assert.deepEqual(read([input.slice(0, at), input.slice(at)]), expected, `split at ${at}`);
      }
      assert.deepEqual(read([...input]), expected, 'one character per push');
    });
  }

  test('push returns each record as soon as it ends', () => {
    const reader = createCsvReader(',');
    assert.deepEqual(reader.push('a,b\nc'), [['a', 'b']]);
    assert.deepEqual(reader.push(',d\n\n'), [['c', 'd']]);
    assert.deepEqual(reader.push('e\n'), [[''], ['e']]);
    assert.deepEqual(reader.finish(), { records: [], unterminatedQuoteRow: null });
  });

  test('tab and semicolon readers leave commas alone', () => {
    assert.deepEqual(read(['a\t1,000\n'], '\t').records, [['a', '1,000']]);
    assert.deepEqual(read(['a;1,5\n'], ';').records, [['a', '1,5']]);
  });

  test('fixture unterminated-quote.csv reads to EOF and reports the opening row', () => {
    const text = new TextDecoder().decode(fixture('unterminated-quote.csv'));
    assert.deepEqual(read([text]), {
      records: [['id', 'memo'], ['1', 'ok'], ['2', 'open quote\r\n3,never closed\r\n']],
      unterminatedQuoteRow: 2,
    });
  });
});

describe('detectDelimiter', () => {
  /** @type {[string, string, boolean, string, import('../../src/core/csv.js').DelimiterVerdict][]} */
  const cases = [
    ['comma', 'a,b,c\n1,2,3\n4,5,6\n', true, 'x.csv', { delimiter: ',', singleColumn: false }],
    ['tab with 1,000 inside', '商品\t単価\nペン\t1,000\nノート\t250\n', true, 'x.txt', { delimiter: '\t', singleColumn: false }],
    ['tab when every row has 1,000', '商品\t単価\nペン\t1,000\nノート\t2,500\n', true, 'x.txt', { delimiter: '\t', singleColumn: false }],
    ['semicolon with decimal commas', 'コード;価格\n0001;1,50\n0002;0,80\n', true, 'x.csv', { delimiter: ';', singleColumn: false }],
    ['quoted commas', '"a,b",c\n"d,e",f\n', true, 'x.csv', { delimiter: ',', singleColumn: false }],
    ['a single column', '郵便番号\n0600000\n0010010\n', true, 'x.csv', { delimiter: ',', singleColumn: true }],
    ['a full tie goes to .csv', 'a\tb,c\n', true, 'x.csv', { delimiter: ',', singleColumn: false }],
    ['a full tie goes to .tsv', 'a\tb,c\n', true, 'x.tsv', { delimiter: '\t', singleColumn: false }],
    ['a full tie without extension goes to tab', 'a\tb,c\n', true, '貼り付けデータ', { delimiter: '\t', singleColumn: false }],
    ['share beats the extension', 'a\tb,c\n1\t2,3\n4,5\n', true, 'x.tsv', { delimiter: ',', singleColumn: false }],
    ['blank lines are ignored', '\n\na;b\n\n1;2\n', true, 'x.csv', { delimiter: ';', singleColumn: false }],
    ['a pasted tab table with 1,234,567 in 30 rows', `口座番号\t金額\n${'0012345\t1,234,567\n'.repeat(30)}`, true, '貼り付けデータ', { delimiter: '\t', singleColumn: false }],
    ['a .tsv with 1,234,567 in 30 rows', `口座番号\t金額\n${'0012345\t1,234,567\n'.repeat(30)}`, true, 'x.tsv', { delimiter: '\t', singleColumn: false }],
    ['semicolon with decimal commas in 30 rows', `a;b\n${'1,5;2,25\n'.repeat(30)}`, true, 'x.csv', { delimiter: ';', singleColumn: false }],
    ['a title line above a comma table', `取引明細\n日付,金額,摘要\n${'2024/01/05,1000,振込\n'.repeat(30)}`, true, 'x.csv', { delimiter: ',', singleColumn: false }],
    ['a cut-off last record is dropped', 'a;b,c\nd;e,f\ng;h', false, 'x.csv', { delimiter: ',', singleColumn: false }],
    ['the last record counts when the sample is the whole file', 'a;b,c\nd;e,f\ng;h', true, 'x.csv', { delimiter: ';', singleColumn: false }],
  ];
  for (const [label, sample, complete, name, expected] of cases) {
    test(label, () => assert.deepEqual(detectDelimiter(sample, complete, name), expected));
  }
});

describe('csvRecord', () => {
  /** @type {[string[], string][]} */
  const cases = [
    [['a', 'b'], 'a,b\r\n'],
    [['0001', '=SUM(A1)', '①'], '0001,=SUM(A1),①\r\n'],
    [['a,b', 'say "hi"', 'x'], '"a,b","say ""hi""",x\r\n'],
    [['line1\r\nline2', 'cr\ronly', 'lf\nonly'], '"line1\r\nline2","cr\ronly","lf\nonly"\r\n'],
    [['  x  ', ' lead', 'trail\t', 'in side'], '"  x  "," lead","trail\t",in side\r\n'],
    [['', '', ''], ',,\r\n'],
    [[''], '\r\n'],
    [['a\tb', 'c;d'], 'a\tb,c;d\r\n'],
  ];
  for (const [fields, line] of cases) {
    test(JSON.stringify(fields), () => assert.equal(csvRecord(fields), line));
  }
});
