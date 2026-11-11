import type { CSSProperties } from "react";
import {
  formatSourceLabel,
  getReviewStatusLabel,
  needsAttention,
  type ReviewStatus,
} from "@/domain/review-status";
import type { ProductSource } from "@/services/products/types";

const badgeBase: CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 4,
  fontSize: 12,
  lineHeight: 1.5,
  whiteSpace: "nowrap",
  border: "1px solid var(--color-border)",
  color: "var(--color-text-sub)",
  background: "transparent",
};

const badgeAttention: CSSProperties = {
  ...badgeBase,
  fontWeight: 700,
  color: "var(--color-danger)",
  background: "var(--color-danger-soft)",
  borderColor: "var(--color-danger)",
};

const badgeVerified: CSSProperties = {
  ...badgeBase,
  color: "var(--color-success)",
  background: "var(--color-success-soft)",
  borderColor: "var(--color-success)",
};

/** 確認状態のラベル。色だけに頼らず必ず文字で状態を示す。 */
export function ReviewStatusBadge({
  status,
  reason,
}: {
  status: ReviewStatus;
  /** 要確認の理由など。あればラベルの後ろに併記する。 */
  reason?: string | null;
}) {
  const style = needsAttention(status)
    ? badgeAttention
    : status === "VERIFIED"
      ? badgeVerified
      : badgeBase;
  return (
    <span style={style}>
      {getReviewStatusLabel(status)}
      {reason ? `（${reason}）` : ""}
    </span>
  );
}

/** 注意が必要な状態の商品名を赤字にするためのスタイル。 */
export function attentionTextStyle(status: ReviewStatus): CSSProperties | undefined {
  return needsAttention(status) ? { color: "var(--color-danger)", fontWeight: 700 } : undefined;
}

/**
 * 出典PDF（該当ページ）へのリンク。
 * PDFはアプリの配信API経由で開き、ストレージのURLは扱わない。
 */
export function SourceLink({
  source,
  sourceCount,
}: {
  source: ProductSource;
  /** 指定時、2件以上なら「ほかn件」を併記する。 */
  sourceCount?: number;
}) {
  const label = formatSourceLabel(source);
  const others = sourceCount && sourceCount > 1 ? ` ほか${sourceCount - 1}件` : "";

  if (source.documentDeleted) {
    return (
      <span style={{ color: "var(--color-text-sub)", fontSize: 12 }}>
        {label}（PDF削除済み{source.deletedReason ? `: ${source.deletedReason}` : ""}）{others}
      </span>
    );
  }

  return (
    <span style={{ fontSize: 12 }}>
      <a
        href={`/api/documents/${source.documentId}/file`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "var(--color-primary)", textDecoration: "underline" }}
      >
        {label}
      </a>
      {others}
    </span>
  );
}
