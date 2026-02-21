import "server-only";
import { getObjectBytes } from "@/services/storage";

function isHttpUrl(storageKey: string): boolean {
  return storageKey.startsWith("https://") || storageKey.startsWith("http://");
}

function assertPdfBuffer(pdfBytes: Buffer): void {
  if (pdfBytes.byteLength < 5) {
    throw new Error("PDF_FETCH_EMPTY");
  }

  const header = pdfBytes.subarray(0, 4).toString("ascii");
  if (header !== "%PDF") {
    throw new Error("PDF_FETCH_NOT_PDF");
  }
}

function getPdfDiagnostics(pdfBytes: Buffer): {
  byteLength: number;
  first4: string;
  hasPdfHeader: boolean;
  hasEofMarker: boolean;
} {
  const first4 = pdfBytes.subarray(0, 4).toString("ascii");
  const tail = pdfBytes.subarray(Math.max(0, pdfBytes.byteLength - 2048)).toString("ascii");
  return {
    byteLength: pdfBytes.byteLength,
    first4,
    hasPdfHeader: first4 === "%PDF",
    hasEofMarker: tail.includes("%%EOF"),
  };
}

export async function getPdfBytesFromStorageKey(storageKey: string): Promise<Buffer> {
  let pdfBytes: Buffer;

  if (isHttpUrl(storageKey)) {
    const response = await fetch(storageKey, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`PDF_FETCH_HTTP_${response.status}`);
    }
    pdfBytes = Buffer.from(await response.arrayBuffer());
  } else {
    pdfBytes = await getObjectBytes(storageKey);
  }

  const diagnostics = getPdfDiagnostics(pdfBytes);
  console.info("PDF_BYTES_DIAGNOSTICS", diagnostics);

  assertPdfBuffer(pdfBytes);
  return pdfBytes;
}
