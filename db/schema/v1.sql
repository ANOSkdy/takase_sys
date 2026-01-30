-- =========================================================
-- v1 Schema (Neon / PostgreSQL)
-- 詳細設計書 2026-01-26 / 版0.2 準拠
-- そのまま Neon の SQL Editor で実行OK
-- =========================================================

BEGIN;

-- UUID生成（gen_random_uuid）を使うため
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1) product_master
-- =========================================================
CREATE TABLE IF NOT EXISTS product_master (
  product_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_key text NOT NULL UNIQUE,            -- 正規化(品名｜規格)
  product_name text NOT NULL,                  -- 表示用（品名）
  spec text,                                   -- 規格/品番
  category text,                               -- Excelシート名など（v1はtext）
  default_unit_price numeric(12,2),            -- 単価パターン用（任意）
  quality_flag text NOT NULL DEFAULT 'OK',     -- OK/WARN_*/ERROR_*
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_source_type text,                       -- EXCEL/PDF
  last_source_id text                          -- import_run_id / parse_run_id など
);

CREATE INDEX IF NOT EXISTS idx_product_master_name
  ON product_master (product_name);

CREATE INDEX IF NOT EXISTS idx_product_master_category
  ON product_master (category);

CREATE INDEX IF NOT EXISTS idx_product_master_last_updated_at
  ON product_master (last_updated_at DESC);

-- =========================================================
-- 2) vendor_prices
-- =========================================================
CREATE TABLE IF NOT EXISTS vendor_prices (
  vendor_price_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES product_master(product_id),
  vendor_name text NOT NULL,
  unit_price numeric(12,2) NOT NULL,
  price_updated_on date,
  source_type text NOT NULL,                   -- EXCEL/PDF
  source_id text NOT NULL,                     -- import_run_id / parse_run_id
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, vendor_name)
);

CREATE INDEX IF NOT EXISTS idx_vendor_prices_vendor
  ON vendor_prices (vendor_name);

CREATE INDEX IF NOT EXISTS idx_vendor_prices_product
  ON vendor_prices (product_id);

CREATE INDEX IF NOT EXISTS idx_vendor_prices_updated_at
  ON vendor_prices (updated_at DESC);

-- =========================================================
-- 3) documents（PDF管理：ソフトデリート）
-- =========================================================
CREATE TABLE IF NOT EXISTS documents (
  document_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_hash text NOT NULL,                     -- sha256等（重複許容の方針なのでuniqueにしない）
  storage_key text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  upload_note text,                            -- 任意入力（アップロード者メモ）
  status text NOT NULL DEFAULT 'UPLOADED',      -- UPLOADED/PARSING/PARSED/FAILED/DELETED
  vendor_name text,
  invoice_date date,
  parse_error_summary text,
  is_deleted boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  deleted_reason text,
  CONSTRAINT chk_documents_status
    CHECK (status IN ('UPLOADED','PARSING','PARSED','FAILED','DELETED'))
);

CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents (status);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_at
  ON documents (uploaded_at DESC);

CREATE INDEX IF NOT EXISTS idx_documents_hash
  ON documents (file_hash);

CREATE INDEX IF NOT EXISTS idx_documents_is_deleted
  ON documents (is_deleted);

