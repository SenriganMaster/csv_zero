import { expect, test } from '@playwright/test';
import { openApp, uploadFixture } from './flow.js';

const DECODE_REPLACED = '文字コードを正しく読めなかった文字が';

test('a chosen encoding re-reads the file, and 自動 brings the detection back', async ({ page }) => {
  await openApp(page);
  const encoding = page.locator('[data-stat="encoding"]');
  const replaced = page.locator('[data-testid="warnings"]').getByText(DECODE_REPLACED);
  const preview = page.locator('[data-testid="preview"]');
  await uploadFixture(page, 'sjis-bank.csv');
  await expect(encoding).toHaveText('Shift_JIS（CP932）');
  await expect(preview).toContainText('金融機関名');

  await page.locator('[data-testid="encoding"]').selectOption('utf-8');
  await expect(encoding).toHaveText('UTF-8');
  await expect(replaced).toBeVisible();
  await expect(preview).toContainText('\uFFFD');
  await expect(preview).not.toContainText('金融機関名');

  await page.locator('[data-testid="encoding"]').selectOption('auto');
  await expect(encoding).toHaveText('Shift_JIS（CP932）');
  await expect(replaced).toHaveCount(0);
  await expect(preview).toContainText('金融機関名');
});

test('a chosen delimiter re-splits the file, and 自動 brings the detection back', async ({ page }) => {
  await openApp(page);
  const delimiter = page.locator('[data-stat="delimiter"]');
  const cols = page.locator('[data-stat="cols"]');
  await uploadFixture(page, 'semicolon.csv');
  await expect(delimiter).toHaveText('セミコロン（;）');
  await expect(cols).toHaveText('3');

  await page.locator('[data-testid="delimiter"]').selectOption(',');
  await expect(delimiter).toHaveText('カンマ（,）');
  await expect(cols).toHaveText('2');

  await page.locator('[data-testid="delimiter"]').selectOption('auto');
  await expect(delimiter).toHaveText('セミコロン（;）');
  await expect(cols).toHaveText('3');
});
