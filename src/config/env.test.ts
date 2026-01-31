import { describe, expect, it } from "vitest";
import { serverEnvSchema } from "@/config/env";

describe("serverEnvSchema", () => {
  it("accepts empty object (optional keys)", () => {
    const result = serverEnvSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects empty string when provided", () => {
    const result = serverEnvSchema.safeParse({ DATABASE_URL: "" });
    expect(result.success).toBe(false);
  });
});
