import { z } from "zod";

/**
 * Server environment schema.
 * IMPORTANT:
 * - Do NOT validate at import time (keep build stable).
 * - Call getEnv() only in server runtime paths.
 */
export const serverEnvSchema = z.object({
  // Neon / Postgres
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),

  // Gemini
  GEMINI_API_KEY: z.string().min(1).optional(),

  // Storage (provider-agnostic)
  STORAGE_PROVIDER: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),

  // Upload limits
  APP_MAX_PDF_MB: z.coerce.number().int().positive().optional(),

  // Preview-only gate (future use)
  MIGRATE_ON_PREVIEW: z.string().optional(),

  // Production migration gates (future use)
  ALLOW_PROD_MIGRATION: z.string().optional(),
  CONFIRM_PROD_MIGRATION: z.string().optional(),
}).superRefine((env, ctx) => {
  if (env.STORAGE_PROVIDER === "vercel-blob" && !env.BLOB_READ_WRITE_TOKEN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "BLOB_READ_WRITE_TOKEN is required for vercel-blob",
      path: ["BLOB_READ_WRITE_TOKEN"],
    });
  }
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

function assertServerOnly() {
  // If executed in browser (client), fail fast.
  if (typeof window !== "undefined") {
    throw new Error("env module is server-only. Do not import from client code.");
  }
}

/**
 * Validate and return server env.
 * Call this only inside server runtime paths (Route Handlers, server actions, etc).
 */
export function getEnv(): ServerEnv {
  assertServerOnly();

  // Tripwire: never place secrets in NEXT_PUBLIC_*
  const suspicious = Object.keys(process.env).filter(
    (k) => k.startsWith("NEXT_PUBLIC_") && /KEY|TOKEN|SECRET|DATABASE/i.test(k),
  );
  if (suspicious.length > 0) {
    throw new Error(`Do not put secrets into NEXT_PUBLIC_*: ${suspicious.join(", ")}`);
  }

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const fields = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new Error(`Invalid server env variables: ${fields}`);
  }
  return parsed.data;
}

export function requireEnv(value: string | undefined, keyName: string): string {
  if (!value) throw new Error(`${keyName} is required`);
  return value;
}
