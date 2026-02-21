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

  assertPdfBuffer(pdfBytes);
  return pdfBytes;
}
