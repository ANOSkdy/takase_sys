# DB テーブル設計書（v1 + staging）

## 1. 前提
- DB: Neon（PostgreSQL）
- v1テーブルは Neon の SQL Editor で作成済み（`db/schema/v1.sql` にスナップショット保存）
- 追加で “現物Excelをそのまま取り込む” ためのステージングテーブル（`stg_*`）を作成済み
- スコープ
  - v1: 商品マスタ更新（Excel/PDF）・PDF解析・差分固定化・履歴
  - staging: Excel現物保持 + 行形式展開

---

## 2. テーブル一覧（役割別）

### 2.1 コアマスタ
| テーブル | 用途 | 主キー | ユニーク | 主な参照 |
|---|---|---|---|---|
| `product_master` | 商品マスタ本体（品名/規格/カテゴリ） | `product_id` | `product_key` | `vendor_prices`, `update_history`, `document_line_items(matched_product_id)` |
| `vendor_prices` | 業者別の仕切り単価（最新状態） | `vendor_price_id` | `(product_id, vendor_name)` | `product_master` |

### 2.2 PDF処理（アップロード→解析→差分固定化）
| テーブル | 用途 | 主キー | 参照 |
|---|---|---|---|
| `documents` | PDF管理（ソフトデリート含む） | `document_id` | `document_parse_runs` |
| `document_parse_runs` | 解析の実行単位（モデル/プロンプト/統計/結果） | `parse_run_id` | `documents`, `document_line_items`, `document_diff_items` |
| `document_line_items` | PDFから抽出した明細（突合結果を含む） | `line_item_id` | `document_parse_runs`, `product_master` |
| `document_diff_items` | 差分結果の固定化（分類/根拠/スナップショット） | `diff_item_id` | `document_parse_runs`, `document_line_items` |

### 2.3 履歴
| テーブル | 用途 | 主キー | ユニーク | 参照 |
|---|---|---|---|---|
| `update_history` | 更新履歴（before/after、重複防止キー） | `history_id` | `update_key` | `product_master` |

### 2.4 Excel取込の実行管理
| テーブル | 用途 | 主キー | 参照 |
|---|---|---|---|
| `excel_import_runs` | Excel取込の実行単位（RUNNING/SUCCEEDED/FAILED、統計/エラー） | `import_run_id` | `stg_excel_rows`, `stg_vendor_price_rows` |

### 2.5 ステージング（現物保持＋行形式）
| テーブル | 用途 | 主キー | ユニーク | 参照 |
|---|---|---|---|---|
| `stg_excel_rows` | Excel全シート全行を「現物そのまま」JSONで保持 | `stg_row_id` | `(import_run_id, sheet_name, row_index)` | `excel_import_runs` |
| `stg_vendor_price_rows` | “業者別（最終更新日/仕切り）”を行形式に展開 | `stg_id` | なし（必要なら後で追加） | `excel_import_runs` |

---

## 3. ER図（Mermaid）

