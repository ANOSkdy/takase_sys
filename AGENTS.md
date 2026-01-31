# AGENTS.md

## Working agreements (safety-first)

- 1 PR = 1 concern. Keep diffs minimal.
- Never commit secrets (.env\*, tokens, DB URLs).
- No client-side secrets (NO NEXT*PUBLIC*\* tokens).
- Gemini / DB / Storage credentials are server-only.
- Do NOT enable automatic production migrations.
- External service UI ops (Vercel/Neon settings, permissions, billing) are human-owned.
- This app has NO in-app authentication: access must be protected outside the app (Vercel protection, etc).

## Stack (target)

- Next.js (App Router) + TypeScript + pnpm
- Deploy: Vercel (Production / Preview / Development)
- DB: Neon (Postgres)
- AI: Gemini API (gemini 3 Flash)
- Runtime: Node.js (Vercel Functions)

## Commands (available after scaffold)

- Install: pnpm install
- Dev: pnpm dev
- Lint: pnpm lint
- Typecheck: pnpm typecheck
- Test: pnpm test
- Build: pnpm build

## DB policy

- runtime: DATABASE_URL (pooled)
- migrations/tools: DATABASE_URL_UNPOOLED (direct)
- Production migrations are manual (human), never automatic.
