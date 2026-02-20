import { describe, expect, it } from "vitest";
import { toPgDateString } from "@/services/documents/pg-date";

describe("toPgDateString", () => {
  it("converts Date to YYYY-MM-DD", () => {
    expect(toPgDateString(new Date("2026-02-20T12:34:56.000Z"))).toBe("2026-02-20");
  });

  it("passes through valid date string", () => {
    expect(toPgDateString("2026-02-20")).toBe("2026-02-20");
  });

  it("returns null for invalid input", () => {
    expect(toPgDateString("2026/02/20")).toBeNull();
    expect(toPgDateString(new Date("not-a-date"))).toBeNull();
  });
});
