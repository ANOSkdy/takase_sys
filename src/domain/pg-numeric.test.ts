import { describe, expect, it } from "vitest";
import { safeParseFloat, toNumericString } from "./pg-numeric";

describe("safeParseFloat", () => {
  it("returns null for empty input", () => {
    expect(safeParseFloat("")).toBeNull();
    expect(safeParseFloat("   ")).toBeNull();
  });

  it("parses numeric strings and numbers", () => {
    expect(safeParseFloat("12.34")).toBe(12.34);
    expect(safeParseFloat(5)).toBe(5);
  });

  it("rejects non-numeric values", () => {
    expect(safeParseFloat("abc")).toBeNull();
    expect(safeParseFloat(Number.NaN)).toBeNull();
  });
});

describe("toNumericString", () => {
  it("returns fixed scale string", () => {
    expect(toNumericString(1.2, 2)).toBe("1.20");
    expect(toNumericString("3", 3)).toBe("3.000");
  });

  it("returns null for invalid values", () => {
    expect(toNumericString("bad", 2)).toBeNull();
  });
});
