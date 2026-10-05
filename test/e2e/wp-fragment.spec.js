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
  expect(await page.locator('#csv-zero-app').evaluate((element) => getComputedStyle(element).overflowWrap)).toBe('anywhere');
  expect(await page.locator('.dropzone-title').evaluate((element) => element.closest('[lang]')?.getAttribute('lang'))).toBe('ja');
  expect(await page.locator('.cz-root').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      letterSpacing: style.letterSpacing,
      textAlign: style.textAlign,
      fontWeight: style.fontWeight,
      textTransform: style.textTransform,
      whiteSpace: style.whiteSpace,
      lineBreak: style.lineBreak,
    };
  })).toEqual({
    overflowWrap: 'normal',
    wordBreak: 'normal',
    letterSpacing: 'normal',
    textAlign: 'start',
    fontWeight: '400',
    textTransform: 'none',
    whiteSpace: 'normal',
    lineBreak: 'auto',
  });
  expect(await page.locator('.dropzone-title').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      textTransform: style.textTransform,
      whiteSpace: style.whiteSpace,
    };
  })).toEqual({
    overflowWrap: 'normal',
    wordBreak: 'auto-phrase',
    textTransform: 'none',
    whiteSpace: 'normal',
  });
  expect(await page.locator('.cz-root').getAttribute('lang')).toBeNull();
  expect(await page.locator('[data-testid="tool"]').getAttribute('lang')).toBe('ja');
  await page.locator('.entry-content').evaluate((element) => {
    element.style.width = '354px';
  });
  const hintLines = await page.locator('.dropzone-hint').evaluate((element) => {
    const textNode = element.firstChild;
    if (!(textNode instanceof Text)) return { width: 0, lines: [] };
    const text = textNode.data;
    /** @type {string[]} */
    const lines = [];
    let line = '';
    let lineTop = 0;
    for (let index = 0; index < text.length; index += 1) {
      const range = document.createRange();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + 1);
      const rect = range.getClientRects()[0];
      if (!rect) continue;
      if (line && rect.top - lineTop > rect.height * 0.5) {
        lines.push(line);
        line = '';
      }
      if (!line) lineTop = rect.top;
      line += text[index];
    }
    if (line) lines.push(line);
    return { width: element.getBoundingClientRect().width, lines };
  });
  expect(hintLines.width, JSON.stringify(hintLines)).toBeGreaterThan(280);
  expect(hintLines.width, JSON.stringify(hintLines)).toBeLessThan(296);
  expect(hintLines.lines[1], JSON.stringify(hintLines)).toMatch(/^文字コード/);
  await page.locator('.entry-content').evaluate((element) => {
    element.style.width = '760px';
  });
  expect(await dropzone.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      letterSpacing: style.letterSpacing,
      fontWeight: style.fontWeight,
      textTransform: style.textTransform,
      whiteSpace: style.whiteSpace,
    };
  })).toEqual({
    overflowWrap: 'normal',
    wordBreak: 'normal',
    letterSpacing: 'normal',
    fontWeight: '400',
    textTransform: 'none',
    whiteSpace: 'normal',
  });

  await page.locator('[data-testid="file-input"]').setInputFiles(path.join(root, 'test', 'fixtures', 'sjis-bank.csv'));
  await page.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
  const xlsx = page.locator('[data-testid="download-xlsx"]');
  await expect(xlsx).toBeFocused();
  expect(await page.locator('#csv-zero-app').evaluate((element) => ({
    focus: element.matches(':focus'),
    outlineStyle: getComputedStyle(element).outlineStyle,
  }))).toEqual({ focus: true, outlineStyle: 'none' });
  expect(await xlsx.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
    };
  })).toEqual({
    outlineStyle: 'solid',
    outlineWidth: '2px',
    outlineColor: 'rgb(11, 123, 97)',
  });
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

test('a module script mounts when currentScript is null', async ({ page }) => {
  await publishWordPress(root, path.join(root, 'dist-wp'));
  const line = fs.readFileSync(path.join(root, 'dist-wp', 'csv-zero-wp.html'), 'utf8');
  const program = programFromFragment(line);
  fs.mkdirSync(harnessDir, { recursive: true });
  const server = await startServer(harnessDir, 0);

  fs.writeFileSync(path.join(harnessDir, 'index.html'), renderHarness(''));
  /** @type {string[]} */
  const createdErrors = [];
  page.on('pageerror', (error) => createdErrors.push(error.message));
  await page.goto(server.url);
  await bootAsModule(page, program);
  expect(createdErrors, createdErrors.join('\n')).toEqual([]);
  await expect(page.locator('#csv-zero-app')).toHaveCount(1);
  expect(await page.evaluate(() => document.body.lastElementChild?.id)).toBe('csv-zero-app');
  await expect(page.locator('[data-testid="dropzone"]')).toBeVisible();
  expect(await page.locator('.cz-root').getAttribute('lang')).toBeNull();
  expect(await page.locator('[data-testid="tool"]').getAttribute('lang')).toBe('ja');

  fs.writeFileSync(path.join(harnessDir, 'index.html'), renderHarness('<div id="csv-zero-app">このツールを使うには、ブラウザのJavaScriptを有効にしてください。</div>'));
  /** @type {string[]} */
  const existingErrors = [];
  page.on('pageerror', (error) => existingErrors.push(error.message));
  await page.goto(server.url);
  await bootAsModule(page, program);
  expect(existingErrors, existingErrors.join('\n')).toEqual([]);
  await expect(page.locator('#csv-zero-app')).toHaveCount(1);
  expect(await page.locator('#csv-zero-app').evaluate((element) => element.parentElement?.className)).toBe('entry-content');
  await expect(page.locator('[data-testid="dropzone"]')).toBeVisible();
  expect(await page.locator('.dropzone-title').evaluate((element) => element.closest('[lang]')?.getAttribute('lang'))).toBe('ja');
  await server.close();
});

/** @param {string} line */
function programFromFragment(line) {
  const match = line.match(/src="data:text\/javascript;base64,([A-Za-z0-9+/=]+)"/);
  if (!match) throw new Error('fragment has no program');
  return Buffer.from(match[1], 'base64').toString('utf8');
}

/** @param {import('@playwright/test').Page} page @param {string} program */
async function bootAsModule(page, program) {
  await page.evaluate(async (source) => {
    const blob = new Blob([source], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = url;
      script.onload = () => resolve(undefined);
      script.onerror = () => reject(new Error('module boot failed'));
      document.body.append(script);
    });
  }, program);
}
