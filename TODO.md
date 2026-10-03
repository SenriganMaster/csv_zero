# TODO

仕様は `docs/BRIEF.md`。完了条件は同ファイルの Done predicate。

## csv-zero v1

- [x] セッション開始（TODO.md / progress_log.txt / decisions.tsv / .gitignore） (2026-10-03 完了)
- [x] 設計: architect（3案を並列比較）でデータ形状・worker プロトコル・モジュール構成を確定 (2026-10-03 完了)
- [x] 足場: package.json / esbuild ビルド / 静的サーバ / スクリーンショットスクリプト (2026-10-03 完了)
- [x] コアエンジン: 文字コード判定・区切り判定・RFC 4180 パーサ・Excel崩れ判定・xlsx / CSV 書き出し + 単体テスト (2026-10-04 完了)
- [x] UI: index.html / styles.css / main.js / worker.js、埋め込みモード、SEO 本文、JSON-LD、CSP (2026-10-04 完了)
- [x] アセット: favicon（SVG + PNG）、OGP 画像 1200x630 (2026-10-04 完了)
- [x] E2E: Playwright（Shift_JIS・貼り付け・タブ・セル内改行・オフライン・外部通信ゼロ・スクリーンショット） (2026-10-04 完了)
- [x] 性能: 20MB CSV の計測（プレビュー / xlsx）、UI 応答性、100MB の挙動 (2026-10-04 完了)
- [x] デプロイ: deploy.yml（main への push のみ）/ ci.yml（pull_request）/ .htaccess (2026-10-03 完了)
- [x] README.md・decisions.tsv 監査・REPORT (作業中)

## クロスモデル監査（GPT）の指摘への対応
- [x] ワーカーをメインバンドルに内蔵し、読み込み直後に回線が切れても動くようにする (作業中)
- [ ] 埋め込み（別オリジンの iframe）の中でダウンロードできることを E2E で確かめる
- [x] PDF（先頭が %PDF-）をバイナリとして弾く (作業中)
- [x] 文字コード・区切りを手動で変えると読み直すことを E2E で確かめる (作業中)

## 未着手（レビューで出た改善候補）

ユーザーの判断待ち（REPORT の「未決事項」）:
- [ ] deploy.yml の FTP-Deploy-Action をコミット SHA に固定する（ブリーフは @v4.3.6 と書いている）
- [ ] styles.css（約 2,100 行）を tokens / tool / content / embed に分ける
- [ ] zip エントリを書き込み型にして xlsx.js の handoff() をなくす
- [ ] view.js のキャッシュ変数を減らし、プレビュー表を 2 回作るのをやめる
- [ ] 文字コードを手動で指定したら、規則 7（バイナリ判定）を外せるようにする
- [ ] 文字コード判定（ファイル全体のデコード）の間も進捗を出す

コメントの代わりにコードで意図を示す候補（Comment Sicko の MUST KILL、未対応 17 件 + 1 件）:
- [ ] main.js `preloadWorker`: オフライン用の blob: URL という目的を名前に出す
- [ ] session.js `startRead`: 書き出しもキャンセルすることを明示する
- [ ] text.js `EncodingVerdict.asciiOnly`: 強制指定・BOM・UTF-16 では常に false なので、意味どおりの名前にする
- [ ] text.js `sniff`: UTF-16 判定が制御バイト判定より先に走る順序を構造で固定する
- [ ] text.js `decodeText` の戻り値: 裸の number を名前付きの値にする
- [ ] text.js `createDamageCount`: スライスをまたぐバイト列の持ち越しを抽出して名前を付ける
- [ ] messages.js `formatBytes` の 1023.95 に名前を付ける
- [ ] convert.js `createTally(shown)`: 呼び出し側の配列を書き換えず、行を返す
- [ ] convert.js / view.js: 「1 文字多く送ると切り詰め」の合図を明示的なフラグにする
- [ ] excel.js `classify`: ja-JP 版 Excel が前提であることを名前か型で示す
- [ ] excel.js `AutoNumber.xf`: 生の 0 / 5 ではなく XF の名前を使う
- [ ] xlsx.js `XF`: STYLES の `<xf>` の並びと、片方からもう片方を作る
- [ ] zip.js `slice` / `range`: ビューを返す方とコピーを返す方の名前が逆なので改名する
- [ ] zip.js `DOS_DATE`: 年・月・日の部品から組み立てる
- [ ] zip.js `deflateEntry` の name: ASCII 限定を assert する
- [ ] xlsx.js `createXmlBytes().integer`: 負数・小数を拒否するか、uint に改名する
- [ ] scripts/test-unit.mjs `TEST_FILE_RE`: Node 20 の選び方と違う（test.a.js）。直すか、今の挙動を仕様にする
- [ ] test/e2e/bench-csv.js `LINE_BYTES`: 103 を 20 MiB / 100 MiB の目標から式で書く
