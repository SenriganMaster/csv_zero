# CSV 0落ち防止コンバーター（csv_zero）

https://geneshokai.com/csv-zero/

CSV を、すべてのセルが「文字列」の Excel ファイル（.xlsx）に変換するブラウザ完結の無料ツールです。金融機関コード `0001`、郵便番号 `0600000`、電話番号 `09012345678` のような値が、Excel で開いても元の文字のまま残ります。`1-2` が日付になったり、`1234567890123456` が `1.23457E+15` になったり、`=SUM(A1)` が計算されたりすることもありません。

## できること

- 文字コードの自動判定: UTF-8（BOM の有無どちらも）、Shift_JIS（CP932。`①` や `髙` も可）、UTF-16。EUC-JP は手動で選べます。
- 区切り文字の自動判定: カンマ、タブ、セミコロン。セル内の改行や `""` を含む引用符付きの値もそのまま読みます。
- 貼り付け: Excel や Web ページからコピーした表を、そのまま貼り付けて変換できます。
- プレビュー: 先頭 100 行と、Excel で直接開くと崩れる値の件数（先頭0・日付化・指数表記・数式化・表記変化）を表示します。
- 出力:
  - `<元の名前>_text.xlsx`: 全セルが文字列（表示形式「@」）。1 行目は太字で固定表示。
  - `<元の名前>_utf8bom.csv`: UTF-8（BOM 付き）の CSV。
- 列ごとの「自動」: 計算に使いたい列だけ数値にできます。数値になるのは、Excel での見た目が元の文字と変わらない値だけです（`0012` や `1.50` は文字列のまま）。

## プライバシーの設計

- ファイルの読み込み、判定、変換、ダウンロード用ファイルの作成は、すべてブラウザの中（Web Worker）で行います。サーバーへの送信はありません。
- ページを開いたあとの通信は同じサイト内の静的ファイルだけです。CDN、Web フォント、アクセス解析、広告、Cookie は使っていません。
- `Content-Security-Policy` の meta タグで、外部への接続（`connect-src`）と外部スクリプトを禁止しています。インラインスクリプトはビルド時に計算した sha256 ハッシュでだけ許可します。
- ワーカーのスクリプトはページを開いた時点でメモリに読み込むので、そのあとネットワークを切っても変換できます。
- ファイルの中身は `textContent` でだけ画面に出し、HTML として解釈しません。

## 開発

### 必要なもの

- Node.js 20 以上（CI は Node 24）
- Google Chrome（E2E テストとスクリーンショットで使います）
- 任意: Python 3（`http.server` での動作確認）、LibreOffice（単体テストの往復確認。無ければそのテストは自動でスキップされます）

### よく使うコマンド

PowerShell でも bash でも同じです。

```powershell
npm ci             # 依存関係のインストール（package-lock.json どおり）
npm run build      # deploy/ に公開用一式を出力
npm run serve      # deploy/ を http://127.0.0.1:8080/ で配信
npm test           # 型検査 + 単体テスト + E2E テスト
npm run screens    # screens/ にスクリーンショット（1440px / 390px、ライト / ダーク）
npm run perf       # 20MB / 100MB の CSV を作って変換時間を計測（先に npm run build が必要）
```

Python の簡易サーバで確認する場合:

```powershell
# Windows（PowerShell）
python -m http.server 8000 --directory deploy
```

```bash
# macOS / Linux
python3 -m http.server 8000 --directory deploy
```

Chrome が入っていない環境では、Playwright 同梱の Chromium を使えます。

```powershell
$env:PW_CHANNEL = "chromium"
npx playwright install chromium
npm test
```

E2E テストを Python のサーバで実行するには `E2E_SERVER=python npx playwright test` を使います（`python3` コマンドが必要なので、macOS / Linux / CI 向けです）。

### 構成

| 場所 | 内容 |
|---|---|
| `src/core/text.js` | 文字コード判定と、Blob を 1 MiB ずつ読むデコード |
| `src/core/csv.js` | CSV パーサ（ストリーミング、RFC 4180 準拠で寛容）、区切り文字の判定、CSV 書き出し |
| `src/core/excel.js` | Excel で崩れる値の判定、「自動」列の数値化ルール、列幅、シート名、`planSheet` |
| `src/core/xlsx.js` | xlsx の XML（共有文字列、スタイル、エスケープ）をストリーミングで生成 |
| `src/core/zip.js` | ブラウザ標準の `CompressionStream` を使った ZIP 作成 |
| `src/core/convert.js` | 解析（`analyze`）と書き出し（`write`）の入口 |
| `src/core/messages.js` | エラーと表示用の日本語文言 |
| `src/core/session.js` | 画面の状態遷移（純粋関数） |
| `src/worker.js` | 1 ジョブ 1 ワーカーで解析・書き出しを実行 |
| `src/main.js`, `src/view.js` | ページの起動、ジョブ管理、描画 |
| `scripts/build.mjs` | esbuild でバンドルし `deploy/` を作り直す |
| `docs/DESIGN.md` | 設計の詳細（判定ルール、xlsx の構造、状態遷移、エラー一覧） |
| `decisions.tsv` | 設計判断の記録 |

