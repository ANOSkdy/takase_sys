import { describe, expect, it } from "vitest";
import { makeProductKey, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeText("  a   b  ")).toBe("a b");
  });

  it("normalizes tabs and newlines", () => {
    expect(normalizeText("a\tb\nc")).toBe("a b c");
  });
});

describe("makeProductKey", () => {
  it("joins name and spec with delimiter", () => {
    expect(makeProductKey("商品A", "規格B")).toBe("商品A｜規格B");
  });

  it("returns name only when spec missing", () => {
    expect(makeProductKey("商品A", null)).toBe("商品A");
  });
});
