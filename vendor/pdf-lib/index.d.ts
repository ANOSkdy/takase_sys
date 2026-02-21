export interface PDFPage {}

export interface PDFDocumentType {
  getPageCount(): number;
  copyPages(source: PDFDocumentType, indices: number[]): Promise<PDFPage[]>;
  addPage(page: PDFPage): void;
  save(): Promise<Uint8Array>;
}

export declare const PDFDocument: {
  load(input: Uint8Array | ArrayBuffer | Buffer): Promise<PDFDocumentType>;
  create(): Promise<PDFDocumentType>;
};
