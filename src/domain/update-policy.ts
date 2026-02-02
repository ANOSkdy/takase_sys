import { safeParseFloat } from "@/domain/pg-numeric";

export const SYSTEM_CONFIDENCE_MIN = 0.85;
export const SPEC_UPDATE_MIN = 0.9;
export const PRICE_DEVIATION_MAX = 0.3;

type UpdatePolicyInput = {
  systemConfidence: string | null;
  priceDeviation: number | null;
  requiresSpecUpdate: boolean;
  requiresPriceUpdate: boolean;
};

export type UpdatePolicyResult = {
  blocked: boolean;
  reason?: string;
};

export function shouldBlockUpdate(input: UpdatePolicyInput): UpdatePolicyResult {
  const systemConfidence = safeParseFloat(input.systemConfidence);
  if (systemConfidence === null || systemConfidence < SYSTEM_CONFIDENCE_MIN) {
    return { blocked: true, reason: "LOW_CONFIDENCE" };
  }

  if (input.requiresSpecUpdate && systemConfidence < SPEC_UPDATE_MIN) {
    return { blocked: true, reason: "SPEC_CONFIDENCE_LOW" };
  }

  if (input.requiresPriceUpdate) {
    const deviation = input.priceDeviation;
    if (deviation === null) {
      return { blocked: true, reason: "PRICE_UNKNOWN" };
    }
    if (deviation > PRICE_DEVIATION_MAX) {
      return { blocked: true, reason: "PRICE_DEVIATION_HIGH" };
    }
  }

  return { blocked: false };
}
