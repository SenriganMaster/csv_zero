import http from 'node:http';
import { expect, test } from '@playwright/test';
import { fixturePath } from './flow.js';

const PARENT = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>parent</title>
<script>
window.heights = [];
addEventListener('message', function (event) {
  var data = event.data;
  if (data && data.type === 'csv-zero:height' && typeof data.height === 'number') window.heights.push(data.height);
});
</script>
</head>
<body>
<iframe src="http://127.0.0.1:4173/?embed=1" title="csv-zero" style="width:960px;border:0"></iframe>
</body>
</html>`;

test('embed mode posts a height that grows and does not shrink', async ({ page }) => {
  // Chrome blocks a public origin such as parent.test from framing 127.0.0.1 (Private Network Access).
  // Another loopback port is still a different origin, so postMessage crosses a real origin boundary.
  const parent = await listen(PARENT);
  try {
    await page.goto(parent.url);
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('html')).toHaveAttribute('data-embed', '1');
    await expect(frame.locator('.site-header')).toBeHidden();
    await expect(frame.locator('.seo')).toBeHidden();
    await frame.locator('body[data-worker-ready="1"]').waitFor();
    await page.waitForFunction(() => window.heights.some((height) => height > 300));
    const before = await page.evaluate(() => window.heights.slice());
    await frame.locator('[data-testid="file-input"]').setInputFiles(fixturePath('sjis-bank.csv'));
    await frame.locator('[data-testid="tool"][data-phase="ready"]').waitFor();
    await page.waitForFunction((floor) => window.heights.some((height) => height > floor), before[before.length - 1]);
    const after = await page.evaluate(() => window.heights.slice());
    console.log(`embed heights first=${after[0]} before=${before[before.length - 1]} last=${after[after.length - 1]} max=${Math.max(...after)} n=${after.length} values=${after.join(',')}`);
    expect(after.some((height) => height > 300)).toBe(true);
    expect(Math.max(...after)).toBeGreaterThan(before[before.length - 1]);
    for (const height of after) expect(height).toBeGreaterThanOrEqual(after[0]);
  } finally {
    await parent.close();
  }
});

/** @param {string} body */
function listen(body) {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('expected a TCP port'));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        close() {
          return new Promise((done, fail) => {
            server.close((error) => (error ? fail(error) : done()));
            server.closeAllConnections();
          });
        },
      });
    });
  });
}
