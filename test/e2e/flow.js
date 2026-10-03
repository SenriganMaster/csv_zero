import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const workDir = path.join(root, '.work', 'e2e');

/** @param {string} name */
export function fixturePath(name) {
  return path.join(root, 'test', 'fixtures', name);
}

/** @param {import('@playwright/test').Page} page */
export async function openApp(page) {
  await page.goto('/');
}

/** @param {import('@playwright/test').Page} page @param {string} name */
export async function statText(page, name) {
  return (await page.locator(`[data-stat="${name}"]`).innerText()).trim();
}

/** @param {import('@playwright/test').Page} page @param {string} file @param {number} [timeout] */
export async function timeUntilReady(page, file, timeout) {
  const started = performance.now();
  await page.locator('[data-testid="file-input"]').setInputFiles(file);
  const ready = page.locator('[data-testid="tool"][data-phase="ready"]');
  if (timeout === undefined) await ready.waitFor();
  else await ready.waitFor({ timeout });
  return performance.now() - started;
}

/** @param {import('@playwright/test').Page} page @param {string} name */
export async function uploadFixture(page, name) {
  await timeUntilReady(page, fixturePath(name));
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} testId
 * @param {number} [timeout]
 */
export async function timedDownload(page, testId, timeout) {
  const started = performance.now();
  const downloadPromise = timeout === undefined
    ? page.waitForEvent('download')
    : page.waitForEvent('download', { timeout });
  await page.locator(`[data-testid="${testId}"]`).click();
  const download = await downloadPromise;
  return { ms: performance.now() - started, download };
}

/** @param {import('@playwright/test').Page} page @param {string} testId */
export async function downloadBytes(page, testId) {
  const { download } = await timedDownload(page, testId);
  fs.mkdirSync(workDir, { recursive: true });
  const dest = path.join(workDir, `${process.pid}-${Date.now()}-${testId}.bin`);
  await download.saveAs(dest);
  try {
    return fs.readFileSync(dest);
  } finally {
    fs.unlinkSync(dest);
  }
}

/** @param {import('@playwright/test').Page} page */
export async function installMeters(page) {
  await page.evaluate(() => {
    const gaps = [];
    let last = performance.now();
    const tick = (/** @type {number} */ now) => {
      gaps.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const longtasks = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) longtasks.push(entry.duration);
    });
    observer.observe({ type: 'longtask' });
    window.__csvZeroMeters = { gaps, longtasks };
  });
}

/** @param {import('@playwright/test').Page} page */
export async function readMeters(page) {
  return page.evaluate(() => {
    const { gaps, longtasks } = window.__csvZeroMeters;
    let maxGap = 0;
    for (const gap of gaps) if (gap > maxGap) maxGap = gap;
    let longMs = 0;
    for (const duration of longtasks) longMs += duration;
    return { maxGap, longCount: longtasks.length, longMs, frames: gaps.length };
  });
}
