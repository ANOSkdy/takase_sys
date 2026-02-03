import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import { getEnv } from "@/config/env";
import { initUploadSchema, validateInitUpload } from "@/services/documents/upload";
import { getStorageProvider } from "@/services/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let contentType: string | undefined;
  let size: number | undefined;
  let provider: string | undefined;
  try {
    const body = await req.json();
    const parsed = initUploadSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse(400, "Bad Request", "Invalid payload", parsed.error.flatten());
    }

    const validation = validateInitUpload(parsed.data);
    if (!validation.ok) {
      return problemResponse(validation.status, validation.title, validation.detail);
    }

    contentType = parsed.data.contentType;
    size = parsed.data.size;

    const env = getEnv();
    provider = env.STORAGE_PROVIDER;
    if (provider !== "vercel-blob") {
      const errorId = crypto.randomUUID();
      console.error("[documents] init-upload unknown storage provider", {
        errorId,
        provider,
      });
      return problemResponse(
        500,
        "Internal Server Error",
        `Unknown storage provider (errorId=${errorId})`,
      );
    }

    const storageKey = buildStorageKey();
    const storage = getStorageProvider();
    const result = await storage.createUploadUrl({
      storageKey,
      contentType,
      size,
    });
    return NextResponse.json(result);
  } catch (error) {
    const errorId = crypto.randomUUID();
    const err = error instanceof Error ? error : new Error("Unknown error");
    const causeMessage = err.cause instanceof Error ? err.cause.message : undefined;
    console.error("[documents] init-upload failed", {
      errorId,
      name: err.name,
      message: err.message,
      cause: causeMessage,
      provider,
      size,
      contentType,
    });
    return problemResponse(
      500,
      "Internal Server Error",
      `Failed to initialize upload (errorId=${errorId})`,
    );
  }
}

function buildStorageKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const id = crypto.randomUUID();
  return `documents/${yyyy}/${mm}/${id}.pdf`;
}
