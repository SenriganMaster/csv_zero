import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';
import { writeBenchCsv } from '../test/e2e/bench-csv.js';
import { installMeters, readMeters, timeUntilReady, timedDownload, workDir } from '../test/e2e/flow.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CASES = [
  { rows: 200_000, endToEndMs: 15_000 },
  { rows: 1_000_000, endToEndMs: Infinity },
];
const MAX_GAP_MS = 200;

function mib(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} origin
 * @param {number} dataRows
 */
async function runCase(page, origin, dataRows) {
  const csv = writeBenchCsv(path.join(workDir, `bench-${dataRows}.csv`), dataRows);
  await page.goto(origin);
  await page.locator('body[data-worker-ready="1"]').waitFor();
  await installMeters(page);
  const readyMs = await timeUntilReady(page, csv.path, 240_000);
  const reportedRows = Number((await page.locator('[data-stat="rows"]').innerText()).replaceAll(',', ''));
  const xlsx = await timedDownload(page, 'download-xlsx', 480_000);
  const xlsxPath = path.join(workDir, `bench-${dataRows}.xlsx`);
  await xlsx.download.saveAs(xlsxPath);
  const xlsxBytes = fs.statSync(xlsxPath).size;
  fs.unlinkSync(xlsxPath);
  const csvOut = await timedDownload(page, 'download-csv', 480_000);
  await csvOut.download.delete();
  const meters = await readMeters(page);
  return {
    inputMB: mib(csv.bytes),
    rows: reportedRows,
    readyMs: Math.round(readyMs),
    xlsxMs: Math.round(xlsx.ms),
    csvMs: Math.round(csvOut.ms),
    maxGapMs: Math.round(meters.maxGap),
    longTasks: meters.longCount,
    longTaskMs: Math.round(meters.longMs),
    xlsxMB: mib(xlsxBytes),
    completed: 'yes',
    error: '',
  };
}

/** @param {Record<string, string | number>[]} rows */
function printTable(rows) {
  const header = ['inputMB', 'rows', 'readyMs', 'xlsxMs', 'csvMs', 'maxGapMs', 'longTasks', 'longTaskMs', 'xlsxMB', 'completed'];
  console.log(header.join('\t'));
  for (const row of rows) console.log(header.map((key) => row[key]).join('\t'));
  for (const row of rows) if (row.error) console.log(`error ${row.inputMB}MB: ${row.error}`);
}

async function main() {
  const server = await startServer(path.join(root, 'deploy'), 4190);
  const browser = await chromium.launch({ channel: 'chrome' });
  /** @type {Record<string, string | number>[]} */
  const rows = [];
  try {
    for (const item of CASES) {
      const context = await browser.newContext({ acceptDownloads: true });
      const page = await context.newPage();
      page.setDefaultTimeout(480_000);
      try {
        rows.push(await runCase(page, server.url, item.rows));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        rows.push({
          inputMB: item.rows === 200_000 ? '20' : '100',
          rows: item.rows + 1,
          readyMs: '',
          xlsxMs: '',
          csvMs: '',
          maxGapMs: '',
          longTasks: '',
          longTaskMs: '',
          xlsxMB: '',
          completed: 'no',
          error: message,
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    printTable(rows);
    await browser.close();
    await server.close();
  }
  const found = misses(rows);
  for (const line of found) console.error(`miss: ${line}`);
  if (found.length > 0) process.exitCode = 1;
}

/** @param {Record<string, string | number>[]} rows */
function misses(rows) {
  return rows.flatMap((row, index) => {
    const { rows: dataRows, endToEndMs } = CASES[index];
    if (row.completed !== 'yes') return [`${dataRows} rows did not complete`];
    const endToEnd = Number(row.readyMs) + Number(row.xlsxMs);
    return [
      ...(endToEnd < endToEndMs ? [] : [`${dataRows} rows took ${endToEnd} ms to ready + xlsx, target under ${endToEndMs} ms`]),
      ...(Number(row.maxGapMs) < MAX_GAP_MS ? [] : [`${dataRows} rows had a ${row.maxGapMs} ms frame gap, target under ${MAX_GAP_MS} ms`]),
    ];
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
