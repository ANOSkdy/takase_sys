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
