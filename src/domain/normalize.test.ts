import { describe, expect, it } from "vitest";
import { makeProductKey, normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeText("  a   b  ")).toBe("a b");
  });

  it("normalizes unicode and strips newlines", () => {
    expect(normalizeText("Ａ\tＢ\nＣ")).toBe("A B C");
  });
});

describe("makeProductKey", () => {
  it("joins name and spec with a separator", () => {
    expect(makeProductKey("Foo", "Bar")).toBe("Foo｜Bar");
  });

  it("uses only name when spec is missing", () => {
    expect(makeProductKey("Foo")).toBe("Foo");
  });
});
