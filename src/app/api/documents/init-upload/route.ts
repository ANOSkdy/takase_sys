import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { problemResponse } from "@/app/api/_utils/problem";
import { getMaxPdfSizeBytes } from "@/services/documents/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    let body: HandleUploadBody;
    try {
      body = (await req.json()) as HandleUploadBody;
    } catch {
      return problemResponse(400, "Bad Request", "Invalid JSON body");
    }
    const pathname = typeof body.pathname === "string" ? body.pathname : "";
    const contentType = typeof body.contentType === "string" ? body.contentType : "";
    const size = typeof body.size === "number" ? body.size : NaN;
    const maxBytes = getMaxPdfSizeBytes();

    if (!pathname || !isValidPathname(pathname)) {
      return problemResponse(400, "Bad Request", "Invalid pathname");
    }
    if (!contentType) {
      return problemResponse(400, "Bad Request", "Missing contentType");
    }
    if (!Number.isFinite(size) || size <= 0) {
      return problemResponse(400, "Bad Request", "Missing size");
    }
    if (contentType !== "application/pdf") {
      return problemResponse(415, "Unsupported Media Type", "Only application/pdf is accepted");
    }
    if (size > maxBytes) {
      return problemResponse(
        413,
        "Payload Too Large",
        `PDF size exceeds limit (${maxBytes} bytes)`,
      );
    }

    const response = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (blobPathname, clientPayload) => {
        if (!isValidPathname(blobPathname)) {
          throw new Error("Invalid pathname");
        }
        const safePayload = {
          pathname: blobPathname,
          clientPayload: typeof clientPayload === "string" ? clientPayload : undefined,
        };
        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: maxBytes,
          tokenPayload: JSON.stringify(safePayload),
        };
      },
      onUploadCompleted: async ({ blob }) => {
        console.info("[documents] upload completed", {
          pathname: blob.pathname,
          contentType: blob.contentType,
          size: blob.size,
        });
      },
    });
    return response;
  } catch (error) {
    const errorId = crypto.randomUUID();
    const err = error instanceof Error ? error : new Error("Unknown error");
    const causeMessage = err.cause instanceof Error ? err.cause.message : undefined;
    console.error("[documents] init-upload failed", {
      errorId,
      name: err.name,
      message: err.message,
      cause: causeMessage,
    });
    return problemResponse(
      500,
      "Internal Server Error",
      `Failed to initialize upload (errorId=${errorId})`,
    );
  }
}

function isValidPathname(pathname: string): boolean {
  if (!pathname.startsWith("documents/")) return false;
  if (!pathname.endsWith(".pdf")) return false;
  if (pathname.includes("..")) return false;
  return /^[a-zA-Z0-9/_\-.]+$/.test(pathname);
}
