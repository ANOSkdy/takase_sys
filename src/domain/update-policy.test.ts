import { describe, expect, it } from "vitest";
import { PRICE_DEVIATION_MAX, SYSTEM_CONFIDENCE_MIN, shouldBlockUpdate } from "./update-policy";

describe("shouldBlockUpdate", () => {
  it("blocks when vendor is missing", () => {
    const result = shouldBlockUpdate({
      systemConfidenceNum: SYSTEM_CONFIDENCE_MIN + 0.01,
      vendorName: null,
      unitPriceNum: 10,
      keyIsWeak: false,
      deviation: 0,
    });
    expect(result.blocked).toBe(true);
  });

  it("blocks when unit price is missing", () => {
    const result = shouldBlockUpdate({
      systemConfidenceNum: SYSTEM_CONFIDENCE_MIN + 0.01,
      vendorName: "Vendor",
      unitPriceNum: null,
      keyIsWeak: false,
      deviation: 0,
    });
    expect(result.blocked).toBe(true);
  });

  it("blocks when deviation is too high", () => {
    const result = shouldBlockUpdate({
      systemConfidenceNum: SYSTEM_CONFIDENCE_MIN + 0.01,
      vendorName: "Vendor",
      unitPriceNum: 10,
      keyIsWeak: false,
      deviation: PRICE_DEVIATION_MAX + 0.1,
    });
    expect(result.blocked).toBe(true);
  });
});
