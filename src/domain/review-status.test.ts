import { describe, expect, it } from "vitest";
import {
  formatSourceLabel,
  getReviewStatusLabel,
  needsAttention,
  toReviewStatus,
} from "@/domain/review-status";

describe("review-status", () => {
  it("falls back to LEGACY for unknown values so nothing is shown as verified by accident", () => {
    expect(toReviewStatus("PROVISIONAL")).toBe("PROVISIONAL");
    expect(toReviewStatus("verified")).toBe("LEGACY");
    expect(toReviewStatus(null)).toBe("LEGACY");
  });

  it("flags only provisional and needs-review products for attention", () => {
    expect(needsAttention("PROVISIONAL")).toBe(true);
    expect(needsAttention("NEEDS_REVIEW")).toBe(true);
    expect(needsAttention("LEGACY")).toBe(false);
    expect(needsAttention("VERIFIED")).toBe(false);
    expect(needsAttention("MERGED")).toBe(false);
  });

  it("uses text labels in addition to colour", () => {
    expect(getReviewStatusLabel("PROVISIONAL")).toBe("⚠ 仮登録・未確認");
    expect(getReviewStatusLabel("LEGACY")).toBe("既存データ");
  });

  it("formats a source label with page and invoice date", () => {
    expect(
      formatSourceLabel({ fileName: "納品書1.pdf", pageNumber: 1, invoiceDate: "2026-11-04" }),
    ).toBe("納品書1.pdf・1ページ目／売上日2026-11-04");
    expect(formatSourceLabel({ fileName: "a.pdf", pageNumber: null, invoiceDate: null })).toBe(
      "a.pdf",
    );
  });
});
