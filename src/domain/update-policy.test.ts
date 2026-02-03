import { describe, expect, it } from "vitest";
import { shouldBlockUpdate } from "./update-policy";

describe("shouldBlockUpdate", () => {
  it("blocks when confidence is low", () => {
    const result = shouldBlockUpdate({
      systemConfidenceNum: 0.5,
      vendorName: "Vendor",
      unitPriceNum: 100,
      keyIsWeak: false,
      deviation: 0.1,
    });
    expect(result.blocked).toBe(true);
  });

  it("allows updates when within thresholds", () => {
    const result = shouldBlockUpdate({
      systemConfidenceNum: 0.95,
      vendorName: "Vendor",
      unitPriceNum: 100,
      keyIsWeak: false,
      deviation: 0.1,
    });
    expect(result.blocked).toBe(false);
  });
});
