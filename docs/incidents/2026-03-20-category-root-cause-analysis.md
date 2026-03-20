# Investigation: 「未分類」付与とカテゴリ上書き経路の根本原因分析（2026-03-20）

## 調査スコープ

- 目的: `category = "未分類"` が入る条件、および既存カテゴリが意図せず変わる（上書きに見える）経路の特定。
- 方針: コード読解のみ（DB更新・データ修正は未実施）。
- 対象: schema / route handler / repository / documents parse / import・migration scripts。

---

## 結論（Confirmed）

### 1) 「未分類」が保存される確定条件

`/documents` 解析フローで、以下条件を同時に満たした行に対して新規 `product_master` が作成されると、カテゴリは `"未分類"` になる。

1. 既存商品に `product_key`（または legacy key）でマッチしない。
2. `systemConfidenceNum >= 0.9`（自動新規作成許可条件）。
3. 新規作成時に `buildProductRow` へ `category: null` が渡される。
4. `resolveCategory({ existing: null, incoming: null })` が `PDF_DEFAULT_CATEGORY`（`"未分類"`）を返す。

このため、PDF解析由来の「新規作成商品」はカテゴリ未指定時に意図的に `"未分類"` で初期化される。

### 2) 「既存カテゴリが上書きされたように見える」主因

最有力は **既存行の直接更新ではなく、新規行増加による見かけの置換**。

- 解析時の一致判定は `product_key` ベース。
- `product_key` は品名/規格/メーカーの正規化結果に依存するため、値揺れで別キー化すると既存にマッチせず新規作成へ進む。
- その新規作成行が `"未分類"` になるため、一覧上で「カテゴリが未分類に変わった」と誤認しやすい。

### 3) 既存カテゴリを実際に変更し得る確定経路（別系統）

`/api/records/[recordId]` の `PATCH` は `product_master.category` を毎回更新対象に含める。

- UI編集フォームはカテゴリ空欄を送信可能。
- サーバー側Zodで空文字は `null` に変換される。
- SQLが `category = ${payload.category ?? null}` を常時実行する。

従って、レコード編集保存時にカテゴリ空欄だった場合、既存カテゴリは `NULL` に更新される（保持されない）。

※この経路は `"未分類"` を直接書くわけではないが、カテゴリ消失を引き起こし得る。

---

## コード証跡（Trace）

## A. 「未分類」付与フロー（documents parse）

1. エントリ: `parseDocument(documentId)`
2. マッチ不成立 + 高信頼行で新規商品作成分岐へ。
3. `buildProductRow(... category: null ...)` 呼び出し。
4. `buildProductRow` 内で `resolveCategory({ existing: null, incoming: input.category })`。
5. `resolveCategory` は両方未指定時 `PDF_DEFAULT_CATEGORY = "未分類"` を返却。
6. その値が `product_master.category` に insert される。

## B. 既存カテゴリ更新（records PATCH）

1. エントリ: `PATCH /api/records/[recordId]`
2. `updateRecordSchema` は `category` の空文字を `null` 化。
3. `updateRecordById` が `UPDATE product_master SET ... category = ${payload.category ?? null}` を実行。
4. 既存値保持ロジックがないため、空欄保存で既存カテゴリが消える。

## C. DB / migration / batch 観点

- `product_master.category` は DB default 未設定（`DEFAULT '未分類'` なし）。
- category更新トリガー定義はリポジトリ内で確認できず。
- `src/db/migrations/0002_documents_page_split.sql` は documents の列追加のみで category 非関与。
- `scripts/stage-excel.ts` は staging投入のみで `product_master.category` 更新なし。

---

## 影響範囲の整理

- 新規作成レコード: **影響あり**（documents parse 自動作成時に未分類初期化）。
- 既存レコード（解析時）: **原則直接影響なし**（parseでcategory更新は実装されていない）。
- 既存レコード（手動編集）: **影響あり**（PATCHで空欄保存時にNULL上書き）。
- import/sync/migration起因の一括上書き: **現行repo内では確認できず**。

---

## Confirmed / Hypothesis 区分

### Confirmed

- PDF解析新規作成で `"未分類"` が入る分岐条件。
- レコード編集PATCHが既存カテゴリを保持せず更新する実装。
- DB default / migration / staging script に category強制上書きが無いこと。

### Hypothesis（運用データが必要な確認事項）

- 実際の事象で「どの比率が key揺れ起因の新規作成」かは、`parse_run_id` ごとの `product_key` 差分と `product_id` 新規発行履歴照合で確定可能。
- もし「特定日時に大量変化」があるなら手動編集・外部SQL実行の可能性は運用ログ照会が必要（本repoコードのみでは断定不可）。

---

## 低リスクの是正案（実装は未着手）

1. **最優先（低blast）**: `updateRecordById` でカテゴリ未入力時は既存値維持（PATCH semanticに合わせる）。
2. **中優先**: documents parse の新規作成時、カテゴリを `NULL` のまま許容しUI表示で「未分類」を表現（物理値と表示値を分離）。
3. **中優先**: `product_key` 揺れ低減（正規化強化）と、近傍一致時の review queue 化（自動新規作成を抑制）。
4. **監査強化**: category変更時の update_history 追記対象を拡張し、原因追跡を容易化。
