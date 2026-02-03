# Lockfile recovery (ERR_PNPM_OUTDATED_LOCKFILE / @vercel/blob 403)

## Summary

In CI/Vercel, `pnpm install --frozen-lockfile` fails if `pnpm-lock.yaml` does not match
`package.json`. This repo now depends on `@vercel/blob`, but in some environments
`pnpm install` fails with HTTP 403 when fetching `@vercel/blob`, so the lockfile cannot
be regenerated there.

## What this means

- Vercel uses frozen-lockfile by default, so the lockfile must be committed.
- If your environment cannot download `@vercel/blob`, you must update the lockfile
  from a machine that can reach the npm registry.

## Recovery steps (run locally)

Use pnpm 10.28.2 (per `package.json#packageManager`) and regenerate the lockfile:

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install
pnpm install --frozen-lockfile
pnpm build
git add pnpm-lock.yaml
git commit -m "chore: sync pnpm lockfile"
```

## Notes

- Do **not** set `--no-frozen-lockfile` permanently in Vercel; the correct fix is
  committing an updated `pnpm-lock.yaml`.
- Do not add any auth tokens to `.npmrc`; `@vercel/blob` is a public package.
