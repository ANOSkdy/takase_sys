import { describe, expect, it } from "vitest";
import { normalizeIncomingCategory, resolveCategory } from "@/services/documents/category";

describe("normalizeIncomingCategory", () => {
  it("treats placeholder and empty values as missing", () => {
    expect(normalizeIncomingCategory(null)).toBeNull();
    expect(normalizeIncomingCategory("")).toBeNull();
    expect(normalizeIncomingCategory("   ")).toBeNull();
    expect(normalizeIncomingCategory("未分類")).toBeNull();
  });

  it("keeps valid categories", () => {
    expect(normalizeIncomingCategory("鋼材")).toBe("鋼材");
  });
});

describe("resolveCategory", () => {
  it("preserves existing category when incoming is missing", () => {
    expect(resolveCategory({ existing: "ボルト", incoming: null })).toBe("ボルト");
    expect(resolveCategory({ existing: "ボルト", incoming: "" })).toBe("ボルト");
    expect(resolveCategory({ existing: "ボルト", incoming: "未分類" })).toBe("ボルト");
  });

  it("falls back to default when both are missing", () => {
    expect(resolveCategory({ existing: null, incoming: null })).toBe("未分類");
  });
});
