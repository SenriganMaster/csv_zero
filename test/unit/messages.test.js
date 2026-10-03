import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiterLabel, describe, encodingLabel, formatBytes, formatCount } from '../../src/core/messages.js';

test('describe words every code, with Excel row numbers and column letters', () => {
  /** @type {[import('../../src/core/messages.js').AppError, string][]} */
  const cases = [
    [{ code: 'EMPTY_FILE' }, 'ファイルが空です。中身の入ったCSVファイルを選んでください。'],
    [{ code: 'FILE_TOO_LARGE', bytes: 230_000_000 }, 'ファイルが大きすぎます（219.3 MB）。このツールで扱えるのは200MBまでです。'],
    [{ code: 'NOT_CSV_XLSX' }, 'これはExcel（.xlsx）やZIPのファイルです。CSVなどのテキストファイルを選んでください。'],
    [{ code: 'NOT_CSV_XLS' }, 'これは古い形式のExcelファイル（.xls）です。CSVなどのテキストファイルを選んでください。'],
    [{ code: 'NOT_CSV_BINARY' }, 'テキストではないファイルのようです（画像・PDF・圧縮ファイルなど）。CSVファイルを選んでください。'],
    [{ code: 'READ_FAILED' }, 'ファイルを読み込めませんでした。ファイルを移動・編集していないか確認して、もう一度選んでください。'],
    [{ code: 'OUT_OF_MEMORY' }, 'ブラウザのメモリが足りず処理できませんでした。ほかのタブを閉じるか、パソコンのブラウザでお試しください。'],
    [{ code: 'WORKER_FAILED', detail: 'TypeError: x' }, '処理中に予期しないエラーが起きました。ページを再読み込みして、もう一度お試しください。'],
    [{ code: 'TOO_MANY_ROWS', rows: 1_048_577 }, '行数（1,048,577行）がExcelの上限1,048,576行を超えるため、xlsxでは保存できません。CSV（UTF-8 BOM付き）なら保存できます。'],
    [{ code: 'TOO_MANY_COLUMNS', cols: 20_000 }, '列数（20,000列）がExcelの上限16,384列を超えるため、xlsxでは保存できません。区切り文字が合っているか確認してください。'],
    [{ code: 'CELL_TOO_LONG', count: 2, row: 0, col: 27 }, '1つのセルに入る上限（32,767文字）を超える値が2件あります（最初: 1行目・AB列）。引用符（"）の閉じ忘れがないか確認してください。'],
    [{ code: 'XLSX_UNSUPPORTED' }, 'このブラウザはxlsxの作成に対応していません。最新のChrome・Edge・Safari・Firefoxでお試しください。CSV（UTF-8 BOM付き）での保存は使えます。'],
    [{ code: 'OUTPUT_TOO_LARGE' }, '作成するxlsxが4GBを超えるため保存できません。ファイルを分けてお試しください。'],
    [{ code: 'DECODE_REPLACED', count: 1234, row: 9, col: 0 }, '文字コードを正しく読めなかった文字が1,234文字あります（最初: 10行目・A列）。文字コードを切り替えると直ることがあります。'],
    [{ code: 'UNTERMINATED_QUOTE', row: 2 }, '3行目で始まる引用符（"）が閉じられていません。ファイルの最後までを1つのセルとして読み込みました。'],
    [{ code: 'RAGGED_ROWS', count: 2, row: 1 }, 'ほかの行と列の数が違う行が2行あります（最初: 2行目）。足りない列は空欄として扱います。'],
    [{ code: 'SINGLE_COLUMN' }, '区切り文字が見つからなかったため、1列のデータとして読み込みました。必要なら区切り文字を選び直してください。'],
  ];
  for (const [error, sentence] of cases) assert.equal(describe(error), sentence, error.code);
});

test('encodingLabel', () => {
  /** @type {[import('../../src/core/text.js').EncodingVerdict, string][]} */
  const cases = [
    [{ encoding: 'shift_jis', bom: false, asciiOnly: false }, 'Shift_JIS（CP932）'],
    [{ encoding: 'utf-8', bom: true, asciiOnly: false }, 'UTF-8（BOM付き）'],
    [{ encoding: 'utf-8', bom: false, asciiOnly: false }, 'UTF-8'],
    [{ encoding: 'utf-8', bom: false, asciiOnly: true }, 'ASCII（英数字・記号のみ）'],
    [{ encoding: 'euc-jp', bom: false, asciiOnly: false }, 'EUC-JP'],
    [{ encoding: 'utf-16le', bom: false, asciiOnly: false }, 'UTF-16 LE'],
    [{ encoding: 'utf-16le', bom: true, asciiOnly: false }, 'UTF-16 LE（BOM付き）'],
    [{ encoding: 'utf-16be', bom: true, asciiOnly: false }, 'UTF-16 BE（BOM付き）'],
  ];
  assert.deepEqual(cases.map(([verdict]) => [verdict, encodingLabel(verdict)]), cases);
});

test('delimiterLabel', () => {
  assert.deepEqual([delimiterLabel(','), delimiterLabel('\t'), delimiterLabel(';')], ['カンマ（,）', 'タブ', 'セミコロン（;）']);
});

test('formatCount', () => {
  assert.deepEqual([0, 7, 1234, 1_048_577].map(formatCount), ['0', '7', '1,234', '1,048,577']);
});

test('formatBytes uses 1024-byte units and one decimal', () => {
  /** @type {[number, string][]} */
  const cases = [
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [3223, '3.1 KB'],
    [1_048_575, '1.0 MB'],
    [21_286_093, '20.3 MB'],
    [209_715_201, '200.0 MB'],
    [5 * 2 ** 30, '5.0 GB'],
  ];
  assert.deepEqual(cases.map(([bytes]) => [bytes, formatBytes(bytes)]), cases);
});
