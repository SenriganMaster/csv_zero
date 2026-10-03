import { expect, test } from '@playwright/test';
import { readWorkbook } from './book.js';
import { downloadBytes, openApp, uploadFixture } from './flow.js';

test('a loaded page converts sjis-bank.csv while offline', async ({ page, context }) => {
  await openApp(page);
  await context.setOffline(true);
  await uploadFixture(page, 'sjis-bank.csv');
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  const cell = book.cells.find((item) => item.ref === 'A2');
  expect(cell?.t).toBe('s');
  expect(book.numFmts[Number(cell?.s)]).toBe('49');
  expect(cell?.text).toBe('0001');
});
