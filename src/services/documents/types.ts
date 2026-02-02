export type DocumentStatus = "UPLOADED" | "PARSING" | "PARSED" | "FAILED" | "DELETED";

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
