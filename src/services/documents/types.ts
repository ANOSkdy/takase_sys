export type DocumentStatus = "UPLOADED" | "PARSING" | "PARSED" | "PARSED_PARTIAL" | "FAILED" | "DELETED";

export type DocumentListItem = {
  documentId: string;
  fileName: string;
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
