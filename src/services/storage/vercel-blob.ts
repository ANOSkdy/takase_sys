import { requireEnv, getEnv } from "@/config/env";
import type { CreateUploadUrlInput, StorageProvider, UploadUrlResult } from "./index";

const DEFAULT_UPLOAD_EXPIRES_MS = 15 * 60 * 1000;
const VERCEL_BLOB_API_BASE = "https://blob.vercel-storage.com";

function normalizeFileName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "document.pdf";
}

function buildPathname(fileName: string): string {
  const safeName = normalizeFileName(fileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `documents/${stamp}-${safeName}`;
}

type BlobUploadUrlResponse = {
  url?: string;
  uploadUrl?: string;
  pathname?: string;
  expiresAt?: string;
  expiresIn?: number;
  blob?: { url?: string; pathname?: string };
};

export class VercelBlobStorage implements StorageProvider {
  async createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResult> {
    const env = getEnv();
    const token = requireEnv(env.BLOB_READ_WRITE_TOKEN, "BLOB_READ_WRITE_TOKEN");

    const payload = {
      pathname: buildPathname(input.fileName),
      contentType: input.contentType,
      contentLength: input.size,
      access: "private",
    };

    const response = await fetch(VERCEL_BLOB_API_BASE, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to create upload URL: ${response.status} ${text}`);
    }

    const data = (await response.json()) as BlobUploadUrlResponse;
    const uploadUrl = data.uploadUrl ?? data.url ?? data.blob?.url;
    if (!uploadUrl) {
      throw new Error("Upload URL response missing url");
    }

    const storageKey = data.pathname ?? data.blob?.pathname ?? uploadUrl;
    const expiresAt = data.expiresAt
      ? new Date(data.expiresAt).toISOString()
      : new Date(Date.now() + (data.expiresIn ?? DEFAULT_UPLOAD_EXPIRES_MS)).toISOString();

    return { uploadUrl, storageKey, expiresAt };
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    if (storageKey.startsWith("http")) return storageKey;
    return `${VERCEL_BLOB_API_BASE}/${storageKey}`;
  }
}
