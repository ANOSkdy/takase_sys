import { describe, expect, it } from "vitest";
import { makeProductKey, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeText("  a   b  ")).toBe("a b");
  });

  it("removes line breaks and tabs, and applies NFKC", () => {
    expect(normalizeText(" Ａ\tＢ\nＣ  ")).toBe("A B C");
  });
});

describe("makeProductKey", () => {
  it("joins name and spec when spec exists", () => {
    expect(makeProductKey(" バルブ ", " 20Ａ ")).toBe("バルブ｜20A");
  });

  it("uses only name when spec is empty", () => {
    expect(makeProductKey(" バルブ ", "")).toBe("バルブ");
  });
});
