# PDF複数ページ処理の現状整理

このドキュメントは、ページ分割（1ページ実体ファイル）方式への移行前提をまとめたものです。

## 入力方式

- 各ページ解析ステップの入力は、アップロード後に準備された「単一ページのアセット」です。
- 旧方式のように PDF 全体をページごとに再送して解析する設計は採用しません。
- Gemini への「`pageNumber / totalPages` の何ページ目だけを対象にする」指示は使用しません。

## `APP_MAX_PDF_PAGES` の扱い

- `APP_MAX_PDF_PAGES` は「生成・処理するページアセット数の上限」として扱います。
- ページ数推定のための PDF 生バイナリ走査ロジックには使用しません。

## 永続化と集計

- `document_parse_pages` テーブルへのページ単位保存と、`mergeFinalizeStep` での最終集計方針は維持します。
- `document_parse_runs.stats` には `pageCount`, `processedPages`, `succeededPages`, `failedPages`, `failedPageNos` を保存します。
