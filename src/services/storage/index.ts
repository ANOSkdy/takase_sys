import { getEnv, requireEnv } from "@/config/env";
import { VercelBlobStorage } from "@/services/storage/vercel-blob";

export type CreateUploadUrlInput = {
  fileName: string;
  contentType: string;
  size: number;
};

export type UploadUrlResult = {
  uploadUrl: string;
  storageKey: string;
  expiresAt: string;
};

export type StorageProvider = {
  createUploadUrl(input: CreateUploadUrlInput): Promise<UploadUrlResult>;
  getDownloadUrl?(storageKey: string): Promise<string>;
  getObjectBytes?(storageKey: string): Promise<Buffer>;
  putObjectBytes?(storageKey: string, bytes: Buffer, options: { contentType: string }): Promise<void>;
};

export async function getObjectBytes(storageKey: string): Promise<Buffer> {
  const storage = getStorageProvider();
  if (!storage.getObjectBytes) throw new Error("STORAGE_READ_NOT_SUPPORTED");
  return storage.getObjectBytes(storageKey);
}

export async function putObjectBytes(
  storageKey: string,
  bytes: Buffer,
  options: { contentType: string },
): Promise<void> {
  const storage = getStorageProvider();
  if (!storage.putObjectBytes) throw new Error("STORAGE_WRITE_NOT_SUPPORTED");
  await storage.putObjectBytes(storageKey, bytes, options);
}

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const env = getEnv();
  const provider = requireEnv(env.STORAGE_PROVIDER, "STORAGE_PROVIDER");

  if (provider === "vercel-blob") {
    cached = new VercelBlobStorage();
    return cached;
  }

  throw new Error(`Unsupported STORAGE_PROVIDER: ${provider}`);
}
