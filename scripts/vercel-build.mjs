import { execSync } from "node:child_process";

function run(cmd) {
  execSync(cmd, { stdio: "inherit" });
}

const vercelEnv = process.env.VERCEL_ENV ?? "unknown";
const migrateFlag = process.env.MIGRATE_ON_PREVIEW ?? "";
const isPreview = vercelEnv === "preview";
const shouldMigrate = isPreview && migrateFlag === "1";

console.log(
  `[vercel-build] VERCEL_ENV=${vercelEnv} MIGRATE_ON_PREVIEW=${migrateFlag || "(unset)"}`,
);

// Safety: never auto-migrate outside preview
if (shouldMigrate) {
  const hasDb = Boolean(process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL);
  if (!hasDb) {
    console.warn("[vercel-build] DATABASE_URL(_UNPOOLED) not set. Skip generate/migrate.");
  } else {
    console.log("[vercel-build] Running db:migrate then db:verify (preview only).");
    run("pnpm db:migrate");
    run("pnpm db:verify");
  }
} else {
  console.log("[vercel-build] Skip migrations (not preview or flag off).");
}

// Always build
run("pnpm build");
