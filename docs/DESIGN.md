# csv-zero design

This is the synthesized design from the architect arena. The base is candidate 1. The grafts and the reasons are under "Synthesis decision". Where this document and a later commit disagree, the code and its tests win, and this file gets fixed.

## Problem

csv-zero turns a CSV into an .xlsx whose every cell is a string with number format `@`, entirely in the browser, for blog readers whose 金融機関コード and 郵便番号 lose their leading zeros in Excel. Four constraints make the shape non-obvious. A 20 MB file must finish well under 15 s with the page responsive, and 100 MB must work or fail with a message, so no layer may hold the table as JS objects. Conversion must keep working after the network drops, under a CSP that allows only same-origin code, so no job may depend on a later fetch. Exact text has to survive XML, which folds CR into LF and forbids most C0 controls, and OOXML readers, which decode `_xHHHH_` inside strings. And the badge that counts what Excel would have mangled is what shows users their problem, so every number on it must be a claim we can defend. Grounding already fixes plain JS with JSDoc, a DOM-free `src/core` tested in Node, heavy work in a worker, and esbuild with a hashed worker file.

## Usage (caller's view)

The end user drops a CSV (or pastes text), sees the preview with the detected encoding and delimiter and 「Excelで直接開くと崩れる値: N件」, and clicks one button to get `<name>_text.xlsx`. The engineer sees these call sites.

```js
// main.js: the effect runner is the only code that talks to workers.
const read = runJob(workerUrl, { type: 'read', source, choice }, (event) => dispatch({ type: 'readEvent', event }));
read.cancel(); // the user picked another encoding: the worker is terminated, and none of its events reach update()
```

```js
// worker.js: a whole job is one of two calls.
const result = request.type === 'read'
  ? await analyze(request.source, request.choice, { onPreview, onProgress })
  : await write(request.format, request.source, request.analysis, request.options, onProgress);
```

```js
// test/unit/convert.test.js: the same two calls in Node, asserted against literals.
const source = { kind: 'file', blob: new Blob([readFileSync('test/fixtures/codes-sjis.csv')]), name: 'codes.csv' };
const read = await analyze(source, AUTO_CHOICE, { onPreview() {}, onProgress() {} });
assert.ok(read.ok);
assert.deepEqual(read.value.settings, { encoding: 'shift_jis', delimiter: ',' });
const out = await write('xlsx', source, read.value, { header: true, autoColumns: [] }, () => {});
assert.ok(out.ok);
assert.deepEqual(await sheetCells(out.value.blob), [['銀行コード', '支店コード'], ['0001', '001'], ['0005', '010']]);
```

```js
// view.js: the badge and every toggle are a pure derivation on the main thread.
const plan = planSheet(stage.analysis, { header: session.header, autoColumns: stage.autoColumns });
refs.summary.textContent = `Excelで直接開くと崩れる値: ${formatCount(plan.riskTotal)}件`;
```

## Shape

1. **The Blob is the only copy of the data.** Main keeps the `File`, or a `Blob` of pasted text, and never reads it. Every job reads it again in 1 MiB slices, so nothing caches rows and nothing can go stale (per foundational-thinking and laziness-protocol).
2. **One job per worker.** A worker gets one request, posts events, posts one terminal event, and is terminated. Cancel is `terminate()`. There are no job ids, no cooperative cancellation, and no state shared between jobs (per separate-before-serializing-shared-state). The same request always yields the same bytes (per make-operations-idempotent).
3. **A read produces a small `Analysis`, and options are a pure plan over it.** `Analysis` is the first 101 records plus O(cols) counters. `planSheet(analysis, options)` derives widths, risk totals, blockers and warnings. The UI calls it on every toggle and the write job calls it before writing, so the screen and the file cannot disagree.
4. **Output streams through native gzip into a hand-built zip.** Text cells are shared strings (`t="s"`). The sheet and the string table stream through two compressors in the same pass, so nothing waits for the end of the file. `CompressionStream('gzip')` supplies both deflate and CRC-32.

Each module owns one body of knowledge, not one pipeline stage (per model-the-domain).

- `core/text.js` holds the encoding rules and slice decoding. `core/csv.js` holds CSV syntax in both directions, meaning the reader state machine, delimiter sniffing, and the writer's quoting.
- `core/excel.js` holds Excel behavior, meaning `classify`, `autoNumber`, limits, widths, sheet names, and `planSheet`. `core/xlsx.js` holds SpreadsheetML parts, styles, exact-text escaping, the shared-string table, and the streamed sheet XML. `core/zip.js` holds the container over native gzip.
- `core/convert.js` exports `analyze` and `write`, and is the only module that composes the others. `core/session.js` is the UI state machine. `core/messages.js` is the `AppError` union and every runtime Japanese string.
- `protocol.js` holds worker message types, `worker.js` is the shell, `main.js` runs boot, effects and DOM events, and `view.js` writes the DOM.

The main bundle imports only session, excel, messages and view. The reader, xlsx and zip code ship in the worker bundle.

