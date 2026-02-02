import { describe, expect, it } from "vitest";
import {
  computeSystemConfidence,
  isPriceDeviationWithin,
  priceDeviationRatio,
  SYSTEM_CONFIDENCE_MIN,
} from "./update-policy";

describe("computeSystemConfidence", () => {
  it("returns 0 when product name is missing", () => {
    expect(
      computeSystemConfidence({
        productName: null,
        spec: null,
        quantity: 1,
        unitPrice: 100,
        amount: 100,
      }),
    ).toBe(0);
  });

  it("caps confidence when spec is missing", () => {
    const score = computeSystemConfidence({
      productName: "バルブ",
      spec: null,
      quantity: 1,
      unitPrice: 100,
      amount: 100,
    });
    expect(score).toBeLessThanOrEqual(SYSTEM_CONFIDENCE_MIN);
  });

  it("boosts score when amount matches quantity * unit price", () => {
    const score = computeSystemConfidence({
      productName: "バルブ",
      spec: "20A",
      quantity: 2,
      unitPrice: 100,
      amount: 200,
    });
    expect(score).toBeGreaterThan(0.9);
  });
});

describe("price deviation", () => {
  it("computes ratio", () => {
    expect(priceDeviationRatio(130, 100)).toBeCloseTo(0.3);
  });

  it("checks within threshold", () => {
    expect(isPriceDeviationWithin(129, 100)).toBe(true);
    expect(isPriceDeviationWithin(140, 100)).toBe(false);
  });
});
