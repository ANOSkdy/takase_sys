import { describe, expect, it } from "vitest";
import {
  canCreateProvisionalProduct,
  collectAttentionReasons,
  decideUnverifiedPriceAction,
  formatAttentionReason,
  isAmountConsistent,
  isAutoUpdatableStatus,
  makersConflict,
} from "@/domain/provisional-product";

describe("canCreateProvisionalProduct", () => {
  it("keeps the previous new-candidate threshold", () => {
    expect(canCreateProvisionalProduct(0.9)).toBe(true);
    expect(canCreateProvisionalProduct(1)).toBe(true);
    expect(canCreateProvisionalProduct(0.899)).toBe(false);
    expect(canCreateProvisionalProduct(null)).toBe(false);
  });
});

describe("isAutoUpdatableStatus", () => {
  it("allows automatic updates only for legacy and verified products", () => {
    expect(isAutoUpdatableStatus("LEGACY")).toBe(true);
    expect(isAutoUpdatableStatus("VERIFIED")).toBe(true);
    expect(isAutoUpdatableStatus("PROVISIONAL")).toBe(false);
    expect(isAutoUpdatableStatus("NEEDS_REVIEW")).toBe(false);
    expect(isAutoUpdatableStatus("MERGED")).toBe(false);
  });
});

describe("attention reasons", () => {
  const complete = {
    unitPrice: 383,
    quantity: 2,
    amount: 766,
    vendorName: "山田興業株式会社",
    invoiceDate: "2026-11-04",
    spec: "WTP150",
  };

  it("returns nothing for a complete, consistent line", () => {
    expect(collectAttentionReasons(complete)).toEqual([]);
    expect(formatAttentionReason([])).toBeNull();
  });

  it("lists missing fields and an amount mismatch without inventing a price", () => {
    const reasons = collectAttentionReasons({
      ...complete,
      unitPrice: null,
      vendorName: null,
      invoiceDate: null,
      spec: null,
    });
    expect(reasons).toEqual(["単価なし", "仕入先不明", "売上日不明", "規格なし"]);
    expect(collectAttentionReasons({ ...complete, amount: 900 })).toEqual([
      "数量×単価と金額が不一致",
    ]);
    expect(formatAttentionReason(reasons)).toBe("単価なし、仕入先不明、売上日不明、規格なし");
  });

  it("cannot judge amount consistency when a value is missing", () => {
    expect(isAmountConsistent(null, 10, 10)).toBeNull();
    expect(isAmountConsistent(2, 383, 766)).toBe(true);
    expect(isAmountConsistent(2, 383, 900)).toBe(false);
  });
});

describe("makersConflict", () => {
  it("is a conflict only when both makers are present and differ after normalization", () => {
    expect(makersConflict("フクビ化学工業(株)", "因幡電機産業(株)")).toBe(true);
    expect(makersConflict("フクビ化学工業（株）", "フクビ化学工業(株)")).toBe(false);
    expect(makersConflict(null, "因幡電機産業(株)")).toBe(false);
    expect(makersConflict("因幡電機産業(株)", "")).toBe(false);
  });
});

describe("decideUnverifiedPriceAction", () => {
  it("adds a price only when none exists for the vendor", () => {
    expect(
      decideUnverifiedPriceAction({ existingUnitPrice: null, newUnitPrice: 383, vendorName: "v" }),
    ).toBe("ADD");
  });

  it("never overwrites an existing price", () => {
    expect(
      decideUnverifiedPriceAction({ existingUnitPrice: 383, newUnitPrice: 400, vendorName: "v" }),
    ).toBe("CONFLICT");
    expect(
      decideUnverifiedPriceAction({ existingUnitPrice: 383, newUnitPrice: 383, vendorName: "v" }),
    ).toBe("NONE");
  });

  it("does nothing without a price or a vendor", () => {
    expect(
      decideUnverifiedPriceAction({ existingUnitPrice: null, newUnitPrice: null, vendorName: "v" }),
    ).toBe("NONE");
    expect(
      decideUnverifiedPriceAction({ existingUnitPrice: null, newUnitPrice: 383, vendorName: null }),
    ).toBe("NONE");
  });
});
