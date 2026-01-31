# SECURITY

## Secrets

- Secretsは絶対にコミットしない（.env\*, tokens, DB URLs）
- .env.example はダミーのみ
- NEXT*PUBLIC*\* にトークン禁止（クライアントに露出するため）
- Gemini / DB / Storage は server-only

## No in-app authentication

- アプリ内認証は実装しない
- アクセス制御はアプリ外（Vercel保護等）で担保する

## Logging

- APIキー、DB接続文字列、個人情報（住所・電話など）をログに残さない
