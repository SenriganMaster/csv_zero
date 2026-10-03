import { expect, test } from '@playwright/test';
import { CONVERTIBLE, fixture } from '../helpers/fixtures.js';
import { hasPython, sheetRecords } from '../helpers/python.js';
import { assertTextWorkbook, readWorkbook } from './book.js';
import { downloadBytes, openApp, statText, uploadFixture } from './flow.js';
import { delimiterFromLabel, encodingFromLabel } from './records.js';

/** Python codec → the TextDecoder label the page should report, and whether it should say BOM. @type {Record<string, [string, boolean]>} */
const REPORTED = { cp932: ['shift_jis', false], 'utf-8-sig': ['utf-8', true], 'utf-8': ['utf-8', false], 'utf-16': ['utf-16le', true] };

test.skip(!hasPython, 'python3 is missing');

for (const [name, codec, delimiter] of CONVERTIBLE) {
  test(`${name} reports its encoding and delimiter, and downloads the cells Python's csv module reads`, async ({ page }) => {
    await openApp(page);
    await uploadFixture(page, name);
    const encoding = await statText(page, 'encoding');
    expect([encodingFromLabel(encoding), encoding.endsWith('（BOM付き）')]).toEqual(REPORTED[codec]);
    expect(delimiterFromLabel(await statText(page, 'delimiter'))).toBe(delimiter);
    const records = sheetRecords(fixture(name), codec, delimiter);
    const rows = Number((await statText(page, 'rows')).replaceAll(',', ''));
    const cols = Number((await statText(page, 'cols')).replaceAll(',', ''));
    expect(rows).toBe(records.length);
    expect(cols).toBe(records.reduce((max, record) => Math.max(max, record.length), 0));
    assertTextWorkbook(readWorkbook(await downloadBytes(page, 'download-xlsx')), records);
  });
}
