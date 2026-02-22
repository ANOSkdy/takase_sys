# Incident: /documents 解析後にカテゴリが「未分類」に見える

## 事象

- `/documents` の「解析」実行後、既存商品のカテゴリが「未分類」に変わったように見えるケースがあった。

## 原因

- `src/services/documents/parse.ts` の新規商品作成処理では、`buildProductRow` がカテゴリを常に `"未分類"` で初期化していた。
- 商品一致キー (`product_key`) が揺れた場合（例: 規格の有無差で別キー化）には既存行更新ではなく新規行作成になるため、カテゴリ `"未分類"` の行が増えて「上書きされた」ように見えた。
- 既存キー衝突時の `onConflictDoUpdate` はカテゴリを更新対象にしていなかったため、直接のカテゴリ上書きは起きにくいが、将来の変更で `excluded.category` が入ると退行する余地があった。

## 対応

- カテゴリ正規化ヘルパーを追加し、`null/空文字/"未分類"` を「カテゴリ未指定」として扱うようにした。
- `onConflictDoUpdate` のカテゴリ更新式を `COALESCE(NULLIF(NULLIF(excluded.category,''),'未分類'), product_master.category)` 相当へ変更し、未指定カテゴリで既存カテゴリを潰さないことを明示化した。

## 再発防止

- `parse-category.test.ts` でカテゴリ承継（既存カテゴリ保持）の回帰テストを追加。
