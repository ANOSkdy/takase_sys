import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "@/config/env";

describe("serverEnvSchema", () => {
  it("requires database url and storage provider", () => {
    const result = serverEnvSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("accepts minimum required variables", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgres://example",
      STORAGE_PROVIDER: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "token",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty string when provided", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "",
      STORAGE_PROVIDER: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "token",
    });
    expect(result.success).toBe(false);
  });

  it("requires blob token when using vercel-blob", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgres://example",
      STORAGE_PROVIDER: "vercel-blob",
    });
    expect(result.success).toBe(false);
  });

  it("accepts APP_MAX_PDF_PAGES as a positive integer", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgres://example",
      STORAGE_PROVIDER: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "token",
      APP_MAX_PDF_PAGES: "30",
    });
    expect(result.success).toBe(true);
  });

  it("rejects APP_MAX_PDF_PAGES when zero", () => {
    const result = serverEnvSchema.safeParse({
      DATABASE_URL: "postgres://example",
      STORAGE_PROVIDER: "vercel-blob",
      BLOB_READ_WRITE_TOKEN: "token",
      APP_MAX_PDF_PAGES: "0",
    });
    expect(result.success).toBe(false);
  });
});
