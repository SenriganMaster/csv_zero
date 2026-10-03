import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEncoding, decodeText } from '../../src/core/text.js';
import { encodeShiftJis } from '../helpers/sjis.js';
import { fixture } from '../helpers/fixtures.js';

const utf8 = (/** @type {string} */ text) => new TextEncoder().encode(text);
/** @param {string} text @param {boolean} littleEndian */
const utf16 = (text, littleEndian) =>
  Array.from({ length: text.length }, (_, i) => text.charCodeAt(i)).flatMap((unit) =>
    littleEndian ? [unit & 0xff, unit >> 8] : [unit >> 8, unit & 0xff],
  );
const KANJI_LINES = '株式会社山田商事　東京本社営業部,東京都千代田区丸の内一丁目一番一号\r\n'.repeat(40);
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52];

/** @param {number} length */
function noise(length) {
  const bytes = new Uint8Array(length);
  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    bytes[i] = seed >>> 24;
  }
  return bytes;
}

/** @param {ArrayLike<number>} bytes @param {import('../../src/core/text.js').Encoding | 'auto'} choice */
const detect = (bytes, choice = 'auto') => detectEncoding(new Blob([Uint8Array.from(bytes)]), choice);
/** @param {string} encoding @param {boolean} [bom] @param {boolean} [asciiOnly] */
const verdict = (encoding, bom = false, asciiOnly = false) => ({ ok: true, value: { encoding, bom, asciiOnly } });
/** @param {string} code */
const failure = (code) => ({ ok: false, error: { code } });

/**
 * @param {ArrayLike<number>} bytes
 * @param {import('../../src/core/text.js').Encoding} encoding
 * @param {number} [sliceBytes]
 */
async function decodeAll(bytes, encoding, sliceBytes) {
  /** @type {number[]} */
  const reads = [];
  const texts = decodeText(new Blob([Uint8Array.from(bytes)]), encoding, (read) => reads.push(read), sliceBytes);
  let text = '';
  let next = await texts.next();
  for (; !next.done; next = await texts.next()) text += next.value;
  return { text, damage: next.value, reads };
}

