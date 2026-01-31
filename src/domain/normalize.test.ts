import { describe, expect, it } from "vitest";
import { normalizeText } from "./normalize";

describe("normalizeText", () => {
  it("trims and collapses spaces", () => {
    expect(normalizeText("  a   b  ")).toBe("a b");
  });
});