### Data shape and retention (Q1)

Data flows from the `Blob` through `decodeText` (one string per 1 MiB slice) and `createCsvReader().push()` into a `string[][]` batch. Each batch goes to exactly one consumer, which is the `analyze` counters, the sheet XML generator, or the CSV writer. A batch dies at the end of its loop turn.

| Data | Held by | Lifetime | Size |
|---|---|---|---|
| `Source` (`kind`, `blob`, `name`) | session | until reset or another file | a handle; the bytes stay in browser file storage |
| `Analysis` | session, cloned into each write request | until the next read | the first 101 records (fewer past 1M chars), plus O(cols) counters |
| `header`, `autoColumns` | session | `header` survives files; each read clears `autoColumns` | tiny |
| one slice, its text, its batch, its XML | worker | one loop turn | 1 MiB, ~2 MB, ~10k records, ~5 MB (estimates) |
| compressed parts, then the output Blob | worker, then session | until another file or option change | 9.7 MB per 139 MB of sheet XML (measured with inline strings; shared strings are smaller) |
| shared-string dedupe `Map` | worker, write job only | one write job | at most `SST_DEDUPE.maxEntries` keys of at most `SST_DEDUPE.maxChars` characters each |

Option changes route by cost. Header and 自動 toggles call `planSheet` on the main thread. Encoding and delimiter changes start a read job. A download starts a write job that re-reads with `analysis.settings`.

- Measured on this box with Node 20.19, a 22.7 MB CSV of 200k rows × 10 columns parses in 189 ms with a minimal `charCodeAt` scanner. The classifier's fast path over its 2M fields takes 157 ms, and Shift_JIS decodes at 73 ms per 20 MB. A read job should take about 0.5 s (estimate).
- 2M inline-string cells make 139 MB of XML. Building and encoding it takes 0.78 s, and native gzip takes 1.75 s down to 9.7 MB. Shared strings write less XML per cell (`<c r="B7" s="1" t="s"><v>17</v></c>` plus one `<si>` per distinct value), so a 20 MB write job should take about 3 s or less (estimate, to be measured by the perf run).
- 100 MB costs about five times that. Worker memory is one loop turn's working set, about 10 MB, plus the compressed output, about 10 MB for 20 MB of input and 45 MB for 100 MB (estimates scaled from the measured 9.7 MB). The input is never held whole, and main holds only the `Analysis`.

### Encoding and delimiter detection (Q2)

The rules run in order and the first match decides. A forced encoding still runs rules 1-3 and 7, so a binary file stays rejected.

| # | Test | Result |
|---|---|---|
| 1 | 0 bytes | `EMPTY_FILE` |
| 2 | starts `50 4B 03 04` | `NOT_CSV_XLSX` |
| 3 | starts `D0 CF 11 E0 A1 B1 1A E1` | `NOT_CSV_XLS` |
| 4 | starts `EF BB BF` | utf-8 with BOM |
| 5 | starts `FF FE`, or starts `FE FF` | utf-16le with BOM, or utf-16be with BOM |
| 6 | in the first 64 KiB, NUL is at least 10 % of bytes and at least 90 % of NULs sit at odd offsets, or at even offsets | utf-16le, or utf-16be, without BOM |
| 7 | in the first 64 KiB, bytes 00-08, 0E-1A and 1C-1F exceed 1 % | `NOT_CSV_BINARY` |
| 8 | the whole file through a non-fatal UTF-8 decoder yields no replacement | utf-8 (`asciiOnly` when no byte is 80 or above) |
| 9 | replacements are at most 1 % of the bytes at 80 or above | utf-8 with damage, followed by `DECODE_REPLACED` |
| 10 | otherwise | shift_jis (WHATWG Shift_JIS is CP932) |

"Replacements" means U+FFFD characters in the decoder output minus the `EF BF BD` sequences in the input, because a file may contain a correctly encoded U+FFFD (cross-judge finding). The byte count carries the last two bytes of a slice so a sequence split across slices still counts once. The same subtraction applies wherever the read counts damaged cells.

CP932 text is almost never valid UTF-8, because its lead bytes 81-9F are UTF-8 continuation bytes (inferred from the byte ranges). Rule 9 exists because UTF-8 Japanese usually decodes as Shift_JIS without a single error, as mojibake, so one damaged byte must not send a UTF-8 file to rule 10 (inferred the same way). TextDecoder strips a BOM that matches its encoding. Undecodable bytes become U+FFFD, and the read counts the cells that contain one.

The encoding select offers 自動, UTF-8, Shift_JIS, EUC-JP, UTF-16LE and UTF-16BE. EUC-JP is never auto-detected, because EUC-JP bytes usually decode as valid Shift_JIS mojibake. It is a manual escape hatch that costs one `TextDecoder` label. Pasted text is already Unicode, so the select is disabled for a paste.

For the delimiter, the read decodes the first 64 KiB with the resolved encoding and parses it with each candidate (`,` `\t` `;`) through the real reader. It uses up to 50 records, drops the last one unless the sample is the whole file, and ignores blank records. For each candidate, m is the most common field count and c is the share of records with m fields.

