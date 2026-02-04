import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function sanitizeFilename(name: string): string {
  const base = name.replace(/[\/\\]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "");
  const trimmed = base.trim().slice(0, 180);
  return trimmed || "file.pdf";
}

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const safe = sanitizeFilename(pathname.replace(/^documents\//, ""));
        return {
          pathname: `documents/${safe}`,
          addRandomSuffix: true,
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: 50 * 1024 * 1024,
        };
      },
      // ローカルではcallback不要（DB登録はクライアント→/api/documentsで行う）
    });

    return NextResponse.json(jsonResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
