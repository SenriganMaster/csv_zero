import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const SCHEMES = ['light', 'dark'];

function message(error) {
  return error instanceof Error ? error.message : String(error);
}

async function capture(page, dest, target, written) {
  try {
    await page.goto(target, { waitUntil: 'load' });
    await page.screenshot({ path: dest, fullPage: true });
    written.push(dest);
  } catch (error) {
    console.warn(`warn: ${path.basename(dest)}: ${message(error)}`);
  }
}

async function main() {
  const only = process.argv[2];
  if (only && !Object.hasOwn(VIEWPORTS, only)) {
    console.error(`unknown viewport: ${only}`);
    process.exit(1);
  }
  const names = only ? [only] : Object.keys(VIEWPORTS);
  const screenDir = path.join(root, 'screens');
  fs.mkdirSync(screenDir, { recursive: true });
  const fixture = path.join(root, 'test', 'fixtures', 'sjis-bank.csv');
  const written = [];

  const server = await startServer(path.join(root, 'deploy'), 4180);
  const browser = await chromium.launch({
    channel: process.env.PW_CHANNEL || 'chrome',
  });
  try {
    for (const name of names) {
      const vp = VIEWPORTS[name];
      for (const scheme of SCHEMES) {
        const context = await browser.newContext({
          viewport: { width: vp.width, height: vp.height },
          deviceScaleFactor: vp.deviceScaleFactor,
          isMobile: vp.isMobile === true,
          hasTouch: vp.hasTouch === true,
          colorScheme: scheme,
        });
        const page = await context.newPage();
        try {
          const prefix = `${name}-${scheme}`;
          await capture(page, path.join(screenDir, `${prefix}-initial.png`), server.url, written);
          const preview = path.join(screenDir, `${prefix}-preview.png`);
          if (!fs.existsSync(fixture)) {
            console.warn(`warn: ${prefix}-preview.png: missing test/fixtures/sjis-bank.csv`);
          } else {
            try {
              await page.goto(server.url, { waitUntil: 'load' });
              await page.setInputFiles('input[type=file]', fixture);
              await page.waitForSelector('[data-phase="ready"]', { timeout: 20000 });
              await page.screenshot({ path: preview, fullPage: true });
              written.push(preview);
            } catch (error) {
              console.warn(`warn: ${prefix}-preview.png: ${message(error)}`);
            }
          }
          const embed = new URL('?embed=1', server.url).href;
          await capture(page, path.join(screenDir, `${prefix}-embed.png`), embed, written);
        } finally {
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  for (const file of written) {
    console.log(path.relative(root, file).split(path.sep).join('/'));
  }
  if (written.length === 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
