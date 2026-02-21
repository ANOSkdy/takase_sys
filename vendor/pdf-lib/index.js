class PDFDocumentStub {
  static async load() {
    throw new Error("PDF_LIB_RUNTIME_UNAVAILABLE");
  }

  static async create() {
    throw new Error("PDF_LIB_RUNTIME_UNAVAILABLE");
  }
}

module.exports = { PDFDocument: PDFDocumentStub };
