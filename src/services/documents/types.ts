export type DocumentStatus = "UPLOADED" | "PARSING" | "PARSED" | "FAILED" | "DELETED";

export type DocumentListItem = {
  documentId: string;
  fileName: string;
  uploadGroupId: string | null;
  pageNumber: number | null;
  pageTotal: number | null;
  sourceFileHash: string | null;
  uploadedAt: string;
  status: DocumentStatus;
  vendorName: string | null;
  invoiceDate: string | null;
  uploadNote: string | null;
};

export type DocumentDetail = DocumentListItem & {
  fileHash: string;
  storageKey: string;
  parseErrorSummary: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
  deletedReason: string | null;
  latestParseRun?: {
    parseRunId: string;
    status: string;
    startedAt: string;
    finishedAt: string | null;
    errorDetail: string | null;
  } | null;
};

export type RegisterDocumentInput = {
  fileName: string;
  storageKey: string;
  fileHash: string;
  uploadNote?: string | null;
};

export type RegisterDocumentPageInput = {
  storageKey: string;
  fileHash: string;
  pageNumber: number;
  pageTotal: number;
};

export type RegisterDocumentBulkInput = {
  fileName: string;
  uploadNote?: string | null;
  sourceFileHash?: string | null;
  pages: RegisterDocumentPageInput[];
};

export type RegisterDocumentBulkResult = {
  uploadGroupId: string;
  items: Array<{ documentId: string; pageNumber: number; status: DocumentStatus }>;
};

export type RegisterDocumentResult = {
  documentId: string;
  status: DocumentStatus;
};

export type SoftDeleteResult = {
  documentId: string;
  status: DocumentStatus;
};

export type DocumentLineItem = {
  lineItemId: string;
  lineNo: number;
  productNameRaw: string | null;
  specRaw: string | null;
  productKeyCandidate: string | null;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  modelConfidence: string | null;
  systemConfidence: string | null;
  matchedProductId: string | null;
};

export type DocumentDiffItem = {
  diffItemId: string;
  lineItemId: string;
  classification: string;
  reason: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};
