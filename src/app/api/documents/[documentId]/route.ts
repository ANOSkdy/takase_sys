import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDocumentDetail, softDeleteDocument } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deleteSchema = z.object({
  deletedReason: z.string().trim().max(1000).optional(),
});

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

export async function GET(_req: Request, context: { params: Promise<{ documentId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  try {
    const doc = await getDocumentDetail(parsedParams.data.documentId);
    if (!doc) {
      return problemResponse(404, "Not Found", "Document not found");
    }
    return NextResponse.json(doc);
  } catch (error) {
    console.error("[documents] detail failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch document");
  }
}

export async function DELETE(req: Request, context: { params: Promise<{ documentId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsedBody = deleteSchema.safeParse(body);
    if (!parsedBody.success) {
      return problemResponse(400, "Bad Request", "Invalid payload", parsedBody.error.flatten());
    }

    const result = await softDeleteDocument(
      parsedParams.data.documentId,
      parsedBody.data.deletedReason,
    );

    if (!result) {
      return problemResponse(404, "Not Found", "Document not found");
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("[documents] delete failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to delete document");
  }
}
