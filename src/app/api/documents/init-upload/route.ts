import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { problemResponse } from "@/app/api/_utils/problem";
import { getMaxPdfSizeBytes } from "@/services/documents/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as unknown;
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === "object" && value !== null && !Array.isArray(value);
    const isHandleUploadBody = (value: unknown): value is HandleUploadBody =>
      isRecord(value) && typeof value.pathname === "string";

    if (!isRecord(body)) {
      return problemResponse(400, "Bad Request", "Invalid upload payload");
    }

    if ("fileName" in body || "contentType" in body || "size" in body) {
      return problemResponse(
        400,
        "Bad Request",
        "Legacy init-upload payload detected. Update client to use @vercel/blob/client upload() with handleUploadUrl.",
      );
    }

    if (!isHandleUploadBody(body)) {
      return problemResponse(400, "Bad Request", "Invalid upload payload");
    }
    const pathnameValue = body.pathname;
    const invalidPath =
      pathnameValue.startsWith("/") ||
      pathnameValue.includes("%") ||
      pathnameValue.includes("..") ||
      !pathnameValue.startsWith("documents/") ||
      !pathnameValue.endsWith(".pdf");
    if (invalidPath) {
      return problemResponse(400, "Bad Request", "Invalid upload pathname");
    }

    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const maxBytes = getMaxPdfSizeBytes();
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: maxBytes,
          tokenPayload: { pathname },
        };
      },
      onUploadCompleted: async ({ blob, contentType, size }) => {
        console.info("[documents] upload completed", {
          pathname: blob.pathname,
          contentType,
          size,
        });
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    const errorId = crypto.randomUUID();
    const message = error instanceof Error ? error.message : "Unknown error";
    const causeMessage =
      error && typeof error === "object" && "cause" in error && error.cause instanceof Error
        ? error.cause.message
        : undefined;
    console.error("[documents] init-upload failed", {
      errorId,
      name: error instanceof Error ? error.name : "UnknownError",
      message,
      cause: causeMessage,
    });
    return problemResponse(
      500,
      "Internal Server Error",
      `Failed to initialize upload (errorId=${errorId})`,
    );
  }
}
