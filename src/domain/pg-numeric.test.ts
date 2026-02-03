import { describe, expect, it } from "vitest";
import { safeParseFloat, toNumericString } from "./pg-numeric";

describe("safeParseFloat", () => {
  it("returns null for empty or invalid", () => {
    expect(safeParseFloat("")).toBeNull();
    expect(safeParseFloat("abc")).toBeNull();
  });

  it("parses numeric strings", () => {
    expect(safeParseFloat("12.5")).toBeCloseTo(12.5);
  });
});

describe("toNumericString", () => {
  it("formats numbers with scale", () => {
    expect(toNumericString(12.3456, 2)).toBe("12.35");
  });

  it("returns null for invalid values", () => {
    expect(toNumericString("NaN", 2)).toBeNull();
  });
});
