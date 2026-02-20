# PDF複数ページ処理の現状整理

このドキュメントは、現状実装における「PDFが複数ページにわたる場合」の処理方針を簡潔にまとめたものです。

## 1. ページ数判定

- `detectPdfPageCount` が PDF バイナリを `latin1` テキストとして読み取り、`/Type /Pages` オブジェクト内の `/Count` を優先してページ数を判定します。
- 上記が取れない場合は、文書全体の `/Count` を走査するフォールバックを実行します。
- それでも判定できない場合は `1` ページ扱いになります。

## 2. 処理対象ページ数の決定

- パイプライン側では `processedPages = min(pageCount, maxPages)` で上限を適用します。
- `maxPages` は環境変数 `APP_MAX_PDF_PAGES`（未指定時は 30）で決まります。

## 3. ページ単位解析の実行

- PDF 全体を base64 化し、1ページ目から `processedPages` まで順次処理します。
- 各ページ解析では Gemini へ「`pageNumber / totalPages` の何ページ目だけを対象に明細抽出する」指示を付与します。
- 明細がないページは `lineItems: []` を返す前提です。

## 4. 複数ページ結果のマージ

- ページごとの `ParsedInvoice` を `mergeParsedInvoices` で統合します。
- `vendorName` と `invoiceDate` は「最初に見つかった非 null 値」を採用します。
- `lineItems` は全ページ分を連結し、`lineNo` を 1 から採番し直します。

## 5. ページ単位の永続化

- `document_parse_pages` テーブルに `(parse_run_id, page_no)` 単位で状態を upsert します。
- ページ処理開始時に `RUNNING`、成功時に `SUCCEEDED` + `parsed_json`、失敗時に `FAILED` + `error_summary` を保存します。
- 既に `SUCCEEDED` のページは再実行時にスキップされます。

## 6. エラーポリシー（重要）

- ページ単位では部分失敗を許容します。
- 一時的エラー（429/5xx/timeout系）はリトライ対象です。
- 最終的に `mergeFinalizeStep` で成功/失敗ページ数を集計し、`SUCCEEDED` / `PARTIAL` / `FAILED` を決定します。

## 7. 最終マージと状態更新

- `SUCCEEDED` ページだけをページ順にマージし、`document_line_items` / `document_diff_items` を再生成します。
- `documents.status` は `PARSED` / `PARSED_PARTIAL` / `FAILED` を設定します。
- `document_parse_runs.stats` には `pageCount`, `processedPages`, `succeededPages`, `failedPages`, `failedPageNos` を保存します。

## 8. テストで担保されている点

- 複数ページ時に 2 ページ目以降も処理されること。
- ページ途中エラー時に partial result を返さず失敗すること。
- ページ数判定で `/Type /Pages` 優先、フォールバック、最終1ページ扱いが機能すること。
