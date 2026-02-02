export const SYSTEM_CONFIDENCE_MIN = 0.85;
export const SPEC_UPDATE_MIN = 0.9;
export const PRICE_DEVIATION_MAX = 0.3;

export type ConfidenceInput = {
  productName: string | null;
  spec: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
};

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function computeSystemConfidence(input: ConfidenceInput): number {
  if (!input.productName) return 0;
  let score = 0.9;

  if (!input.unitPrice || input.unitPrice <= 0) {
    score -= 0.25;
  }

  if (input.quantity != null && input.unitPrice != null && input.amount != null) {
    const expected = input.quantity * input.unitPrice;
    if (expected > 0) {
      const ratio = Math.abs(expected - input.amount) / expected;
      if (ratio <= 0.02) score += 0.08;
      if (ratio >= 0.2) score -= 0.15;
    }
  }

  if (!input.spec) {
    score = Math.min(score, SYSTEM_CONFIDENCE_MIN);
  }

  return clamp01(score);
}

export function priceDeviationRatio(newPrice: number, existingPrice: number): number {
  if (existingPrice <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(newPrice - existingPrice) / existingPrice;
}

export function isPriceDeviationWithin(
  newPrice: number,
  existingPrice: number,
  maxRatio = PRICE_DEVIATION_MAX,
): boolean {
  return priceDeviationRatio(newPrice, existingPrice) <= maxRatio;
}

export type BlockedReasonInput = {
  systemConfidence: number;
  unitPrice: number | null;
  productKeyCandidate: string | null;
  priceDeviationRatio?: number | null;
};

export function getBlockedReason(input: BlockedReasonInput): string | null {
  if (!input.productKeyCandidate) return "MISSING_PRODUCT_KEY";
  if (!input.unitPrice || input.unitPrice <= 0) return "INVALID_UNIT_PRICE";
  if (input.systemConfidence < SYSTEM_CONFIDENCE_MIN) return "LOW_SYSTEM_CONFIDENCE";
  if (input.priceDeviationRatio != null && input.priceDeviationRatio > PRICE_DEVIATION_MAX) {
    return "PRICE_DEVIATION_TOO_LARGE";
  }
  return null;
}
