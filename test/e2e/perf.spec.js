import path from 'node:path';
import { expect, test } from '@playwright/test';
import { writeBenchCsv } from './bench-csv.js';
import { installMeters, readMeters, timeUntilReady, timedDownload, workDir } from './flow.js';

test('a 20MB csv reaches ready and xlsx without a long frame gap', async ({ page }) => {
  test.setTimeout(180_000);
  const csv = writeBenchCsv(path.join(workDir, 'bench-200000.csv'), 200_000);
  await page.goto('/');
  await page.locator('body[data-worker-ready="1"]').waitFor();
  await installMeters(page);
  const readyMs = await timeUntilReady(page, csv.path, 90_000);
  const xlsx = await timedDownload(page, 'download-xlsx', 120_000);
  const meters = await readMeters(page);
  console.log(`perf bytes=${csv.bytes} rows=${csv.rows} ready=${readyMs.toFixed(0)}ms xlsx=${xlsx.ms.toFixed(0)}ms maxGap=${meters.maxGap.toFixed(1)}ms frames=${meters.frames} longTasks=${meters.longCount} longTaskMs=${meters.longMs.toFixed(0)}`);
  expect(readyMs + xlsx.ms).toBeLessThan(15_000);
  expect(meters.frames).toBeGreaterThan(0);
  expect(meters.maxGap).toBeLessThan(500);
  await xlsx.download.delete();
});
