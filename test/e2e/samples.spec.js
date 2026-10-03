import { expect, test } from '@playwright/test';
import { CONVERTIBLE, fixture } from '../helpers/fixtures.js';
import { assertTextWorkbook, readWorkbook } from './book.js';
import { downloadBytes, openApp, statText, uploadFixture } from './flow.js';
import { delimiterFromLabel, encodingFromLabel, recordsFromBytes } from './records.js';

for (const [name] of CONVERTIBLE) {
  test(`${name} downloads text cells equal to the reported parse`, async ({ page }) => {
    await openApp(page);
    await uploadFixture(page, name);
    const records = recordsFromBytes(
      fixture(name),
      encodingFromLabel(await statText(page, 'encoding')),
      delimiterFromLabel(await statText(page, 'delimiter')),
    );
    const rows = Number((await statText(page, 'rows')).replaceAll(',', ''));
    const cols = Number((await statText(page, 'cols')).replaceAll(',', ''));
    expect(rows).toBe(records.length);
    expect(cols).toBe(records.reduce((max, record) => Math.max(max, record.length), 0));
    assertTextWorkbook(readWorkbook(await downloadBytes(page, 'download-xlsx')), records);
  });
}