| # | Rule | Result |
|---|---|---|
| 1 | the user picked a delimiter | that delimiter |
| 2 | no candidate has m of 2 or more | `,` with `singleColumn: true`, shown as `SINGLE_COLUMN` |
| 3 | otherwise, rank candidates with m of 2 or more by round(c × 10), then m, then the extension (`.tsv` prefers tab, `.csv` comma), then tab, comma, semicolon, since a tab inside text is rarer than a comma | the first |

### Parser (Q3)

`createCsvReader(delimiter)` is one state machine. `push(text)` returns the records it completed and `finish()` flushes at EOF. In the table, "emit" finishes the field and "end" finishes the record.

| State | `"` | delimiter | CR | LF | other | EOF |
|---|---|---|---|---|---|---|
| recordStart | quoted | emit "", fieldStart | blank record, afterCR | blank record | append, unquoted | stop |
| fieldStart | quoted | emit "" | emit "", end, afterCR | emit "", end, recordStart | append, unquoted | emit "", end |
| unquoted | append (bare quote kept) | emit, fieldStart | emit, end, afterCR | emit, end, recordStart | append | emit, end |
| quoted | quoteInQuoted | append | append | append | append | emit, end, `UNTERMINATED_QUOTE` |
| quoteInQuoted | append `"`, quoted | emit, fieldStart | emit, end, afterCR | emit, end, recordStart | append, unquoted | emit, end |
| afterCR | as recordStart | as recordStart | as recordStart | skip, recordStart | as recordStart | stop |

- CRLF, LF and CR line ends mix freely, because `afterCR` swallows at most one LF.
- A blank record is `[""]`. The reader holds blank records in a counter and releases them before the next non-blank record, so interior blank lines keep their rows and trailing ones vanish. A trailing newline adds no row.
- The lenient cells match Python's `csv` module, checked here. `"ab"c,d` reads as `abc`, `d`, and `a"b,c` reads as `a"b`, `c`. An unclosed quote reads to EOF and reports the row where it opened. That is also the usual cause of a cell over 32,767 characters.
- Across chunks, the state, a `pending` partial field, and a flag for "this field saw `""`" carry over. `afterCR` and `quoteInQuoted` make CR-LF and quote-quote splits exact, and the streaming decoder carries split multibyte bytes.
- Unquoted fields are sliced and quoted ones jump with `indexOf('"')`. Ragged rows are padded virtually, because a missing cell is an empty cell and writes nothing.

### Excel-risk classifier (Q4)

`classify(text)` answers one question. If this text sat in a CSV that ja-JP Excel opened by double-click, would the displayed value change? The first matching row wins. The rules favor precision over recall, because the badge is a claim.

| Kind | Rule on the raw text | Examples |
|---|---|---|
| formula | `^[=+@].`, or `^-.` when the rest is not a plain number | `=SUM(A1)`, `+81-90-1234-5678`, `-A1` |
| leadingZero | `^-?0\d+(\.\d+)?$` | `0001`, `0600000`, `09012345678` |
| exponent | `^-?\d{12,}$`, or `^-?\d+(\.\d+)?[eE][+-]?\d+$` | `1234567890123`, `1E5` |
| date | always for M-D or M/D that is valid in a non-leap year, and for YYYY-M or YYYY/M; for Y-M-D or Y/M/D with a valid date and Y of 1-2 digits or 1900-9999, only when Excel's `yyyy/m/d` display differs from the text | `1-2`, `2024-01`, `2024-01-02`, `24/1/2` |
| numberFormat | `^-?\d+\.\d*0$`, or `^\(\d+(\.\d+)?\)$` | `1.50`, `(120)` |

Some values are not counted, because the display stays the same or Excel's behavior is uncertain. They are `12:30`, `2024年1月2日`, `2024/1/2`, `1,234`, `50%`, `¥1,000`, space-padded numbers, and full-width digits. A first-character check sends most cells straight to `null`.

The counts surface in three places. A summary line above the preview reads 「Excelで直接開くと崩れる値: 1,234件（先頭0・日付化・指数表記）」, where the parenthesis lists the short label of every nonzero kind in table order. The short labels are 数式化, 先頭0, 指数表記, 日付化 and 表記変化. One chip per nonzero kind follows, with its count, long label and example from `RISK_LABELS`. Each preview column header shows its count. Each risky preview cell gets a tint and a `title`. When the header option is on, row 1 is never counted.

### XLSX package (Q5)

| Part | Content |
|---|---|
| `[Content_Types].xml` | defaults for rels and xml, overrides for the workbook, sheet1, styles and sharedStrings |
| `_rels/.rels` | the officeDocument relationship to `xl/workbook.xml` |
| `xl/workbook.xml` | `<bookViews><workbookView/></bookViews>` and one `<sheet sheetId="1" r:id="rId1">` |
| `xl/_rels/workbook.xml.rels` | rId1 for the worksheet, rId2 for styles, rId3 for sharedStrings |
| `xl/styles.xml` | fonts 游ゴシック 11 regular and bold (`family 3`, `charset 128`), the two required fills, one border, the cellXfs below |
| `xl/sharedStrings.xml` | streamed in the same pass as the sheet |
| `xl/worksheets/sheet1.xml` | streamed |

