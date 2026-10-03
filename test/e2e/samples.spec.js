import { expect, test } from '@playwright/test';
import { CONVERTIBLE, fixture } from '../helpers/fixtures.js';
import { hasPython, sheetRecords } from '../helpers/python.js';
import { assertTextWorkbook, readWorkbook } from './book.js';
import { downloadBytes, openApp, statText, uploadFixture } from './flow.js';
import { delimiterFromLabel, encodingFromLabel } from './records.js';

/** @type {Record<string, { encoding: string, bom: boolean }>} */
const REPORTED = {
  cp932: { encoding: 'shift_jis', bom: false },
  'utf-8-sig': { encoding: 'utf-8', bom: true },
  'utf-8': { encoding: 'utf-8', bom: false },
  'utf-16': { encoding: 'utf-16le', bom: true },
};

test.skip(!hasPython, 'python3 is missing');

for (const [name, codec, delimiter] of CONVERTIBLE) {
  test(`${name} reports its encoding and delimiter, and downloads the cells Python's csv module reads`, async ({ page }) => {
    await openApp(page);
    await uploadFixture(page, name);
    const encoding = await statText(page, 'encoding');
    expect({ encoding: encodingFromLabel(encoding), bom: encoding.endsWith('（BOM付き）') }).toEqual(REPORTED[codec]);
    expect(delimiterFromLabel(await statText(page, 'delimiter'))).toBe(delimiter);
    const records = sheetRecords(fixture(name), codec, delimiter);
    const rows = Number((await statText(page, 'rows')).replaceAll(',', ''));
    const cols = Number((await statText(page, 'cols')).replaceAll(',', ''));
    expect(rows).toBe(records.length);
    expect(cols).toBe(records.reduce((max, record) => Math.max(max, record.length), 0));
    assertTextWorkbook(readWorkbook(await downloadBytes(page, 'download-xlsx')), records);
  });
}