-- =========================================================
-- 4) document_parse_runs（解析実行単位）
-- =========================================================
CREATE TABLE IF NOT EXISTS document_parse_runs (
  parse_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES documents(document_id),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',       -- RUNNING/SUCCEEDED/FAILED
  model text NOT NULL,                          -- gemini-3-flash-...
  prompt_version text NOT NULL,                 -- v1, v2...
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,      -- 件数/低信頼数/未突合数など
  error_detail text,
  CONSTRAINT chk_parse_runs_status
    CHECK (status IN ('RUNNING','SUCCEEDED','FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_parse_runs_doc
  ON document_parse_runs (document_id, started_at DESC);

-- =========================================================
-- 5) document_line_items（抽出明細）
-- =========================================================
CREATE TABLE IF NOT EXISTS document_line_items (
  line_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parse_run_id uuid NOT NULL REFERENCES document_parse_runs(parse_run_id),
  line_no int NOT NULL,
  product_name_raw text,
  spec_raw text,
  product_key_candidate text,
  quantity numeric(12,3),
  unit_price numeric(12,2),
  amount numeric(12,2),
  model_confidence numeric(4,3),               -- 0.000-1.000（Gemini自己申告）
  system_confidence numeric(4,3),              -- 0.000-1.000（システム算出）
  matched_product_id uuid REFERENCES product_master(product_id),

  CONSTRAINT chk_line_no_positive CHECK (line_no > 0),
  CONSTRAINT chk_model_confidence_range
    CHECK (model_confidence IS NULL OR (model_confidence >= 0 AND model_confidence <= 1)),
  CONSTRAINT chk_system_confidence_range
    CHECK (system_confidence IS NULL OR (system_confidence >= 0 AND system_confidence <= 1)),

  -- v1で「行を安定させる」方針に沿って、同一run内のline_no重複を禁止
  CONSTRAINT uq_line_items_parse_line UNIQUE (parse_run_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_line_items_parse
  ON document_line_items (parse_run_id, line_no);

CREATE INDEX IF NOT EXISTS idx_line_items_key
  ON document_line_items (product_key_candidate);

CREATE INDEX IF NOT EXISTS idx_line_items_matched_product
  ON document_line_items (matched_product_id);

-- =========================================================
-- 6) document_diff_items（差分結果を固定化）
-- =========================================================
CREATE TABLE IF NOT EXISTS document_diff_items (
  diff_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parse_run_id uuid NOT NULL REFERENCES document_parse_runs(parse_run_id),
  line_item_id uuid NOT NULL REFERENCES document_line_items(line_item_id),
  classification text NOT NULL,                 -- UPDATE/NO_CHANGE/UNMATCHED/BLOCKED/NEW_CANDIDATE
  reason text,                                  -- BLOCKED理由など
  vendor_name text,
  invoice_date date,
  before jsonb NOT NULL DEFAULT '{}'::jsonb,    -- DB側スナップショット（必要最小限）
  after jsonb NOT NULL DEFAULT '{}'::jsonb,     -- 抽出側スナップショット

  CONSTRAINT chk_diff_classification
    CHECK (classification IN ('UPDATE','NO_CHANGE','UNMATCHED','BLOCKED','NEW_CANDIDATE')),

  -- 1明細1差分の想定（事故防止）
  CONSTRAINT uq_diff_per_line UNIQUE (parse_run_id, line_item_id)
);

CREATE INDEX IF NOT EXISTS idx_diff_items_parse
  ON document_diff_items (parse_run_id);

CREATE INDEX IF NOT EXISTS idx_diff_items_class
  ON document_diff_items (classification);

CREATE INDEX IF NOT EXISTS idx_diff_items_line_item
  ON document_diff_items (line_item_id);

-- =========================================================
-- 7) update_history（更新履歴：重複防止キー）
-- =========================================================
CREATE TABLE IF NOT EXISTS update_history (
  history_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  update_key text NOT NULL UNIQUE,              -- parse_run_id:product_id:field:vendor など
  product_id uuid NOT NULL REFERENCES product_master(product_id),
  field_name text NOT NULL,                     -- spec / vendor_price 等
  vendor_name text,                             -- vendor_priceの場合
  before_value text,
  after_value text,
  source_type text NOT NULL,                    -- PDF/EXCEL
  source_id text NOT NULL,                      -- parse_run_id / import_run_id
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text                               -- 認証なしのため 'unknown' 固定 + note可
);

CREATE INDEX IF NOT EXISTS idx_update_history_product
  ON update_history (product_id, updated_at DESC);

-- =========================================================
-- 8) excel_import_runs（Excel取込）
-- =========================================================
CREATE TABLE IF NOT EXISTS excel_import_runs (
  import_run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name text NOT NULL,
  file_hash text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'RUNNING',       -- RUNNING/SUCCEEDED/FAILED
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_detail text,

  CONSTRAINT chk_excel_import_status
    CHECK (status IN ('RUNNING','SUCCEEDED','FAILED'))
);

CREATE INDEX IF NOT EXISTS idx_excel_import_runs_started_at
  ON excel_import_runs (started_at DESC);

COMMIT;

-- （任意）作成確認
-- SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;
