# TODO

仕様は `docs/BRIEF.md`。完了条件は同ファイルの Done predicate。

## csv-zero v1

- [x] セッション開始（TODO.md / progress_log.txt / decisions.tsv / .gitignore） (2026-10-03 完了)
- [x] 設計: architect（3案を並列比較）でデータ形状・worker プロトコル・モジュール構成を確定 (2026-10-03 完了)
- [x] 足場: package.json / esbuild ビルド / 静的サーバ / スクリーンショットスクリプト (2026-10-03 完了)
- [x] コアエンジン: 文字コード判定・区切り判定・RFC 4180 パーサ・Excel崩れ判定・xlsx / CSV 書き出し + 単体テスト (2026-10-04 完了)
- [x] UI: index.html / styles.css / main.js / worker.js、埋め込みモード、SEO 本文、JSON-LD、CSP (2026-10-04 完了)
- [x] アセット: favicon（SVG + PNG）、OGP 画像 1200x630 (2026-10-04 完了)
- [x] E2E: Playwright（Shift_JIS・貼り付け・タブ・セル内改行・オフライン・外部通信ゼロ・スクリーンショット） (作業中)
- [x] 性能: 20MB CSV の計測（プレビュー / xlsx）、UI 応答性、100MB の挙動 (作業中)
- [x] デプロイ: deploy.yml（main への push のみ）/ ci.yml（pull_request）/ .htaccess (2026-10-03 完了)
- [ ] README.md・decisions.tsv 監査・REPORT
