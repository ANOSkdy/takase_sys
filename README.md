# takase_sys

納品書（PDF）+ Excel（材料仕切り表）を参照し、商品マスタ（単価・品番/規格 等）を安全側に倒して更新するシステム。

## Target stack
- Next.js (App Router) + TypeScript（Node Runtime）
- Deploy: Vercel（Production / Preview / Development）
- DB: Neon（Postgres）
- AI: Gemini API（gemini 3 Flash）

## No in-app authentication
- アプリ内認証は実装しない方針
- アクセス制御はアプリ外（Vercel保護、社内共有制限など）で担保する

## Security rules (must)
- Secretsは絶対にコミットしない（.env*, tokens, DB URLs）
- NEXT_PUBLIC_* にトークン禁止（クライアントへ露出するため）
- DB / Gemini / Storage の資格情報は server-only

## DB migration policy
- Production DBマイグレーションは自動化しない
- Previewで自動化する場合も「環境 + フラグ」の二重ゲートが必須

## Notes
- v1 schema は db/schema/v1.sql に保存（Neonへ投入済み）
