import { expect, test } from '@playwright/test';
import { fixturePath, openApp } from './flow.js';

const NOT_CSV_XLSX = 'これはExcel（.xlsx）やZIPのファイルです。CSVなどのテキストファイルを選んでください。';
const EMPTY_FILE = 'ファイルが空です。中身の入ったCSVファイルを選んでください。';

test('fake.xlsx shows the ZIP rejection', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-testid="file-input"]').setInputFiles(fixturePath('fake.xlsx'));
  const notice = page.locator('[data-testid="notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(NOT_CSV_XLSX);
  await expect(page.locator('[data-testid="tool"]')).toHaveAttribute('data-phase', 'empty');
});

test('empty.csv shows the empty-file rejection', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-testid="file-input"]').setInputFiles(fixturePath('empty.csv'));
  const notice = page.locator('[data-testid="notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(EMPTY_FILE);
  await expect(page.locator('[data-testid="tool"]')).toHaveAttribute('data-phase', 'empty');
});
