import { expect, test } from '@playwright/test';

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
