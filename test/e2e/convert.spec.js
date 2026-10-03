import { expect, test } from '@playwright/test';
import { fixture } from '../helpers/fixtures.js';
import { assertTextWorkbook, readWorkbook } from './book.js';
import { downloadBytes, openApp, statText, uploadFixture } from './flow.js';
import { crlfRecordEnds, delimiterFromLabel, encodingFromLabel, recordsFromBytes } from './records.js';

/** @param {import('./book.js').Workbook} book @param {string} ref */
function textAt(book, ref) {
  const cell = book.cells.find((item) => item.ref === ref);
  expect(cell, ref).toBeDefined();
  return cell.text;
}

test('Shift_JIS upload keeps every cell as text, including 0001 and the multiline memo', async ({ page }) => {
  await openApp(page);
  await uploadFixture(page, 'sjis-bank.csv');
  await expect(page.locator('[data-stat="encoding"]')).toHaveText('Shift_JIS（CP932）');
  const records = recordsFromBytes(fixture('sjis-bank.csv'), 'shift_jis', ',');
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  assertTextWorkbook(book, records);
  expect(textAt(book, 'A2')).toBe('0001');
  expect(textAt(book, 'H2')).toBe('0600000');
  expect(textAt(book, 'I2')).toBe('09012345678');
  expect(textAt(book, 'L4')).toBe('請求書 No.1023\n10月・11月分');
});

test('pasted tab-separated text downloads exact cells', async ({ page }) => {
  const pasted = ['コード\t日付\t番号\t式', '0001\t1-2\t1234567890123456\t=SUM(A1)'].join('\n');
  await openApp(page);
  await page.locator('[data-testid="paste-tab"]').click();
  await page.locator('[data-testid="paste-input"]').fill(pasted);
  await expect(page.locator('[data-testid="paste-submit"]')).toBeEnabled();
  await page.locator('[data-testid="paste-submit"]').click();
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
  await expect(page.locator('[data-stat="delimiter"]')).toHaveText('タブ');
  const records = recordsFromBytes(Buffer.from(pasted), 'utf-8', '\t');
  assertTextWorkbook(readWorkbook(await downloadBytes(page, 'download-xlsx')), records);
});

test('tab.tsv keeps 1,000 in one cell', async ({ page }) => {
  await openApp(page);
  await uploadFixture(page, 'tab.tsv');
  await expect(page.locator('[data-stat="delimiter"]')).toHaveText('タブ');
  const records = recordsFromBytes(
    fixture('tab.tsv'),
    encodingFromLabel(await statText(page, 'encoding')),
    delimiterFromLabel(await statText(page, 'delimiter')),
  );
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  assertTextWorkbook(book, records);
  expect(book.cells.filter((cell) => cell.text === '1,000')).toHaveLength(1);
});

test('quoted newlines keep LF and CRLF', async ({ page }) => {
  await openApp(page);
  await uploadFixture(page, 'quoted-newline.csv');
  const records = recordsFromBytes(
    fixture('quoted-newline.csv'),
    encodingFromLabel(await statText(page, 'encoding')),
    delimiterFromLabel(await statText(page, 'delimiter')),
  );
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  assertTextWorkbook(book, records);
  expect(textAt(book, 'B2')).toBe('line1\r\nline2');
  expect(textAt(book, 'B3')).toBe('first\nsecond');
});

test('CSV download is UTF-8 BOM with CRLF and the same records', async ({ page }) => {
  await openApp(page);
  await uploadFixture(page, 'sjis-bank.csv');
  const records = recordsFromBytes(
    fixture('sjis-bank.csv'),
    encodingFromLabel(await statText(page, 'encoding')),
    delimiterFromLabel(await statText(page, 'delimiter')),
  );
  const bytes = await downloadBytes(page, 'download-csv');
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(crlfRecordEnds(new TextDecoder('utf-8').decode(bytes))).toBe(true);
  expect(recordsFromBytes(bytes, 'utf-8', ',')).toEqual(records);
});

test('金額 in 自動 is a grouped number and other columns stay text', async ({ page }) => {
  await openApp(page);
  await uploadFixture(page, 'sjis-bank.csv');
  const names = await page.locator('[data-testid="preview"] .col-name').allTextContents();
  const amount = names.indexOf('金額');
  expect(amount).toBeGreaterThanOrEqual(0);
  const toggle = page.locator(`[data-testid="col-mode-${amount}"]`);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  const records = recordsFromBytes(fixture('sjis-bank.csv'), 'shift_jis', ',');
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  const sample = book.cells.find((cell) => cell.col === amount && cell.row === 2);
  expect(sample?.s).toBe('5');
  expect(sample?.v).toBe('12345');
  expect(sample?.t).toBeNull();
  for (const cell of book.cells) {
    if (cell.col === amount && cell.row > 1) {
      expect(cell.t, cell.ref).toBeNull();
      expect(cell.s, cell.ref).toBe('5');
      expect(cell.v, cell.ref).toBe(records[cell.row - 1][amount].replaceAll(',', ''));
    } else {
      expect(cell.t, cell.ref).toBe('s');
    }
  }
});

test('Enter on the drop zone opens the file chooser', async ({ page }) => {
  await openApp(page);
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.locator('[data-testid="dropzone"]').focus();
  await page.locator('[data-testid="dropzone"]').press('Enter');
  const dialog = await chooser;
  expect(await dialog.element().getAttribute('data-testid')).toBe('file-input');
});