describe('detectEncoding', () => {
  /** @type {[string, ArrayLike<number>, import('../../src/core/text.js').Encoding | 'auto', unknown][]} */
  const cases = [
    ['UTF-8 BOM', [0xef, 0xbb, 0xbf, 0x61], 'auto', verdict('utf-8', true)],
    ['CP932 ①髙', [0x87, 0x40, 0xfb, 0xfc], 'auto', verdict('shift_jis')],
    ['ZIP signature', [0x50, 0x4b, 0x03, 0x04], 'auto', failure('NOT_CSV_XLSX')],
    ['OLE2 signature', [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 'auto', failure('NOT_CSV_XLS')],
    ['UTF-16LE BOM', [0xff, 0xfe, 0x61, 0x00], 'auto', verdict('utf-16le', true)],
    ['UTF-16BE BOM', [0xfe, 0xff, 0x00, 0x61], 'auto', verdict('utf-16be', true)],
    ['UTF-16LE without BOM', [0x61, 0x00, 0x2c, 0x00, 0x62, 0x00], 'auto', verdict('utf-16le')],
    ['UTF-16BE without BOM', [0x00, 0x61, 0x00, 0x2c, 0x00, 0x62], 'auto', verdict('utf-16be')],
    ['UTF-16LE without BOM, long kanji fields', utf16(KANJI_LINES, true), 'auto', verdict('utf-16le')],
    ['UTF-16BE without BOM, long kanji fields', utf16(KANJI_LINES, false), 'auto', verdict('utf-16be')],
    ['PNG header plus noise', [...PNG, ...noise(1000)], 'auto', failure('NOT_CSV_BINARY')],
    ['16-bit little-endian numbers below 256', [...noise(1000)].flatMap((byte) => [byte, 0]), 'auto', failure('NOT_CSV_BINARY')],
    ['ASCII ending in one NUL', [...utf8('a,b\n'.repeat(100)), 0x00], 'auto', verdict('utf-8', false, true)],
    ['2,000 UTF-8 kana with one FF byte', [...utf8('あ'.repeat(2000)), 0xff], 'auto', verdict('utf-8')],
    ['ASCII only', utf8('a,b\r\n1,2\r\n'), 'auto', verdict('utf-8', false, true)],
    ['UTF-8 with a correctly encoded U+FFFD', utf8('名前,\uFFFD\n'), 'auto', verdict('utf-8')],
    ['0 bytes', [], 'auto', failure('EMPTY_FILE')],
    ['forced UTF-8 on CP932', [0x87, 0x40, 0xfb, 0xfc], 'utf-8', verdict('utf-8')],
    ['forced UTF-8 sees its BOM', [0xef, 0xbb, 0xbf, 0x61], 'utf-8', verdict('utf-8', true)],
    ['forced Shift_JIS has no BOM', [0xef, 0xbb, 0xbf, 0x61], 'shift_jis', verdict('shift_jis')],
    ['forced UTF-16BE sees its BOM', [0xfe, 0xff, 0x00, 0x61], 'utf-16be', verdict('utf-16be', true)],
    ['forced EUC-JP', [0xa4, 0xa2, 0x2c, 0x61], 'euc-jp', verdict('euc-jp')],
    ['forced encoding still rejects ZIP', [0x50, 0x4b, 0x03, 0x04, 0x61], 'shift_jis', failure('NOT_CSV_XLSX')],
    ['forced encoding still rejects binary', [...PNG, ...noise(1000)], 'utf-8', failure('NOT_CSV_BINARY')],
  ];
  for (const [label, bytes, choice, expected] of cases) {
    test(label, async () => assert.deepEqual(await detect(bytes, choice), expected));
  }

  /** @type {[string, unknown][]} */
  const fixtures = [
    ['sjis-bank.csv', verdict('shift_jis')],
    ['excel-mangle.csv', verdict('shift_jis')],
    ['utf8bom-postal.csv', verdict('utf-8', true)],
    ['utf8-plain.csv', verdict('utf-8')],
    ['utf16le-bom.csv', verdict('utf-16le', true)],
    ['control-chars.csv', verdict('utf-8')],
    ['empty.csv', failure('EMPTY_FILE')],
    ['fake.xlsx', failure('NOT_CSV_XLSX')],
  ];
  for (const [name, expected] of fixtures) {
    test(`fixture ${name}`, async () => assert.deepEqual(await detect(fixture(name)), expected));
  }
});

describe('decodeText', () => {
  test('CP932 in 7-byte slices', async () => {
    const text = '①髙ｶ)ﾐﾄﾞﾘ,金融機関コード\r\n0001,みずほ銀行\r\n';
    const bytes = encodeShiftJis(text);
    const decoded = await decodeAll(bytes, 'shift_jis', 7);
    assert.equal(decoded.text, text);
    assert.equal(decoded.damage, 0);
    assert.equal(decoded.reads.at(-1), bytes.length);
  });

  test('UTF-8 with 3- and 4-byte characters in 7-byte slices', async () => {
    const text = '𠮷野家,髙橋,①\r\nｶﾅ,😀,"a\r\nb"\r\n';
    const decoded = await decodeAll(utf8(text), 'utf-8', 7);
    assert.equal(decoded.text, text);
    assert.equal(decoded.damage, 0);
  });

  test('reports cumulative bytes after each slice', async () => {
    assert.deepEqual((await decodeAll(utf8('a'.repeat(20)), 'utf-8', 7)).reads, [7, 14, 20]);
  });

  test('strips a BOM that matches the encoding', async () => {
    assert.equal((await decodeAll([0xef, 0xbb, 0xbf, 0x61], 'utf-8')).text, 'a');
    assert.equal((await decodeAll(fixture('utf16le-bom.csv'), 'utf-16le')).text, 'コード,名前\r\n0001,テスト\r\n');
  });

  /** @type {[string, number[], import('../../src/core/text.js').Encoding, number | undefined, string, number][]} */
  const damage = [
    ['an invalid UTF-8 byte', [0x61, 0xff, 0x62], 'utf-8', undefined, 'a\uFFFDb', 1],
    ['a correctly encoded U+FFFD split across slices', [0x61, 0xef, 0xbf, 0xbd, 0x62], 'utf-8', 2, 'a\uFFFDb', 0],
    ['an encoded U+FFFD next to an invalid byte', [0xef, 0xbf, 0xbd, 0xff], 'utf-8', 1, '\uFFFD\uFFFD', 1],
    ['a truncated sequence at EOF', [0x61, 0xe3, 0x81], 'utf-8', undefined, 'a\uFFFD', 1],
    ['an aligned UTF-16LE U+FFFD split across slices', [0xfd, 0xff, 0x41, 0x00], 'utf-16le', 1, '\uFFFDA', 0],
    ['FD FF at an odd offset is not U+FFFD', [0x41, 0xfd, 0xff, 0x00, 0x00, 0xd8, 0x41, 0x00], 'utf-16le', undefined, '\uFD41\u00FF\uFFFDA', 1],
    ['an aligned UTF-16BE U+FFFD', [0x00, 0x41, 0xff, 0xfd], 'utf-16be', 1, 'A\uFFFD', 0],
    ['an invalid CP932 byte', [0x41, 0xff, 0x42], 'shift_jis', undefined, 'A\uFFFDB', 1],
  ];
  for (const [label, bytes, encoding, sliceBytes, text, count] of damage) {
    test(`damage count: ${label}`, async () => {
      const decoded = await decodeAll(bytes, encoding, sliceBytes);
      assert.equal(decoded.text, text);
      assert.equal(decoded.damage, count);
    });
  }
});
