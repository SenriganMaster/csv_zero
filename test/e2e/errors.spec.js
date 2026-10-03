import { expect, test } from '@playwright/test';
import { fixturePath, openApp } from './flow.js';

const NOT_CSV_XLSX = 'これはExcel（.xlsx）やZIPのファイルです。CSVなどのテキストファイルを選んでください。';
const EMPTY_FILE = 'ファイルが空です。中身の入ったCSVファイルを選んでください。';
const NOT_CSV_BINARY = 'テキストではないファイルのようです（画像・PDF・圧縮ファイルなど）。CSVファイルを選んでください。';

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

test('a PDF made only of text bytes shows the binary rejection', async ({ page }) => {
  await openApp(page);
  const pdf = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n%%EOF\n');
  await page.locator('[data-testid="file-input"]').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: pdf });
  const notice = page.locator('[data-testid="notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(NOT_CSV_BINARY);
  await expect(page.locator('[data-testid="tool"]')).toHaveAttribute('data-phase', 'empty');
});
