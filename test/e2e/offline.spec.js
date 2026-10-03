import { expect, test } from '@playwright/test';
import { readWorkbook } from './book.js';
import { downloadBytes, uploadFixture } from './flow.js';

test('a page that has just loaded over a slow link converts sjis-bank.csv offline', async ({ page, context }) => {
  await context.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.continue();
  });
  await page.goto('/');
  await context.setOffline(true);
  await uploadFixture(page, 'sjis-bank.csv');
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  const cell = book.cells.find((item) => item.ref === 'A2');
  expect(cell?.t).toBe('s');
  expect(book.numFmts[Number(cell?.s)]).toBe('49');
  expect(cell?.text).toBe('0001');
});
