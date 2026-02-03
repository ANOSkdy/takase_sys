export const SYSTEM_CONFIDENCE_MIN = 0.85;
export const SPEC_UPDATE_MIN = 0.9;
export const PRICE_DEVIATION_MAX = 0.3;

type UpdatePolicyInput = {
  systemConfidenceNum: number | null;
  vendorName: string | null;
  unitPriceNum: number | null;
  keyIsWeak: boolean;
  deviation: number | null;
};

export type UpdatePolicyResult = {
  blocked: boolean;
  reason?: string;
};

export function shouldBlockUpdate(input: UpdatePolicyInput): UpdatePolicyResult {
  const systemConfidence = input.systemConfidenceNum;
  if (systemConfidence === null || systemConfidence < SYSTEM_CONFIDENCE_MIN) {
    return { blocked: true, reason: "LOW_CONFIDENCE" };
  }

  if (input.keyIsWeak && systemConfidence < SPEC_UPDATE_MIN) {
    return { blocked: true, reason: "KEY_CONFIDENCE_LOW" };
  }

  if (!input.vendorName) {
    return { blocked: true, reason: "VENDOR_MISSING" };
  }

  if (input.unitPriceNum === null) {
    return { blocked: true, reason: "PRICE_MISSING" };
  }

  const deviation = input.deviation;
  if (deviation === null) {
    return { blocked: true, reason: "PRICE_UNKNOWN" };
  }
  if (deviation !== null && deviation > PRICE_DEVIATION_MAX) {
    return { blocked: true, reason: "PRICE_DEVIATION_HIGH" };
  }

  return { blocked: false };
}
