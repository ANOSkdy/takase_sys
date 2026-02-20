import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoDateSqlParams } from "@/db/sql-params";

describe("assertNoDateSqlParams", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws in test mode when Date is in SQL params", () => {
    vi.stubEnv("NODE_ENV", "test");

    expect(() => assertNoDateSqlParams(["ok", new Date("2026-01-01")], "unit-test")).toThrow(
      "Date parameter is not allowed: index=1, context=unit-test",
    );
  });

  it("does not throw in production mode", () => {
    vi.stubEnv("NODE_ENV", "production");

    expect(() => assertNoDateSqlParams([new Date("2026-01-01")], "unit-test")).not.toThrow();
  });
});
