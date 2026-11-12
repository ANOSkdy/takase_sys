import type { ReviewStatus } from "@/domain/review-status";

/** 商品の出典（PDF解析の抽出明細）。PDFの実体URLは含めない。 */
export type ProductSource = {
  lineItemId: string;
  lineNo: number | null;
  linkedAt: string | null;
  linkMethod: string;
  attentionReason: string | null;
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  invoiceDate: string | null;
  documentDeleted: boolean;
  deletedReason: string | null;
};

export type ProductSourceSummary = {
  sourceCount: number;
  representative: ProductSource;
};

export type ProductListItem = {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
  category: string | null;
  defaultUnitPrice: string | null;
  qualityFlag: string;
  reviewStatus: ReviewStatus;
  lastUpdatedAt: string;
  sourceSummary: ProductSourceSummary | null;
};

export type ProductVendorPrice = {
  vendorPriceId: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
  updatedAt: string;
};

export type ProductDetail = Omit<ProductListItem, "sourceSummary"> & {
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** MERGED の場合の統合先。 */
  mergedInto: { productId: string; productName: string } | null;
  sources: ProductSource[];
  vendorPrices: ProductVendorPrice[];
  updateHistory: ProductUpdateHistory[];
};

export type ProductUpdateHistory = {
  historyId: string;
  fieldName: string;
  vendorName: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  sourceType: string;
  sourceId: string;
  updatedAt: string;
  updatedBy: string | null;
};
