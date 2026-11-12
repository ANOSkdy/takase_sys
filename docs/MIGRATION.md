# MIGRATION

## Policy

- Production DBマイグレーションは自動化しない
- Previewで自動化する場合でも「環境 + フラグ」の二重ゲートが必須

## Current status

- v1 schema は Neon SQL Editor で適用済み（手動）
- 再現性のため、投入SQLのスナップショットを db/schema/v1.sql に保存する

## Notes (must)

- Vercel の buildCommand に migration を含めない
- migration/admin 用に DATABASE_URL_UNPOOLED を使う想定（runtimeとは分離）
- v3（仮登録商品・出典・確認履歴）は db/schema/v3_product_review.sql を手動実行する。アプリは追加列を参照するため、デプロイ前に対象環境へ適用し `pnpm db:verify` で確認する
