import { describe, expect, it } from "vitest";
import {
  compareProducts,
  extractModelTokens,
  extractSizeTokens,
  nameSimilarity,
} from "@/domain/product-similarity";

const wtp150 = {
  productName: "ウェザータイト(防水部材)",
  productMaker: "フクビ化学工業(株)",
  spec: "パイプ用 150φ WTP150 □255mm",
};

describe("token extraction", () => {
  it("extracts model numbers that mix letters and digits", () => {
    expect(extractModelTokens("パイプ用 150φ WTP150 □255mm")).toEqual(["WTP150"]);
    expect(extractModelTokens("ホワイト SFJ-77-W")).toEqual(["SFJ-77-W"]);
    expect(extractModelTokens("バルブ 20A 255mm")).toEqual([]);
    expect(extractModelTokens("天井点検口 アルミ")).toEqual([]);
  });

  it("extracts sizes with units, including full-width input", () => {
    expect(extractSizeTokens("パイプ用 150φ WTP150 □255mm")).toEqual(["150φ", "255mm"]);
    expect(extractSizeTokens("φ１００ ２０Ａ")).toEqual(["100φ", "20A"]);
    expect(extractSizeTokens("ホワイト")).toEqual([]);
  });

  it("scores similar names higher than unrelated ones", () => {
    expect(nameSimilarity("ウェザータイト(防水部材)", "ウェザータイト（防水部材）")).toBe(1);
    expect(nameSimilarity("ウェザータイト", "スリムダクト")).toBeLessThan(0.3);
  });
});

describe("compareProducts", () => {
  it("treats the same product with a different maker notation as a candidate", () => {
    const result = compareProducts(wtp150, {
      productName: "ウェザータイト（防水部材）",
      productMaker: "フクビ化学工業（株）",
      spec: "パイプ用 150φ WTP150 □255mm",
    });
    expect(result.isCandidate).toBe(true);
    expect(result.matchedFields).toEqual(["品名", "メーカー", "型番", "口径・寸法", "規格"]);
    expect(result.differingFields).toEqual([]);
  });

  it("always reports a size difference even when the name is identical", () => {
    const result = compareProducts(wtp150, {
      productName: "ウェザータイト(防水部材)",
      productMaker: "フクビ化学工業(株)",
      spec: "パイプ用 100φ WTP100 □205mm",
    });
    expect(result.matchedFields).toContain("品名");
    expect(result.differingFields).toEqual([
      "型番（WTP150 ／ WTP100）",
      "口径・寸法（150φ 255mm ／ 100φ 205mm）",
      "規格",
    ]);
    // 同名なので候補には出すが、同一商品とは判定しない（相違を必ず併記する）。
    expect(result.isCandidate).toBe(true);
  });

  it("finds a candidate by model number when the name differs", () => {
    const result = compareProducts(wtp150, {
      productName: "防水パイプ部材",
      productMaker: null,
      spec: "WTP150",
    });
    expect(result.isCandidate).toBe(true);
    expect(result.matchedFields).toContain("型番");
    expect(result.differingFields).toContain("品名");
  });

  it("does not suggest unrelated products", () => {
    const result = compareProducts(wtp150, {
      productName: "スリムダクト",
      productMaker: "因幡電機産業(株)",
      spec: "SFJ-77",
    });
    expect(result.isCandidate).toBe(false);
  });

  it("does not treat a missing maker as a match or a difference", () => {
    const result = compareProducts(wtp150, { ...wtp150, productMaker: null });
    expect(result.matchedFields).not.toContain("メーカー");
    expect(result.differingFields).not.toContain("メーカー");
  });
});
