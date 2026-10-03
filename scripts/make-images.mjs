import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (name) => path.join(root, 'public', name);

const BRAND = '#0b7b61';
const INK = '#17222c';

const MARK = `<rect x="3.25" y="5.25" width="23" height="19" rx="2.5" fill="#fff"/>
  <rect x="10.55" y="8.55" width="8.4" height="12.4" rx="4.2" fill="none" stroke="${BRAND}" stroke-width="2.7"/>
  <rect x="22.25" y="20.25" width="6.5" height="6.5" rx="1" fill="#fff" stroke="${BRAND}" stroke-width="1.6"/>`;

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="${BRAND}"/>
  ${MARK}
</svg>
`;

/** iOS rounds the corners itself and shows transparency as black, so this one is full-bleed. */
const TOUCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${BRAND}"/>
  <g transform="translate(16 16) scale(0.74) translate(-16 -16)">${MARK}</g>
</svg>`;

const svgUrl = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;

const page = (body, css) => `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
  html, body { margin: 0; background: transparent; }
  ${css}
</style></head><body>${body}</body></html>`;

const iconPage = (svg, size) => page(`<img src="${svgUrl(svg)}" width="${size}" height="${size}">`, 'img { display: block; }');

const SHEET_ROWS = [
  ['0001', '0600000', '0012345'],
  ['0005', '0010001', '0098765'],
  ['0009', '0640941', '0003311'],
];

const OG_HTML = page(`
<main class="og">
  <section class="copy">
    <p class="brand"><img src="${svgUrl(FAVICON_SVG)}" width="56" height="56" alt="">無料のブラウザツール</p>
    <h1>CSV 0落ち防止<br>コンバーター</h1>
    <p class="sub">先頭の0・長い数字・日付を<br>そのままExcelへ</p>
    <ul class="facts"><li>登録不要</li><li>Shift_JIS対応</li><li>ファイル送信なし</li></ul>
  </section>
  <section class="visual">
    <p class="callout">Excelで開いても <b>0001</b> のまま</p>
    <div class="sheet">
      <div class="corner"></div><div class="colh">A</div><div class="colh">B</div><div class="colh">C</div>
      <div class="rowh">1</div><div class="cell head">銀行コード</div><div class="cell head">郵便番号</div><div class="cell head">口座番号</div>
      ${SHEET_ROWS.map((row, r) => `<div class="rowh">${r + 2}</div>${row.map((value, c) => `<div class="cell${r === 0 && c === 0 ? ' selected' : ''}">${value}</div>`).join('')}`).join('')}
    </div>
    <p class="caption">すべてのセルを「文字列」で保存</p>
  </section>
</main>`, `
  body { width: 1200px; height: 630px; }
  .og {
    box-sizing: border-box; display: grid; grid-template-columns: 1fr 440px; align-items: center; gap: 48px;
    width: 1200px; height: 630px; padding: 0 72px 0 80px;
    background: linear-gradient(135deg, #f7faf9 0%, #eaf5f0 100%);
    color: ${INK}; font-family: "Noto Sans CJK JP", sans-serif; font-feature-settings: "palt";
  }
  p, h1, ul { margin: 0; }
  .brand { display: flex; align-items: center; gap: 16px; color: ${BRAND}; font-size: 26px; font-weight: 700; letter-spacing: 0.04em; }
  .brand img { border-radius: 12px; }
  h1 { margin-top: 28px; font-size: 68px; font-weight: 900; line-height: 1.2; letter-spacing: 0.02em; white-space: nowrap; }
  .sub { margin-top: 24px; color: #37474f; font-size: 32px; font-weight: 700; line-height: 1.5; letter-spacing: 0.03em; white-space: nowrap; }
  .facts { display: flex; gap: 12px; margin-top: 36px; padding: 0; list-style: none; }
  .facts li { padding: 6px 16px; border: 2px solid #b5dccd; border-radius: 999px; background: #fff; color: #08664f; font-size: 20px; font-weight: 700; white-space: nowrap; }
  .visual { display: grid; justify-items: center; gap: 22px; }
  .callout { padding: 10px 24px; border-radius: 999px; background: ${BRAND}; color: #fff; font-size: 26px; font-weight: 700; letter-spacing: 0.03em; }
  .callout b { font-size: 30px; font-variant-numeric: tabular-nums; }
  .sheet {
    display: grid; grid-template-columns: 40px repeat(3, 1fr); width: 440px; overflow: hidden;
    border: 1px solid #cbd4dc; border-radius: 16px; background: #fff;
    box-shadow: 0 24px 48px -20px rgb(15 23 42 / 0.28);
    font-size: 26px; font-variant-numeric: tabular-nums;
  }
  .sheet > div { height: 62px; display: flex; align-items: center; border-right: 1px solid #e3e8ec; border-bottom: 1px solid #e3e8ec; }
  .corner, .colh, .rowh { background: #f3f6f8; color: #7a8792; font-size: 18px; font-weight: 700; justify-content: center; }
  .colh, .corner { height: 40px !important; }
  .cell { padding: 0 16px; }
  .cell.head { color: #5b6974; font-size: 20px; font-weight: 700; }
  .cell.selected { position: relative; outline: 4px solid ${BRAND}; outline-offset: -3px; font-weight: 700; color: ${BRAND}; }
  .cell.selected::after { content: ""; position: absolute; right: -6px; bottom: -6px; width: 12px; height: 12px; background: ${BRAND}; border: 2px solid #fff; z-index: 1; }
  .caption { color: #5b6974; font-size: 22px; font-weight: 700; letter-spacing: 0.03em; }
`);

async function main() {
  fs.writeFileSync(out('favicon.svg'), FAVICON_SVG);
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome' });
  try {
    const shots = [
      { name: 'favicon.png', html: iconPage(FAVICON_SVG, 32), width: 32, height: 32, transparent: true },
      { name: 'apple-touch-icon.png', html: iconPage(TOUCH_SVG, 180), width: 180, height: 180, transparent: false },
      { name: 'og.png', html: OG_HTML, width: 1200, height: 630, transparent: false },
    ];
    for (const shot of shots) {
      const tab = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
      await tab.setContent(shot.html, { waitUntil: 'load' });
      await tab.evaluate(() => document.fonts.ready);
      await tab.screenshot({ path: out(shot.name), omitBackground: shot.transparent, clip: { x: 0, y: 0, width: shot.width, height: shot.height } });
      await tab.close();
      console.log(`public/${shot.name}`);
    }
  } finally {
    await browser.close();
  }
  console.log('public/favicon.svg');
}

await main();
