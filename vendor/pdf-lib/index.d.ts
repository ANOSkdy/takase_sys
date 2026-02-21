export class PDFDocument {
  static load(_bytes: Uint8Array): Promise<PDFDocument>;
  static create(): Promise<PDFDocument>;
  getPageCount(): number;
  copyPages(_source: PDFDocument, _indices: number[]): Promise<unknown[]>;
  addPage(_page: unknown): void;
  save(): Promise<Uint8Array>;
}
