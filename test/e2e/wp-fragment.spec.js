import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fixture } from '../helpers/fixtures.js';
import { startServer } from '../../scripts/serve.mjs';
import { applyHostile } from '../../scripts/wp-harness/hostile.mjs';
import { renderHarness } from '../../scripts/wp-harness/render.mjs';
import { publishWordPress } from '../../scripts/wp/publish.mjs';
import { assertTextWorkbook, readWorkbook } from './book.js';
import { downloadBytes } from './flow.js';
import { crlfRecordEnds, recordsFromBytes } from './records.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harnessDir = path.join(root, '.work', 'wp-harness');

test('a WordPress fragment survives hostile filters and converts inside the shadow root', async ({ page }) => {
  await publishWordPress(root, path.join(root, 'dist-wp'));
  const line = fs.readFileSync(path.join(root, 'dist-wp', 'csv-zero-wp.html'), 'utf8');
  expect(applyHostile(line)).toBe(line);
  fs.mkdirSync(harnessDir, { recursive: true });
  fs.writeFileSync(path.join(harnessDir, 'index.html'), renderHarness(line));
  const server = await startServer(harnessDir, 0);

  /** @type {string[]} */
  const requests = [];
  /** @type {string[]} */
  const errors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  expect(errors, errors.join('\n')).toEqual([]);
  expect(requests.filter((url) => !url.startsWith(server.url) && !url.startsWith('blob:') && !url.startsWith('data:'))).toEqual([]);

  const sameGlobals = await page.evaluate(() => {
    const before = /** @type {string[]} */ (/** @type {any} */ (window).__csvZeroKeys);
    const after = Object.getOwnPropertyNames(window);
    return after.filter((name) => !before.includes(name));
  });
  expect(sameGlobals).toEqual([]);

  const dropzone = page.locator('[data-testid="dropzone"]');
  await expect(dropzone).toBeVisible();
  expect(await dropzone.evaluate((element) => getComputedStyle(element).paddingTop)).not.toBe('0px');
  await expect(page.locator('.dropzone-title')).toHaveCSS('font-size', '20px');
  await expect(page.locator('#csv-zero-app')).toHaveCSS('font-size', '16px');

  await page.locator('[data-testid="file-input"]').setInputFiles(path.join(root, 'test', 'fixtures', 'sjis-bank.csv'));
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
  await expect(page.locator('[data-testid="preview"]')).toContainText('0001');
  expect(await page.locator('.preview-title').evaluate((element) => getComputedStyle(element).fontSize)).not.toBe('32px');
  expect(await page.locator('[data-testid="encoding"]').evaluate((element) => getComputedStyle(element).fontSize)).not.toBe('20px');

  const records = recordsFromBytes(fixture('sjis-bank.csv'), 'shift_jis', ',');
  const book = readWorkbook(await downloadBytes(page, 'download-xlsx'));
  assertTextWorkbook(book, records);

  const csv = await downloadBytes(page, 'download-csv');
  expect([...csv.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(crlfRecordEnds(new TextDecoder('utf-8').decode(csv))).toBe(true);

  await page.locator('[data-testid="reset"]').click();
  await page.locator('[data-testid="paste-tab"]').click();
  await page.locator('[data-testid="paste-input"]').fill('コード,番号\n0001,1-2');
  await page.locator('[data-testid="paste-submit"]').click();
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
  await expect(page.locator('[data-testid="preview"]')).toContainText('0001');
  await expect(page.locator('[data-testid="preview"]')).toContainText('1-2');

  const later = requests.filter((url) => !url.startsWith(server.url) && !url.startsWith('blob:') && !url.startsWith('data:'));
  expect(later).toEqual([]);
  await server.close();
});
