# ENV

## Policy

- Secrets are server-only. Never commit real values.
- Do NOT put secrets into NEXT*PUBLIC*\* (client-exposed).
- This app has no in-app authentication. Protect access outside the app (Vercel protection, etc).

## Environments (Vercel)

- Development: local
- Preview: per-PR preview deployment
- Production: main branch

## Required server env (later PRs will use these)

- DATABASE_URL (Neon pooled) - runtime
- DATABASE_URL_UNPOOLED - admin/migration tools
- GEMINI_API_KEY - Gemini API
- STORAGE_PROVIDER - e.g. vercel-blob

## Feature flags (server)

- ENABLE_PROVISIONAL_PRODUCTS - `1` / `true` で、PDF解析時に既存商品へ一致しない明細を仮登録（`PROVISIONAL`）し、出典と確認履歴を保存する。未設定・それ以外は無効で、従来どおり新規商品候補として差分に残すだけになる。
  - 設定は環境ごと（Preview / Production）に人が行う。まず Preview で有効にして確認する。
  - 問題が出た場合は無効に戻すと新規の仮登録と出典の追加が止まる。作成済みの商品・出典・履歴はそのまま残る。
  - 統合済み商品の除外と、未確認商品を自動更新しない制御は、この値にかかわらず常に働く。

## Migration gates (must)

- Production migrations must be manual (human), never automatic.
- If preview migrations are ever enabled, use explicit env + flag gate.