There is no theme or docProps part. Small parts are stored or deflated, whichever the zip writer finds simpler. The sheet and the string table are deflated.

**Shared strings, not inline strings.** Apple Numbers and the iOS Quick Look preview show `t="inlineStr"` cells as empty (box/spout#53, citing XlsxWriter's docs), and part of the audience opens the file on a Mac or a phone. Every text cell is therefore `<c r="B7" s="1" t="s"><v>17</v></c>`, and string 17 is the eighteenth `<si>` in `xl/sharedStrings.xml`. The string table is written while the sheet is written, so `<sst>` carries no `count` and no `uniqueCount`. Both are optional in ECMA-376, and Excel reads a table without them (ClosedXML discussion #2023). Each `<si>` is `<si><t>…</t></si>` with the escaping below.

Dedupe keeps the table small for repeated codes, names and prefectures. A `Map` from exact text to index is consulted for strings of at most `SST_DEDUPE.maxChars` characters (64) while it holds fewer than `SST_DEDUPE.maxEntries` keys (500,000). A string that misses the map gets a new index and a new `<si>`, and goes into the map only while both limits hold. Past the limits the table may contain duplicates, which is valid because readers resolve indices and never require uniqueness. Memory stays bounded and no file fails because it has too many distinct values.

| xf | numFmtId | Font | Wrap | Used for |
|---|---|---|---|---|
| 0 | 0 General | regular | no | 自動 numbers without grouping, and columns past the data |
| 1 | 49 `@` | regular | no | text cells, and the `<col style>` of text columns |
| 2 | 49 | regular | yes | text cells that contain LF or CR |
| 3 | 49 | bold | no | the header row |
| 4 | 49 | bold | yes | header cells that contain LF or CR |
| 5 | 3 `#,##0` | regular | no | 自動 integers written with thousands separators |

sheet1.xml follows schema order. It starts with `<dimension ref="A1:{last}{rows}"/>`. Next comes `<sheetViews>`, with `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>` only when the header option is on. Then `<cols>` has one `<col>` per data column with `width` and `customWidth="1"`. Text columns also get `style="1"`, so a value typed into an empty cell there stays text. Columns past the data keep General, so a formula typed next to the data still calculates. `<sheetData>` comes next. A text cell is `<c r="B7" s="1" t="s"><v>17</v></c>`, and a 自動 number is `<c r="B7"><v>1234</v></c>` or `<c r="B7" s="5"><v>1234</v></c>`. An empty field writes no `<c>`, and a blank record writes no `<row>`. After `</sheetData>` comes `<ignoredErrors><ignoredError sqref="A1:{last}{rows}" numberStoredAsText="1"/></ignoredErrors>`, so Excel does not paint a green triangle on every code that is text on purpose.

`escapeText` and `needsPreserve` keep text exact inside `<t>`.

| Text | Written as | Reason |
|---|---|---|
| `&` `<` `>` | `&amp;` `&lt;` `&gt;` | XML |
| CR | `&#13;` | XML parsers fold a literal CR into LF. In probes here, LibreOffice read `&#13;` back as CR and wrote CR the same way, but it folds in-cell CRLF to LF however it is encoded. `_x000D_` shows up literally in readers that skip ST_Xstring decoding |
| LF, TAB | literal | element content keeps them |
| U+0000-0008, 000B, 000C, 000E-001F, FFFE, FFFF | `_xHHHH_` | XML 1.0 forbids them even as references, so ST_Xstring is the only encoding |
| a literal `_x`, four hex digits, `_` | `_x005F_` and then the rest | readers decode the pattern. In a probe, LibreOffice turned an unescaped `_x0041_` into `A`, and `_x005F_x0041_` into `_x0041_` |
| first or last char at or below U+0020 | `<t xml:space="preserve">` | Excel trims otherwise |
| leading `=` `+` `-` `@` | unchanged | a shared-string cell has no `<f>`, so nothing evaluates |

- Widths are `min(60, max(8, ceil(w × 1.1) + 2))`, where w is the widest line over all rows, with East Asian Wide and Fullwidth counted as 2.
- The sheet name drops the last extension and replaces `\ / ? * [ ] :` and C0 controls with `_`. It trims `'` at both ends and cuts to 31 UTF-16 units without splitting a surrogate pair. An empty name becomes `Sheet1`, and `History` in any case becomes `History_`.
- 文字列, the default, is everything above. 自動 makes a data cell numeric only when Excel would display the number exactly as the text, so 自動 never changes what the user sees. `autoNumber(text)` returns `{ v, xf }` or null. It accepts `-?(0|[1-9]\d*)` when the text is at most 11 characters, and `-?(0|[1-9]\d*)\.\d*[1-9]` when the text is at most 11 characters and has at most 15 significant digits, both as xf 0 (General shows at most 11 characters before it switches to exponent notation). It accepts `-?[1-9]\d{0,2}(,\d{3})+` with at most 15 digits as xf 5, whose `#,##0` format redisplays the separators. `v` is the text without commas, and `String(Number(v)) === v` must hold, which rejects `-0`. Everything else, including `0012`, `1.50`, `1E5` and `+5`, stays a text cell. The header stays bold text, and the `<col>` of a 自動 column has no style. `autoColumns` lists exceptions only, so all-text is the state that exists before anyone acts (per type-system-discipline).
- Rows over 1,048,576, columns over 16,384, or any cell over 32,767 UTF-16 units block xlsx, with the reason shown under the disabled button. CSV stays available, and nothing is truncated.

### Zip writer (Q6)

The writer uses native `CompressionStream('gzip')` with a hand-built container and no library. On 139 MB of sheet XML here, streamed deflate-raw took 1.98 s, streamed gzip took 1.75 s including CRC-32, and a JS table CRC-32 alone took 0.53 s. The gzip header was verified as the 10 bytes `1f 8b 08 00 00 00 00 00 00 03` with FLG 0, delivered as its own first chunk. The payload inflates as raw deflate, and the trailer CRC equals `zlib.crc32`. So `deflateEntry` strips the RFC 1952 header, parsing FLG in case a browser sets optional fields. It holds back the 8-byte trailer and counts sizes itself, because ISIZE is mod 2^32. `zipBlob` writes local headers after compression, since the Blob is assembled from parts, so there are no data descriptors. There is no Zip64, and a size or offset at 2^32 returns `OUTPUT_TOO_LARGE`. The DOS time is fixed, so equal inputs produce equal bytes. fflate lost, for the reasons under Alternatives considered. Browsers without `CompressionStream` (Safari before 16.4, Chrome before 103, Firefox before 113) get `XLSX_UNSUPPORTED`, and CSV still works there.

### Worker protocol (Q7)

The types live in `protocol.js`. Each worker receives exactly one `JobRequest`.

- `{ type: 'read', source, choice }` streams `progress` and at most one `preview`, then exactly one `done { analysis }` or `failed { error }`.
- `{ type: 'write', format, source, analysis, options }` streams `progress`, then exactly one `done { file }` or `failed { error }`.

`runJob(workerUrl, request, onEvent)` spawns the worker, posts the request, forwards events, and terminates the worker after the terminal event. `cancel()` clears a closure flag and terminates, so even messages already queued never reach `update`. Stale results cannot happen, and no job ids are needed. Progress is bytes read over blob size, posted at most once per percent. A worker `error` event becomes `WORKER_FAILED`. `worker.js` maps unexpected exceptions at the boundary, `NotReadableError` to `READ_FAILED` and `RangeError` to `OUT_OF_MEMORY`, and core trusts its typed inputs (per boundary-discipline). Main fetches the worker script once at boot and spawns every job from a blob: URL, so jobs start while offline.

### UI state machine, embed, offline (Q8)

`Session = { env, header, stage }` lives in `core/session.js`. `update(session, msg)` returns `[session, effects]`, and main.js runs the effects. Stage and output are discriminated unions, so a ready stage without an analysis cannot be built (per model-the-domain).

| From | Message | To | Effects |
|---|---|---|---|
| any | `sourceChosen` with size 0 or over 200 MiB | empty with `EMPTY_FILE` or `FILE_TOO_LARGE` | cancelRead, cancelWrite |
| any | `sourceChosen` | reading with choice auto and no preview | startRead |
| reading, ready | `choiceChanged` | reading, keeping the previous preview dimmed | startRead |
| reading | `readEvent` progress or preview | reading, updated | none |
| reading | `readEvent` done | ready with no autoColumns and output idle | none |
| reading | `readEvent` failed | empty with the error as notice | none |
| any | `headerToggled` | header flipped, and a ready output back to idle | cancelWrite while writing |
| ready | `columnModeToggled` | autoColumns toggled, output idle | cancelWrite while writing |
| ready, and `canWrite` holds | `writeRequested` | output writing | startWrite |
| ready and writing | `writeEvent` progress, done, or failed | writing, written, or failed | download on done |
| ready and writing | `writeCancelled` | output idle | cancelWrite |
| ready and written | `redownloadRequested` | unchanged | download |
| any | `reset` | empty without notice | cancelRead, cancelWrite |

`startRead` first cancels any read and write, and `startWrite` first cancels any write. One object URL lives at a time. The written state renders a real 「保存する」 link, because a browser may block a scripted download that lands seconds after the click inside a cross-origin iframe.

For embed mode, a one-line inline script in `<head>` sets `data-embed` on `<html>` when the query has `embed=1`, before first paint. The build hashes every inline script and writes the hashes into the CSP in place of the `{{script-hashes}}` placeholder, so `script-src` stays free of `'unsafe-inline'`. `main.js` stays a deferred script, so it never blocks rendering. CSS then hides the header, SEO sections and footer, and makes the background transparent. Inside a frame, a ResizeObserver on `<html>` posts `{ type: 'csv-zero:height', height }` with targetOrigin `*` whenever the rounded-up height changes, which is safe because the payload is one number. Nothing sets frame-ancestors.

Offline, a job needs only the main bundle, the CSS and the worker's blob: URL, all in memory after load. Downloads are blob: URLs. The CSP meta is `default-src 'self'; script-src 'self' {{script-hashes}}; style-src 'self'; img-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'none'`.

**DOM contract for tests and screenshots.** The tool root is `[data-testid="tool"]`. Its `data-phase` attribute is the stage kind (`empty`, `reading`, `ready`), and `data-output` is the output kind while ready (`idle`, `writing`, `written`, `failed`). The page has exactly one `input[type=file]`, `[data-testid="file-input"]`. Other hooks are `dropzone`, `paste-tab`, `paste-input`, `paste-submit`, `encoding` (select), `delimiter` (select), `header` (checkbox), `stats`, `risk-summary`, `preview` (table), `col-mode-{index}` (one control per previewed column), `download-xlsx`, `download-csv`, `save-link`, `notice` (errors), `warnings`, `reset` and `copy-embed`, each as a `data-testid` value. `[data-testid="stats"]` holds one element per fact with `data-stat` set to `encoding`, `delimiter`, `rows`, `cols` or `size`.

### Error taxonomy (Q9)

Errors are values of `AppError` in `messages.js`. Only `describe()` words them, and its `never` default makes a new code fail tsc until it has wording (per encode-lessons-in-structure). Rows print as Excel row numbers and columns as letters.

| Code | Trigger | Message |
|---|---|---|
| EMPTY_FILE | 0 bytes, or no records after the BOM and blank lines | ファイルが空です。中身の入ったCSVファイルを選んでください。 |
| FILE_TOO_LARGE | over 200 MiB | ファイルが大きすぎます（{size}）。このツールで扱えるのは200MBまでです。 |
| NOT_CSV_XLSX | ZIP signature | これはExcel（.xlsx）やZIPのファイルです。CSVなどのテキストファイルを選んでください。 |
| NOT_CSV_XLS | OLE2 signature | これは古い形式のExcelファイル（.xls）です。CSVなどのテキストファイルを選んでください。 |
| NOT_CSV_BINARY | encoding rule 7 | テキストではないファイルのようです（画像・PDF・圧縮ファイルなど）。CSVファイルを選んでください。 |
| READ_FAILED | the Blob read rejects | ファイルを読み込めませんでした。ファイルを移動・編集していないか確認して、もう一度選んでください。 |
| OUT_OF_MEMORY | RangeError in the worker | ブラウザのメモリが足りず処理できませんでした。ほかのタブを閉じるか、パソコンのブラウザでお試しください。 |
| WORKER_FAILED | worker error or unexpected exception | 処理中に予期しないエラーが起きました。ページを再読み込みして、もう一度お試しください。 |
| TOO_MANY_ROWS | over 1,048,576 rows, blocks xlsx | 行数（{rows}行）がExcelの上限1,048,576行を超えるため、xlsxでは保存できません。CSV（UTF-8 BOM付き）なら保存できます。 |
| TOO_MANY_COLUMNS | over 16,384 columns, blocks xlsx | 列数（{cols}列）がExcelの上限16,384列を超えるため、xlsxでは保存できません。区切り文字が合っているか確認してください。 |
| CELL_TOO_LONG | a cell over 32,767 chars, blocks xlsx | 1つのセルに入る上限（32,767文字）を超える値が{count}件あります（最初: {row}行目・{col}列）。引用符（"）の閉じ忘れがないか確認してください。 |
| XLSX_UNSUPPORTED | no CompressionStream, blocks xlsx | このブラウザはxlsxの作成に対応していません。最新のChrome・Edge・Safari・Firefoxでお試しください。CSV（UTF-8 BOM付き）での保存は使えます。 |
| OUTPUT_TOO_LARGE | a zip size or offset reaches 4 GiB | 作成するxlsxが4GBを超えるため保存できません。ファイルを分けてお試しください。 |
| DECODE_REPLACED | cells with U+FFFD, warning | 文字コードを正しく読めなかった文字が{count}か所あります（最初: {row}行目・{col}列）。文字コードを切り替えると直ることがあります。 |
| UNTERMINATED_QUOTE | EOF inside quotes, warning | {row}行目で始まる引用符（"）が閉じられていません。ファイルの最後までを1つのセルとして読み込みました。 |
| RAGGED_ROWS | records whose field count differs from the most common one, warning | ほかの行と列の数が違う行が{count}行あります（最初: {row}行目）。足りない列は空欄にします。 |
| SINGLE_COLUMN | delimiter rule 2, info | 区切り文字が見つからなかったため、1列のデータとして読み込みました。必要なら区切り文字を選び直してください。 |

There is no warning for 自動 columns, because `autoNumber` only converts values whose display does not change.

### Test plan (Q10)

Every unit test calls a module the way its caller does and asserts a literal (per test-behavior-not-implementation). These run under `node --test`.

- `detectEncoding` on literal bytes. `EF BB BF 61` is utf-8 with BOM. `87 40 FB FC` is shift_jis, and `decodeText` yields `①髙`. `50 4B 03 04` is `NOT_CSV_XLSX`, and the OLE2 signature is `NOT_CSV_XLS`. `FF FE 61 00` is utf-16le, and so is `61 00 2C 00 62 00` without BOM. A PNG header plus noise is `NOT_CSV_BINARY`. 2,000 UTF-8 kana with one `FF` byte stay utf-8.
- `decodeText` with a 7-byte slice size returns the literal original for CP932 and UTF-8 text whose characters straddle slice edges.
- `createCsvReader` gets a table of inputs and literal records that covers every cell of the matrix above. Each input is also pushed split at every index, and every split must give the same literal records.
- `detectDelimiter` gets literal samples for comma, tab with `1,000` inside, semicolon, quoted commas, and a single column.
- `classify`, `autoNumber`, `columnName`, `sheetName` and `escapeText` get literal input and output tables, such as `'2024/1/2'` to null, `'24/1/2'` to date, `'0012'` to null, `'1,234'` to `{ v: '1234', xf: 5 }`, `'123456789012'` to null, 16383 to `XFD`, and `'a\r\nb'` to `'a&#13;\nb'`.
- `analyze` then `write('xlsx')` run in Node on fixtures, and Python's `zipfile` unzips the output with `testzip()` as an independent CRC-checking reader. Every non-自動 `<c>` has `t="s"` and an `s` from 1 to 4, and no `t="inlineStr"` appears. Resolving each `<v>` through `xl/sharedStrings.xml` gives the literal source text. A value that occurs twice under the dedupe limits appears once in the table. No `<f` appears. styles.xml has `numFmtId="49"`, and text columns have `style="1"`. A frozen pane exists exactly when the header option is on. Decoded cell texts equal literal source fields such as `0001`, `=SUM(A1)`, `a\r\nb`, `_x0041_`, and `  x  `. `write('csv')` output starts with `EF BB BF`, ends records with CRLF, and matches a literal string for quoting.
- A LibreOffice round trip, skipped when `soffice` is missing, converts our xlsx to CSV and compares it with the source fields, treating in-cell CRLF as LF.
- `update` gets literal rows of the Q8 table and asserts the next stage kind and the exact effect list. `describe({ code: 'TOO_MANY_ROWS', rows: 1048577 })` returns the literal sentence with 「1,048,577行」.

The e2e suite runs Playwright on Chromium against the built `deploy/` on a local server.

- Upload a Shift_JIS CSV with `0001`, `001`, `0600000` and `09012345678`, download the xlsx, unzip it, and assert the exact cells and `numFmtId="49"`.
- Convert pasted tab-separated text, a `.tsv` file, and a quoted multi-line cell, which must keep its LF and use xf 2.
- Force UTF-8 on the Shift_JIS file and expect `DECODE_REPLACED`, then return to 自動 and expect it gone. Drop an .xlsx and expect the `NOT_CSV_XLSX` sentence.
- Load the page, call `context.setOffline(true)`, then convert and download. Assert every logged request is same-origin.
- Frame `?embed=1` from a page on a second origin, receive `csv-zero:height`, and download from inside the frame.
- Time a generated 20 MB CSV to ready and to download, while a rAF sampler shows no main-thread gap over 200 ms.
- Save screenshots at 1440 px and 390 px into `screens/`.

### Interface depth

The worker calls two functions, `analyze` and `write`. Behind them sit the encoding table, slice decoding, the reader state machine, delimiter sniffing, classification, widths, XML escaping, styles, compression and the zip layout. The main thread calls `update`, `planSheet`, `classify` and `describe`. No wire type enters core, because the protocol types wrap domain types and live outside `core/`. No caller sequences stages. The one ordering contract is analyze before write, and `write` takes the `Analysis` itself, so it cannot run with settings the analysis did not use.

## Synthesis decision

Three runners produced candidates: candidate 1 on claude-opus-5-5-max, candidate 2 on gpt-5.6-sol-high (gpt-5.6-sol-max was not available), candidate 3 on grok-4.7-xhigh-fast. The cross-judge ran on gpt-5.6-sol-high against `.work/arena/rubric.md`.

| Candidate | Exactness | Compatibility | Scale | Interface | Domain | UX and tests | Judge total | Lead total |
|---|---|---|---|---|---|---|---|---|
| 1 | 5 | 1 | 5 | 3 | 5 | 5 | 24 | 26 |
| 2 | 4 | 1 | 5 | 3 | 5 | 4 | 22 | 21 |
| 3 | 4 | 5 | 4 | 5 | 4 | 4 | 26 | 26 |

The criterion columns are the judge's scores. The lead scored independently before reading them, and only the totals were kept.

**Base: candidate 1, against the judge's pick of candidate 3.** The judge's ranking rests on compatibility, where candidates 1 and 2 used inline strings. That defect lives in one module (`xlsx.js`) and has one fix, shared strings. Candidate 3's differences are spread through the pipeline instead. It throws on limits and quote errors during analysis, which also blocks the preview and the CSV export. Its xf 0 is text, so formulas typed in new columns stop calculating. It sizes widths from the first 100 rows, rejects UTF-16, and fails exports past a distinct-string budget. Candidate 1 also encodes its invariants in structure: one pure `planSheet` feeds both the screen and the writer, `describe()` is exhaustive over `AppError`, and the session's transitions are data.

**Grafts.**

- From candidate 3, shared strings with a dedupe map and a streamed `<sst>` without counts, plus its LibreOffice probes of CR, `_x000D_` and the CRC position.
- From the cross-judge, the U+FFFD subtraction for files that encode U+FFFD correctly, and the reminder that U+FFFE and U+FFFF need `_xHHHH_` (candidate 1 already had it).
- From the lead, these changes. `autoNumber` only converts values whose display survives (xf 5 `#,##0` keeps separators), which drops the `AUTO_CHANGES` warning. `<ignoredErrors numberStoredAsText>` hides the green triangles. An inline embed flag with a build-computed CSP hash replaces the render-blocking `main.js` in `<head>`. EUC-JP and explicit UTF-16 joined the manual encoding list.

**Rejected.** Candidate 2's and the judge's strict RFC 4180 quote errors. Excel and Python's `csv` both read a bare quote inside an unquoted field as a literal character, and a user whose file opens in Excel should not get an error here. Candidate 3's analysis-time throws on limits, for the reason above. Candidate 2's 100 MiB cap stays open until the perf run measures 100 MB.

## Tradeoffs accepted

- We accept a fresh worker and a fresh read of the file for every job, about 0.3 s per 20 MB from the measured parse and decode plus tens of ms of startup (estimate). In exchange we get O(slice) worker memory, cancel-by-terminate, and no cache or stale-result logic.
- We accept a second compressed part and a bounded dedupe map in exchange for files that Numbers and iOS Quick Look display. Past the dedupe limits the string table may hold duplicates, which costs size, not correctness.
- We accept no xlsx on browsers without `CompressionStream` in exchange for zero library bytes and native speed.
- We accept a classifier that under-counts in exchange for numbers we can defend.
- We accept that a new read clears 自動 columns, because the delimiter can renumber them.
- We accept two costs of the exact-text promise. In-cell CRLF stays CRLF, although Excel's own line break is LF. A cell over 32,767 characters blocks xlsx instead of being truncated, and its cause is usually a missing quote.
- We accept a build step that hashes the inline embed flag into the CSP in exchange for no flash of SEO content in embed mode and no render-blocking bundle.

## Alternatives considered

- A long-lived worker could cache parsed rows, as a `string[][]` or as offsets into one decoded string. Its only gain is skipping the 0.3 s re-read on write, because `planSheet` already makes header and 自動 toggles instant, and encoding or delimiter changes must re-parse anyway. It costs about 150 MB for 20 MB of input (estimate), cooperative cancellation, and a job id on every message. Every option change would also have to know the cache's invalidation rules.
- A synchronous core over a whole-file `ArrayBuffer`, plus fflate, gives the simplest control flow. But the worker would hold the whole input next to the output, which is the wrong memory term for 100 MB on a phone. fflate adds about 8 KB minified (estimate), its JS deflate is unmeasured against native zlib at 70 MB/s, and its sync API buys nothing because reading a Blob in slices is async anyway.
- Inline strings keep the writer to one part, and deflate erases most of their size cost. They lost because Numbers and iOS Quick Look show inline-string cells as empty.
- Imperative event handlers with flags such as `isExporting` and `hasFile` lost to the reducer, whose transitions are testable as data.

## Open questions and risks

- Do the date and exponent rules match what ja-JP Excel 365 does on double-click? Nothing on this box runs Excel. Can someone open `test/fixtures/excel-mangle.csv` once on Windows and confirm the badge counts?
- Does Excel read `&#13;` inside a shared string as CR? LibreOffice does, and LibreOffice writes CR that way. If Excel does not, should a CR switch to `_x000D_`?
- Does Excel accept a string table with duplicate entries past the dedupe limits? Readers resolve indices, so it should, but only LibreOffice was checked here.
- Is 200 MiB the right hard cap, given that 100 MB needs about 15 s to export (extrapolated from the measurements)?
- Will Chromium allow a scripted download inside a cross-origin iframe seconds after the click? The 「保存する」 link covers both outcomes. Should the e2e assert the fallback path as well?

## Next implementation step

Write `createCsvReader` in `core/csv.js` with its literal table and split-at-every-index test, since every other module consumes its batches.
