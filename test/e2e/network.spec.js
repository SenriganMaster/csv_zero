import { expect, test } from '@playwright/test';
import { fixturePath } from './flow.js';

test('loaded page stays on the local origin', async ({ page }) => {
  const urls = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', (request) => {
    urls.push(request.url());
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });

  await page.goto('/');
  await page.waitForSelector('body[data-worker-ready="1"]');

  expect(urls).toContain('http://127.0.0.1:4173/');
  expect(urls.map((url) => new URL(url).origin)).toEqual(
    urls.map(() => 'http://127.0.0.1:4173'),
  );
  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(await page.locator('body').getAttribute('data-worker-ready')).toBe('1');
});

const ORIGIN = 'http://127.0.0.1:4173';

/** @param {string} url */
function allowed(url) {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  return new URL(url).origin === ORIGIN;
}

test('a full conversion makes no third-party request', async ({ page, context }) => {
  /** @type {string[]} */
  const thirdParty = [];
  /** @type {string[]} */
  const urls = [];
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (allowed(url)) return route.continue();
    thirdParty.push(url);
    return route.abort();
  });
  context.on('request', (request) => {
    urls.push(request.url());
  });

  await page.goto('/');
  await page.locator('body[data-worker-ready="1"]').waitFor();
  await page.locator('[data-testid="file-input"]').setInputFiles(fixturePath('utf8-plain.csv'));
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
  await clickDownload(page, 'download-xlsx');
  await clickDownload(page, 'download-csv');
  await page.locator('[data-testid="col-mode-0"]').click();
  await expect(page.locator('[data-testid="col-mode-0"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-testid="reset"]').click();
  await page.locator('[data-testid="tool"][data-phase="empty"]').waitFor();
  await page.locator('[data-testid="paste-tab"]').click();
  await page.locator('[data-testid="paste-input"]').fill('コード\t番号\n0001\t1-2\n');
  await page.locator('[data-testid="paste-submit"]').click();
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();

  expect(thirdParty).toEqual([]);
  expect(urls.filter((url) => !allowed(url))).toEqual([]);
  expect(urls.length).toBeGreaterThan(0);
});

/** @param {import('@playwright/test').Page} page @param {string} testId */
async function clickDownload(page, testId) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator(`[data-testid="${testId}"]`).click(),
  ]);
  await download.delete();
}
