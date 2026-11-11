// 商品の確認状態（product_master.review_status）。
// quality_flag は既存の品質情報であり、確認状態とは別に扱う。
export const REVIEW_STATUSES = [
  "LEGACY",
  "PROVISIONAL",
  "NEEDS_REVIEW",
  "VERIFIED",
  "MERGED",
] as const;

export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

// 色だけに頼らず、必ず文字ラベルを併記する。
const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  LEGACY: "既存データ",
  PROVISIONAL: "⚠ 仮登録・未確認",
  NEEDS_REVIEW: "⚠ 要確認",
  VERIFIED: "確認済み",
  MERGED: "統合済み",
};

// 未知の値は「人が確認済み」と誤解されない LEGACY として扱う。
export function toReviewStatus(value: unknown): ReviewStatus {
  return REVIEW_STATUSES.includes(value as ReviewStatus) ? (value as ReviewStatus) : "LEGACY";
}

export function getReviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUS_LABELS[status];
}

/** 赤字の注意表示が必要な状態か。 */
export function needsAttention(status: ReviewStatus): boolean {
  return status === "PROVISIONAL" || status === "NEEDS_REVIEW";
}

export type SourceLabelInput = {
  fileName: string;
  pageNumber: number | null;
  invoiceDate: string | null;
};

/** 例: 「納品書1.pdf・1ページ目／売上日2026-11-04」 */
export function formatSourceLabel(source: SourceLabelInput): string {
  let label = source.fileName;
  if (source.pageNumber != null) label += `・${source.pageNumber}ページ目`;
  if (source.invoiceDate) label += `／売上日${source.invoiceDate}`;
  return label;
}
