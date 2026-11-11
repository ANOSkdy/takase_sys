import { normalizeText } from "@/domain/normalize";
import type { ReviewStatus } from "@/domain/review-status";

/**
 * PDF解析で既存商品に一致しなかった明細を仮登録してよい信頼度の下限。
 * 従来「新規商品候補（NEW_CANDIDATE）」に分類していた条件と同じ値。
 * これ未満の明細は商品化せず、未照合（UNMATCHED）として要確認一覧に残す。
 *
 * system_confidence はモデル出力への加減点であり正答確率ではない。
 * この値を満たしても確認済みにはせず、必ず PROVISIONAL で作成する。
 */
export const PROVISIONAL_CREATE_MIN_CONFIDENCE = 0.9;

/** システム処理による確認履歴・出典紐付けの記録者。 */
export const SYSTEM_REVIEWER = "system:pdf-parse";

export function canCreateProvisionalProduct(systemConfidence: number | null): boolean {
  return systemConfidence !== null && systemConfidence >= PROVISIONAL_CREATE_MIN_CONFIDENCE;
}

/** 自動更新（規格・単価の上書き）の対象にしてよい状態か。 */
export function isAutoUpdatableStatus(status: ReviewStatus): boolean {
  return status === "LEGACY" || status === "VERIFIED";
}

/** 数量×単価と金額が一致するか（解析の信頼度計算と同じ許容差）。判定不能は null。 */
export function isAmountConsistent(
  quantity: number | null,
  unitPrice: number | null,
  amount: number | null,
): boolean | null {
  if (quantity === null || unitPrice === null || amount === null) return null;
  const tolerance = Math.max(1, Math.abs(amount) * 0.02);
  return Math.abs(quantity * unitPrice - amount) <= tolerance;
}

export type AttentionInput = {
  unitPrice: number | null;
  quantity: number | null;
  amount: number | null;
  vendorName: string | null;
  invoiceDate: string | null;
  spec: string | null;
};

/** 仮登録商品の出典に残す注意理由（表示用の文言）。 */
export function collectAttentionReasons(input: AttentionInput): string[] {
  const reasons: string[] = [];
  if (input.unitPrice === null) reasons.push("単価なし");
  if (!input.vendorName) reasons.push("仕入先不明");
  if (!input.invoiceDate) reasons.push("売上日不明");
  if (!input.spec) reasons.push("規格なし");
  if (isAmountConsistent(input.quantity, input.unitPrice, input.amount) === false) {
    reasons.push("数量×単価と金額が不一致");
  }
  return reasons;
}

export function formatAttentionReason(reasons: string[]): string | null {
  return reasons.length ? reasons.join("、") : null;
}

/** 両方にメーカーがあり、正規化しても異なる場合に true。片方が空なら矛盾とはみなさない。 */
export function makersConflict(a: string | null, b: string | null): boolean {
  const left = a ? normalizeText(a) : "";
  const right = b ? normalizeText(b) : "";
  return left !== "" && right !== "" && left !== right;
}

export type UnverifiedPriceAction = "NONE" | "ADD" | "CONFLICT";

/**
 * 未確認（仮登録・要確認）商品に対する抽出単価の扱い。
 * - 既存単価は上書きしない。値が異なれば CONFLICT として差分に残す。
 * - 同じ仕入先の単価が未設定で、仕入先と単価が取れていれば ADD。
 * - 単価が取れない場合は 0 円で補わず NONE。
 */
export function decideUnverifiedPriceAction(input: {
  existingUnitPrice: number | null;
  newUnitPrice: number | null;
  vendorName: string | null;
}): UnverifiedPriceAction {
  if (input.newUnitPrice === null || !input.vendorName) return "NONE";
  if (input.existingUnitPrice === null) return "ADD";
  return input.existingUnitPrice === input.newUnitPrice ? "NONE" : "CONFLICT";
}
