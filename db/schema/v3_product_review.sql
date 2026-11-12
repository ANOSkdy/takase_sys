-- 仮登録商品・出典・確認履歴 (PostgreSQL / Neon)
-- 本番は人が手動実行する。自動マイグレーション対象外。
-- DDLのみ。既存の解析候補の登録・単価変更・承認は行わない。
-- 再実行可能だが、同名オブジェクトの定義変更には別マイグレーションが必要。

BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- LEGACY は確認済みを意味しない。既存アプリのINSERTにも互換性を残す。
ALTER TABLE public.product_master
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS merged_into_product_id uuid
    REFERENCES public.product_master(product_id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_master'::regclass
      AND conname = 'chk_product_master_review_status'
  ) THEN
    ALTER TABLE public.product_master
      ADD CONSTRAINT chk_product_master_review_status
      CHECK (review_status IN ('LEGACY', 'PROVISIONAL', 'NEEDS_REVIEW', 'VERIFIED', 'MERGED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.product_master'::regclass
      AND conname = 'chk_product_master_merge_target'
  ) THEN
    ALTER TABLE public.product_master
      ADD CONSTRAINT chk_product_master_merge_target CHECK (
        (review_status = 'MERGED' AND merged_into_product_id IS NOT NULL
          AND merged_into_product_id <> product_id)
        OR (review_status <> 'MERGED' AND merged_into_product_id IS NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.product_master.review_status IS
  'LEGACY=既存データ(確認済みではない), PROVISIONAL=仮登録, NEEDS_REVIEW=要確認, VERIFIED=人が確認済み, MERGED=統合済み。新規PDF仮登録時はPROVISIONALを明示する';
COMMENT ON COLUMN public.product_master.reviewed_by IS
  'アプリ内認証なし。入力された確認者名等の記録であり、本人認証の証跡ではない';

CREATE INDEX IF NOT EXISTS idx_product_master_review_status
  ON public.product_master (review_status);

-- 1商品に複数の出典を保持できる。1つの抽出明細の現在の紐付け先は1商品。
-- PDF URLは保存せず、line_item -> parse_run -> documents.storage_key から生成。
CREATE TABLE IF NOT EXISTS public.product_document_sources (
  line_item_id uuid PRIMARY KEY
    REFERENCES public.document_line_items(line_item_id) ON DELETE RESTRICT,
  product_id uuid NOT NULL
    REFERENCES public.product_master(product_id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  linked_by text,
  link_method text NOT NULL
    CHECK (link_method IN ('PROVISIONAL_CREATE', 'EXACT_MATCH', 'MANUAL_LINK')),
  attention_reason text,
  match_candidates jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(match_candidates) = 'array')
);

CREATE INDEX IF NOT EXISTS idx_product_document_sources_product
  ON public.product_document_sources (product_id, linked_at DESC);

COMMENT ON COLUMN public.product_document_sources.match_candidates IS
  '照合時点の候補スナップショット配列。要素例: {productId, productName, spec, matchedFields, differingFields, reason}。候補は確定した紐付けではない';

-- 商品統合時も元の商品行を削除せず、履歴に統合先と変更前後を記録する。
-- 状態更新・出典の付け替え・履歴追加はアプリで同一トランザクションにする。
CREATE TABLE IF NOT EXISTS public.product_review_history (
  review_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL
    REFERENCES public.product_master(product_id) ON DELETE RESTRICT,
  action text NOT NULL
    CHECK (action IN ('PROVISIONAL_CREATE', 'VERIFY', 'REQUEST_REVIEW', 'CORRECT', 'MERGE')),
  target_product_id uuid
    REFERENCES public.product_master(product_id) ON DELETE RESTRICT,
  source_line_item_id uuid
    REFERENCES public.document_line_items(line_item_id) ON DELETE RESTRICT,
  before_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(before_snapshot) = 'object'),
  after_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(after_snapshot) = 'object'),
  note text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by text NOT NULL CHECK (btrim(reviewed_by) <> ''),
  CONSTRAINT chk_product_review_merge_target CHECK (
    (action = 'MERGE' AND target_product_id IS NOT NULL AND target_product_id <> product_id)
    OR (action <> 'MERGE' AND target_product_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_product_review_history_product
  ON public.product_review_history (product_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_review_history_target
  ON public.product_review_history (target_product_id)
  WHERE target_product_id IS NOT NULL;

COMMIT;

-- 手動実行後の確認（任意）:
-- SELECT review_status, count(*) FROM public.product_master GROUP BY review_status;
-- SELECT to_regclass('public.product_document_sources'),
--        to_regclass('public.product_review_history');

-- アプリ対応が別途必要:
-- 1. PROVISIONAL / NEEDS_REVIEW の表示、検索結果への出典・候補の追加。
-- 2. 仮登録を確認済み商品と同じ自動更新対象にしない。
-- 3. 仮登録先への再取込は集約し、未確認状態を維持する。
-- 4. PDFは既存のアクセス保護を通じて配信する。
-- 5. 今回の68候補の移行は、重複・価格・出典を確認する別のデータ移行で実施。
-- 6. MERGEDは検索・自動照合から除外。統合先は非MERGEDとし、循環を防止する。
