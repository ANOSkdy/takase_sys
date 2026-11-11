import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewStatusBadge, SourceLink } from "@/components/product/ReviewStatus";
import type { ProductSource } from "@/services/products/types";

const source: ProductSource = {
  lineItemId: "22222222-2222-4222-8222-222222222222",
  lineNo: 3,
  linkedAt: "2026-11-11T00:00:00.000Z",
  linkMethod: "PROVISIONAL_CREATE",
  attentionReason: null,
  documentId: "11111111-1111-4111-8111-111111111111",
  fileName: "納品書1.pdf",
  pageNumber: 1,
  invoiceDate: "2026-11-04",
  documentDeleted: false,
  deletedReason: null,
};

describe("ReviewStatusBadge", () => {
  it("shows a text label for provisional products", () => {
    render(<ReviewStatusBadge status="PROVISIONAL" />);
    expect(screen.getByText("⚠ 仮登録・未確認")).toBeInTheDocument();
  });

  it("shows the reason next to the needs-review label", () => {
    render(<ReviewStatusBadge status="NEEDS_REVIEW" reason="単価不整合" />);
    expect(screen.getByText("⚠ 要確認（単価不整合）")).toBeInTheDocument();
  });
});

describe("SourceLink", () => {
  it("links to the app's PDF route for the source page, not to storage", () => {
    render(<SourceLink source={source} sourceCount={3} />);
    const link = screen.getByRole("link", { name: "納品書1.pdf・1ページ目／売上日2026-11-04" });
    expect(link).toHaveAttribute("href", `/api/documents/${source.documentId}/file`);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/ほか2件/)).toBeInTheDocument();
  });

  it("shows the reason instead of a link when the PDF was deleted", () => {
    render(<SourceLink source={{ ...source, documentDeleted: true, deletedReason: "誤登録" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/PDF削除済み: 誤登録/)).toBeInTheDocument();
  });
});
