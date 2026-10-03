# Brief: CSV 0落ち防止コンバーター (csv-zero)

GOAL: A static, browser-only Japanese web tool at https://geneshokai.com/csv-zero/ that turns a CSV into an .xlsx where every cell is stored as TEXT (string cell + number format "@"), so leading zeros (金融機関コード 0001, 支店コード 001, 郵便番号 0600000, 電話番号 09012345678, 社員番号 000123) never disappear and Excel never converts values (1-2 → date, 1234567890123456 → 1.23E+15, 1E5 → number, =SUM → formula). Plus a deploy workflow (GitHub Actions → Xserver FTPS) that runs only on push to main.

## Audience / context
- Readers of the WordPress blog 快適生活＠IT力 (https://senrinomitiwohitoaside.com/), who use its 金融機関コード and 郵便番号 pages and hit the "Excelで開くと先頭の0が消える" problem. Non-engineers, many on Windows + Excel, some on phones.
- The page will be linked and also embedded via iframe from WordPress.

## Product outcomes (you choose the implementation)
1. Input: drag & drop, file picker, and a paste-text box. Auto-detect encoding (UTF-8, UTF-8 with BOM, Shift_JIS/CP932 — TextDecoder('shift_jis') exists in all modern browsers) and delimiter (comma, tab, semicolon). Manual override for both, re-parsing instantly. RFC 4180 parsing: quoted fields, "" escapes, embedded newlines inside quotes, CRLF / LF / CR mixed, trailing newline, ragged rows (pad), empty file.
2. Preview: first N rows (e.g. 100) as a table that shows values exactly as text (zeros intact, no number formatting), sticky header, horizontal scroll on mobile. Show detected encoding, delimiter, row count, column count, file size. Show a clear note if a cell would have been mangled by Excel (e.g. a small badge/count: 「Excelで直接開くと崩れる値: 1,234件（先頭0・日付化・指数表記）」) — this is the "aha" for users.
3. Header row option (1行目を見出しとして扱う, default on) — affects preview and an optional bold/frozen header row in xlsx.
4. Output A: download .xlsx. Every cell is a string cell (shared strings or inline strings, NOT numbers) with a cell style whose numFmtId=49 ("@"). Also set the column default style to text so newly typed values in those columns stay text. Strings beginning with = + - @ must be stored as plain strings, never formulas. Per-column toggle: 文字列（既定） / 自動（数値にしてよい列）; default all text. Reasonable column widths, frozen header row when header option is on. Filename: <original>_text.xlsx. Sheet name derived from file name (sanitized, ≤31 chars). Respect Excel limits (1,048,576 rows, 16,384 cols, 32,767 chars per cell) with clear Japanese errors/warnings instead of silent truncation.
5. Output B: re-save as CSV UTF-8 with BOM (CRLF line endings, proper quoting), filename <original>_utf8bom.csv. Explain in UI that CSV can't carry "text" type, so Excel may still drop zeros when double-clicking a CSV; xlsx is the recommended output.
6. 100% client-side. No network requests after page load other than same-origin static assets: no CDN, no Google Fonts, no analytics, no external images. All libraries vendored/bundled into the build output. Add a strict Content-Security-Policy meta (e.g. default-src 'self'; connect-src 'self' — no third-party origins; workers/blob as needed). The page can then honestly state 「ファイルはどこにも送信されません（ブラウザ内だけで処理）」. After the page has loaded, conversion must work with the network turned off (verify with Playwright offline mode). A service worker for true offline revisits is optional.
7. Large files: a 20 MB / ~200k-row CSV must parse, preview and export without freezing the UI (do parsing and xlsx generation in a Web Worker, show progress, keep memory reasonable — e.g. stream rows into the zip writer rather than building giant DOM/arrays where possible). Target: 20 MB end-to-end in well under ~15 s on a normal laptop. 100 MB should either work or fail gracefully with a clear message.
8. Clear Japanese error messages: wrong file type (xlsx dropped in, binary file), undecodable bytes, empty file, too many rows, etc.
9. Japanese UI, clean and trustworthy, mobile friendly, fast (small JS, no framework needed). Visual quality is a hard requirement: it must look like a polished, modern, professionally designed utility (consider good spacing, typographic hierarchy, a calm accent colour, clear primary action, accessible contrast, focus states, dark-mode-safe or at least not broken, nice drop zone states, a tidy preview table). No emoji-as-icons clutter, no generic Bootstrap look, no lorem ipsum. System Japanese font stack (Hiragino Sans, "Noto Sans JP", "Yu Gothic UI", Meiryo, sans-serif) — no webfont download.
10. SEO content below the tool (real, useful Japanese prose, not filler): h1 around 「CSVの先頭の0が消えるのを防ぐ」 (tool name 「CSV 0落ち防止コンバーター」 visible); 使い方 (3 steps); なぜExcelで0が消えるのか (Excel guesses types when opening CSV: leading zeros, dates like 1-2, long numbers to exponent / 15-digit precision loss); Excelの他の対処法との比較 (データ取り込み/Power Query, 列を文字列指定, アポストロフィ — briefly, honestly); よくある質問 FAQ (送信されない? Shift_JIS対応? Macの Numbers/Googleスプレッドシート? 何MBまで? 保存後に再びCSVにすると? etc.). <title>, meta description, canonical https://geneshokai.com/csv-zero/, OGP + Twitter card tags, a 1200x630 OGP PNG generated by you and shipped in the build, favicon (SVG + PNG), JSON-LD (WebApplication + FAQPage), lang="ja".
11. Light link back to 快適生活＠IT力 (https://senrinomitiwohitoaside.com/) e.g. in footer / a "関連" line mentioning 金融機関コード・郵便番号 lookups. Only link URLs you know exist (use the site top URL; don't invent article URLs).
12. Embeddable: works inside an iframe from another origin (no frame-busting; do NOT set X-Frame-Options/frame-ancestors denial). Provide an embed mode `?embed=1` showing only the tool (compact, no SEO text/header/footer, transparent-friendly background) that posts its document height to the parent via postMessage ({type:'csv-zero:height', height}) so WordPress can auto-size; document a copy-paste iframe snippet (in README and in a small 「ブログに埋め込む」 section on the page).

## Repo / build / deploy
- Repo: this directory (/workspace/csv-zero), will be pushed to GitHub as Routemahiro/csv_zero (public). There is NO remote yet. Work on the current branch `feat/csv-zero-v1` only; never commit to or merge into `main`, never push, never deploy.
- Build: `npm ci && npm run build` produces the deployable static site in `deploy/` (or `dist/` then staged to `deploy/`). Every file in it is served from https://geneshokai.com/csv-zero/ — use relative asset paths so it also works at any sub-path and from `python3 -m http.server`. Commit package-lock.json. Keep devDependencies minimal; runtime libs (if any, e.g. a zip library) must be bundled into the output.
- Add an Apache `.htaccess` in the output only if useful (correct MIME for .mjs/.webmanifest, cache headers for hashed assets, short cache for index.html). Do not add anything that blocks iframing.
- Deploy workflow `.github/workflows/deploy.yml`, modelled on the user's existing ato_sukoshi workflow (pasted below): on push to main + workflow_dispatch, concurrency group deploy-csv-zero, verify secrets FTP_SERVER / FTP_USERNAME / FTP_PASSWORD exist, `npm ci`, `npm run build`, run tests, then SamKirkland/FTP-Deploy-Action@v4.3.6 with protocol ftps, port 21, timeout 120000, local-dir deploy/, server-dir ./ (the FTP account will be scoped to public_html/csv-zero), 3 attempts with continue-on-error, final failure step. Also a CI workflow (or job) that runs build + tests on pull_request without deploying.
- README.md (Japanese OK): what it is, local dev, build, deploy (Actions secrets FTP_SERVER/FTP_USERNAME/FTP_PASSWORD; FTP account must be scoped to geneshokai.com/public_html/csv-zero/), iframe snippet, privacy design.

```yaml
# ato_sukoshi/.github/workflows/deploy.yml (reference)
name: Deploy to Xserver FTP
on:
  push:
    branches: [main]
  workflow_dispatch:
concurrency:
  group: deploy-ato-sukoshi
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Verify FTP secrets
        run: |   # errors if secrets.FTP_SERVER / FTP_USERNAME / FTP_PASSWORD empty
      - run: npm run build
      - run: node scripts/stage-deploy.mjs   # copies shipped files into deploy/
      - name: Upload (attempt 1)
        id: ftp1
        continue-on-error: true
        uses: SamKirkland/FTP-Deploy-Action@v4.3.6
        with: { server: ${{ secrets.FTP_SERVER }}, username: ${{ secrets.FTP_USERNAME }}, password: ${{ secrets.FTP_PASSWORD }}, protocol: ftps, port: 21, timeout: 120000, local-dir: deploy/, server-dir: ./ }
      # attempt 2 if ftp1 failed (continue-on-error), attempt 3 if both failed, then a step that exits 1 if all three failed
```

## Verification you must do yourself (real artifact, not just unit tests)
- Unit tests (node --test or vitest) for: encoding detection (UTF-8, UTF-8 BOM, CP932 incl. ①・髙 etc.), delimiter detection, CSV parser edge cases, xlsx writer (unzip output and assert sheet XML has t="s"/inlineStr cells, style with numFmtId="49", no <f> formulas, values exact).
- An end-to-end Playwright test (Chromium; a system Chrome is at /usr/bin/google-chrome if the bundled browser download fails) against the built `deploy/` served locally: upload a Shift_JIS CSV containing 0001 codes, download the xlsx, unzip and assert cells; paste-text flow; tab-delimited; quoted newline; offline mode after load; capture desktop (1440px) and mobile (390px) screenshots into `screens/` (gitignored is fine) and LOOK at them critically, iterating until the design is genuinely polished.
- Generate a ~20 MB CSV and measure time to preview and to xlsx download; confirm UI stays responsive.
- Confirm zero third-party requests (log all requests in Playwright).

## Done predicate
`npm ci && npm run build && npm test` pass from a clean checkout; `deploy/index.html` served via `python3 -m http.server` converts all sample CSVs to xlsx whose every cell is a string with number format "@" and exact original text (zeros intact); 20 MB file converts without freezing; no external network requests; desktop + mobile screenshots look professionally designed; deploy.yml matches the spec; everything committed on `feat/csv-zero-v1` in small Conventional Commits.

## Constraints
- Write only inside /workspace/csv-zero. Don't touch main; no push, no deploy, no external messages, no secrets.
- No CDN / third-party runtime requests. No tracking.
- Keep a decisions.tsv (ts, phase, decision, why, evidence, result) at repo root.
- When done, print a REPORT: what was built, choices and why, commands run with outcomes, open decisions, known weaknesses.
