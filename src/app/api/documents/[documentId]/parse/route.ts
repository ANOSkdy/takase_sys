import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDocumentDetail } from "@/services/documents/repository";
import { parseDocument } from "@/services/documents/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

export async function POST(
  _req: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  try {
    const { documentId } = parsedParams.data;

    const doc = await getDocumentDetail(documentId);
    if (!doc || doc.isDeleted) {
      return problemResponse(404, "Not Found", "Document not found");
    }

    const result = await parseDocument(documentId);

    // 非同期処理開始の扱い（既存実装が202想定なら維持）
    return NextResponse.json(result, { status: 202 });
  } catch (err) {
    console.error("[documents] parse failed", err);

    const msg = err instanceof Error ? err.message : String(err);
    const detail = process.env.NODE_ENV === "development" ? msg : "Failed to parse document";

    return problemResponse(500, "Internal Server Error", detail);
  }
}
