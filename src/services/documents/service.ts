import { getEnv } from "@/config/env";
import { getStorageProvider } from "@/services/storage";
import type {
  RegisterDocumentBulkInput,
  RegisterDocumentBulkResult,
  RegisterDocumentInput,
  RegisterDocumentResult,
} from "@/services/documents/types";
import {
  registerDocument as insertDocument,
  registerDocumentBulk as insertDocumentBulk,
} from "@/services/documents/repository";

export type RegisterDocumentOutcome =
  | { ok: true; data: RegisterDocumentResult }
  | { ok: false; status: number; title: string; detail: string };

export type RegisterDocumentBulkOutcome =
  | { ok: true; data: RegisterDocumentBulkResult }
  | { ok: false; status: number; title: string; detail: string };

export async function registerDocument(
  input: RegisterDocumentInput,
): Promise<RegisterDocumentOutcome> {
  const headerCheck = await validatePdfHeader(input.storageKey);
  if (headerCheck === "invalid") {
    return {
      ok: false,
      status: 415,
      title: "Unsupported Media Type",
      detail: "Uploaded file does not look like a PDF",
    };
  }

  const data = await insertDocument(input);
  return { ok: true, data };
}

export async function registerDocumentBulk(
  input: RegisterDocumentBulkInput,
): Promise<RegisterDocumentBulkOutcome> {
  const pageTotal = input.pages[0]?.pageTotal ?? 0;
  if (pageTotal < 1 || input.pages.length !== pageTotal) {
    return {
      ok: false,
      status: 400,
      title: "Bad Request",
      detail: "pages length and pageTotal must match",
    };
  }

  const pageNumbers = input.pages.map((page) => page.pageNumber).sort((a, b) => a - b);
  for (const [index, pageNumber] of pageNumbers.entries()) {
    if (pageNumber !== index + 1) {
      return {
        ok: false,
        status: 400,
        title: "Bad Request",
        detail: "pageNumber must be unique and contiguous from 1 to pageTotal",
      };
    }
  }

  for (const page of input.pages) {
    if (page.pageTotal !== pageTotal) {
      return {
        ok: false,
        status: 400,
        title: "Bad Request",
        detail: "all pages must have the same pageTotal",
      };
    }
    const headerCheck = await validatePdfHeader(page.storageKey);
    if (headerCheck === "invalid") {
      return {
        ok: false,
        status: 415,
        title: "Unsupported Media Type",
        detail: `Page ${page.pageNumber} is not a valid PDF`,
      };
    }
  }

  const data = await insertDocumentBulk(input);
  return { ok: true, data };
}

type HeaderCheckResult = "valid" | "invalid" | "skipped";

async function validatePdfHeader(storageKey: string): Promise<HeaderCheckResult> {
  const storage = getStorageProvider();
  if (!storage.getDownloadUrl) return "skipped";

  try {
    const url = await storage.getDownloadUrl(storageKey);
    const env = getEnv();
    const headers: Record<string, string> = { Range: "bytes=0-4" };
    if (env.BLOB_READ_WRITE_TOKEN) {
      headers.authorization = `Bearer ${env.BLOB_READ_WRITE_TOKEN}`;
    }
    const response = await fetch(url, { headers });

    if (!response.ok) return "skipped";

    const buffer = await response.arrayBuffer();
    const header = new TextDecoder().decode(buffer);
    if (!header.startsWith("%PDF-")) return "invalid";
    return "valid";
  } catch (error) {
    console.warn("[documents] pdf header validation skipped", error);
    return "skipped";
  }
}
