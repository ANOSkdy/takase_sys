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
  private getAuthHeader(): string {
    const env = getEnv();
    return `Bearer ${requireEnv(env.BLOB_READ_WRITE_TOKEN, "BLOB_READ_WRITE_TOKEN")}`;
  }

  private async createRawUploadUrl(pathname: string, contentType: string, contentLength: number): Promise<string> {
    const response = await fetch(VERCEL_BLOB_API_BASE, {
      method: "POST",
      headers: {
        authorization: this.getAuthHeader(),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pathname,
        contentType,
        contentLength,
        access: "private",
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to create upload URL: ${response.status} ${text}`);
    }

    const data = (await response.json()) as BlobUploadUrlResponse;
    const uploadUrl = data.uploadUrl ?? data.url ?? data.blob?.url;
    if (!uploadUrl) throw new Error("Upload URL response missing url");
    return uploadUrl;
  }

  async createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResult> {
    const pathname = buildPathname(input.fileName);
    const uploadUrl = await this.createRawUploadUrl(pathname, input.contentType, input.size);

    const storageKey = pathname;
    const expiresAt = new Date(Date.now() + DEFAULT_UPLOAD_EXPIRES_MS).toISOString();

    return { uploadUrl, storageKey, expiresAt };
  }

  async getDownloadUrl(storageKey: string): Promise<string> {
    if (storageKey.startsWith("http")) return storageKey;
    return `${VERCEL_BLOB_API_BASE}/${storageKey}`;
  }

  async getObjectBytes(storageKey: string): Promise<Buffer> {
    const url = await this.getDownloadUrl(storageKey);
    const response = await fetch(url, {
      headers: { authorization: this.getAuthHeader() },
    });
    if (!response.ok) {
      throw new Error(`Failed to download object: ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  async putObjectBytes(storageKey: string, bytes: Buffer, options: { contentType: string }): Promise<void> {
    const uploadUrl = await this.createRawUploadUrl(storageKey, options.contentType, bytes.byteLength);
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "content-type": options.contentType },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Failed to upload object: ${response.status} ${text}`);
    }
  }
}