テスト用の CSV は `node scripts/make-fixtures.mjs`、favicon と OGP 画像は `node scripts/make-images.mjs` で作り直せます。

## デプロイ

- `main` ブランチへの push（または Actions 画面からの手動実行）で `.github/workflows/deploy.yml` が動きます。
  - `npm ci` → `npm run build` → `npm test` → `deploy/` を FTPS でアップロードします。
  - アップロードは失敗しても 20 秒おいて最大 3 回まで試し、3 回とも失敗したらジョブを失敗にします。
- プルリクエストでは `.github/workflows/ci.yml` がビルドとテストだけを実行します。デプロイはしません。
- GitHub の Settings → Secrets and variables → Actions に、次の 3 つを登録してください。
  - `FTP_SERVER`
  - `FTP_USERNAME`
  - `FTP_PASSWORD`
- FTP アカウントは、書き込み先を `geneshokai.com/public_html/csv-zero/` だけに制限して作ってください。ワークフローは `server-dir: ./` でアップロードするので、アカウントのルートがそのまま公開ディレクトリになります。
- `deploy/.htaccess` で、ハッシュ付きの JS / CSS は 1 年、画像は 1 週間キャッシュし、HTML は毎回確認させます。iframe 埋め込みを妨げないよう、`X-Frame-Options` は付けていません。

## ブログへの埋め込み

`?embed=1` を付けると、ツール部分だけを透明な背景で表示します。埋め込み時は常にライトテーマです。高さは中身に合わせて `postMessage` で親ページに伝わります。

```html
<iframe id="csv-zero" src="https://geneshokai.com/csv-zero/?embed=1" title="CSV 0落ち防止コンバーター" loading="lazy" style="width:100%;height:640px;border:0"></iframe>
<script>
addEventListener("message", function (e) {
  if (e.origin === "https://geneshokai.com" && e.data && e.data.type === "csv-zero:height") {
    document.getElementById("csv-zero").style.height = e.data.height + "px";
  }
});
</script>
```

## WordPress に直接埋め込む（build:wp）

`npm run build:wp` は、ツールだけを1行の HTML 断片にします。`dist-wp/` は生成物なので git には入れません。文章の下書きは `docs/wp/PAGE-DRAFT.md` が原本で、ビルドが `dist-wp/PAGE-DRAFT.md` にコピーします。

- `dist-wp/csv-zero-wp.html` は、カスタム HTML ブロックに貼る断片です。
- `dist-wp/csv-zero-wp.block.html` は、同じ断片を Gutenberg の `wp:html` ブロックで包んだものです。REST API の `content` にそのまま渡せます。

スクリプトは `data:text/javascript;base64,...` の1本だけです。テーマの文字やボタンの見た目は、ツールの内側には入りません。公開サイト用の `npm run build`（`deploy/`）とは別の成果物です。

ローカルで見た目を確認するには、先に `npm run build:wp` を実行してから `node scripts/wp-harness/serve.mjs` を使います。

## 性能（計測値）

検証環境（Linux、Google Chrome 154 のヘッドレスモード、`npm run perf` を 2 回）で計測した値です。端末の性能によって変わります。

| 入力 | 行数 | プレビューまで | xlsx 作成 | CSV 作成 | 画面の最大停止 | xlsx のサイズ |
|---|---|---|---|---|---|---|
| 20MB | 20万行 | 0.9〜1.3 秒 | 3.7 秒 | 0.6 秒 | 0.15〜0.18 秒 | 10.4MB |
| 100MB | 100万行 | 3.8〜4.3 秒 | 19.9〜20.1 秒 | 2.2〜2.3 秒 | 0.13 秒 | 51.6MB |

変換は Web Worker の中で行うので、変換中もページは固まりません。`npm test` にも 20MB の計測が入っていて、プレビューと xlsx 作成の合計が 15 秒、または画面の停止が 0.5 秒を超えると失敗します。`npm run perf` は、20MB の合計 15 秒未満、画面の停止 0.2 秒未満、100MB の完走を目標にしていて、1 つでも外れると終了コード 1 で終わります。

## 制限

- 入力は 200MB まで。
- xlsx は Excel の上限（1,048,576 行、16,384 列、1 セル 32,767 文字）を超えると作れません。その場合も CSV（UTF-8 BOM 付き）では保存できます。
- `CompressionStream` に対応していない古いブラウザでは xlsx を作れません（CSV は使えます）。