```mermaid
erDiagram
  PRODUCT_MASTER ||--o{ VENDOR_PRICES : has
  PRODUCT_MASTER ||--o{ UPDATE_HISTORY : has
  DOCUMENTS ||--o{ DOCUMENT_PARSE_RUNS : has
  DOCUMENT_PARSE_RUNS ||--o{ DOCUMENT_LINE_ITEMS : has
  DOCUMENT_PARSE_RUNS ||--o{ DOCUMENT_DIFF_ITEMS : has
  PRODUCT_MASTER ||--o{ DOCUMENT_LINE_ITEMS : matched_by

  EXCEL_IMPORT_RUNS ||--o{ STG_EXCEL_ROWS : has
  EXCEL_IMPORT_RUNS ||--o{ STG_VENDOR_PRICE_ROWS : has

  PRODUCT_MASTER {
    uuid product_id PK
    text product_key UK
    text product_name
    text spec
    text category
    numeric default_unit_price
    text quality_flag
    timestamptz last_updated_at
    text last_source_type
    text last_source_id
  }

  VENDOR_PRICES {
    uuid vendor_price_id PK
    uuid product_id FK
    text vendor_name
    numeric unit_price
    date price_updated_on
    text source_type
    text source_id
    timestamptz updated_at
    UNIQUE product_id_vendor_name
  }

  DOCUMENTS {
    uuid document_id PK
    text file_name
    text file_hash
    text storage_key
    timestamptz uploaded_at
    text upload_note
    text status
    text vendor_name
    date invoice_date
    text parse_error_summary
    boolean is_deleted
    timestamptz deleted_at
    text deleted_reason
  }

  DOCUMENT_PARSE_RUNS {
    uuid parse_run_id PK
    uuid document_id FK
    timestamptz started_at
    timestamptz finished_at
    text status
    text model
    text prompt_version
    jsonb stats
    text error_detail
  }

  DOCUMENT_LINE_ITEMS {
    uuid line_item_id PK
    uuid parse_run_id FK
    int line_no
    text product_name_raw
    text spec_raw
    text product_key_candidate
    numeric quantity
    numeric unit_price
    numeric amount
    numeric model_confidence
    numeric system_confidence
    uuid matched_product_id FK
    UNIQUE parse_run_id_line_no
  }

  DOCUMENT_DIFF_ITEMS {
    uuid diff_item_id PK
    uuid parse_run_id FK
    uuid line_item_id FK
    text classification
    text reason
    text vendor_name
    date invoice_date
    jsonb before
    jsonb after
    UNIQUE parse_run_id_line_item_id
  }

  UPDATE_HISTORY {
    uuid history_id PK
    text update_key UK
    uuid product_id FK
    text field_name
    text vendor_name
    text before_value
    text after_value
    text source_type
    text source_id
    timestamptz updated_at
    text updated_by
  }

  EXCEL_IMPORT_RUNS {
    uuid import_run_id PK
    text file_name
    text file_hash
    timestamptz started_at
    timestamptz finished_at
    text status
    jsonb stats
    text error_detail
  }

  STG_EXCEL_ROWS {
    uuid stg_row_id PK
    uuid import_run_id FK
    text sheet_name
    int row_index
    jsonb row_json
    timestamptz inserted_at
    UNIQUE import_run_id_sheet_row
  }

  STG_VENDOR_PRICE_ROWS {
    uuid stg_id PK
    uuid import_run_id FK
    text sheet_name
    text product_name_raw
    text spec_raw
    text vendor_name_raw
    text price_updated_on_raw
    text unit_price_raw
    int source_row_index
    timestamptz inserted_at
  }
4. 各テーブル定義（要点）
4.1 product_master
目的: 商品を一意に管理し、PDF抽出/業者単価の突合基点にする。
主キー: product_id uuid（DBが自動採番）
業務ユニーク: product_key text UNIQUE

推奨生成: normalize(品名) + '｜' + normalize(規格)（規格無しの場合は normalize(品名)）

主要カラム

product_name: 表示用（品名）

spec: 規格/品番

category: 代表カテゴリ（シート名）。v1は単一テキスト

last_source_type / last_source_id: 更新の出所追跡（例: EXCEL + import_run_id）

4.2 vendor_prices
目的: 商品×業者の単価の“最新状態”を保持する。
制約: UNIQUE(product_id, vendor_name)
→ 同一商品×同一業者は1行に収束（upsert前の重複排除が必要）

主要カラム

unit_price numeric(12,2)

price_updated_on date: Excelの最終更新日等

source_type / source_id: 投入元追跡（例: EXCEL + import_run_id）

4.3 documents
目的: 納品書PDFの保管情報（ファイル識別/状態/ソフトデリート）。
状態: status は UPLOADED/PARSING/PARSED/FAILED/DELETED のCHECK制約
削除: is_deleted=true + status=DELETED + deleted_at（物理削除しない）

4.4 document_parse_runs
目的: PDF解析の実行単位を管理（モデル・プロンプト・統計・エラー）。
主要カラム

model: 例 gemini-3-flash-...

prompt_version: v1/v2...

stats jsonb: 件数/警告/未突合など（自由形式）

4.5 document_line_items
目的: PDFから抽出した明細。突合結果（matched_product_id）も保持。
重要制約

UNIQUE(parse_run_id, line_no)（同一run内の行番号重複禁止）

line_no > 0

model_confidence/system_confidence は 0〜1 範囲CHECK

4.6 document_diff_items
目的: 差分計算結果を固定化し、UI/監査/再現性を担保する。
分類: UPDATE/NO_CHANGE/UNMATCHED/BLOCKED/NEW_CANDIDATE のCHECK制約
重複防止: UNIQUE(parse_run_id, line_item_id)（1明細1差分）

4.7 update_history
目的: マスタ更新の履歴（before/after）を必ず残す。
重複防止キー: update_key UNIQUE

例: <parse_run_id>:<product_id>:vendor_price:<vendor_name>

4.8 excel_import_runs
目的: Excel取込の実行管理（RUNNING/SUCCEEDED/FAILED）
用途

import_run_id を source_id として product_master / vendor_prices へ伝搬

stats に投入件数、エラー/警告の要約を格納

4.9 stg_excel_rows（原本保持）
目的: Excel全行を“加工なし”で保存し、再現性/監査/再変換に耐える。
ユニーク: UNIQUE(import_run_id, sheet_name, row_index)

4.10 stg_vendor_price_rows（行形式）
目的: Excelの「業者別（最終更新日/仕切り）」を列→行に展開し、SQLで upsert しやすくする。
備考

現状ユニーク制約なし（必要なら将来追加検討）

5. データ投入・反映フロー（Excel）
5.1 フロー概要
excel_import_runs を RUNNING で作成（import_run_idを発行）

stg_excel_rows へ全シート全行を投入（原本保存）

stg_vendor_price_rows へ業者別パターンの行を展開

SQLで product_key を生成し 重複を集約して product_master upsert

(product_id, vendor_name) 単位に 最新優先で集約して vendor_prices upsert

excel_import_runs を SUCCEEDED で閉じる（statsも記録）

6. 正規化ルール（推奨）
normalize_text(text) の導入を推奨

全角スペース→半角

連続空白の圧縮

trim

product_key のブレを最小化する

7. 運用メモ
v1は category が単一テキストなので、同一商品が複数シートに出ても代表カテゴリしか持てない

将来拡張案: product_categories(product_id, category) の追加

stagingは「原本保持」が目的のため、基本は削除しない（容量対策は運用で検討）

::contentReference[oaicite:0]{index=0}
