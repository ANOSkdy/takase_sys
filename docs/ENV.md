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

## Migration gates (must)

- Production migrations must be manual (human), never automatic.
- If preview migrations are ever enabled, use explicit env + flag gate.
