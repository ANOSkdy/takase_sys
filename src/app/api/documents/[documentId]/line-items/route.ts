import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDocumentDetail, listDocumentLineItems } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

export async function GET(
  _req: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  try {
    const doc = await getDocumentDetail(parsedParams.data.documentId);
    if (!doc || doc.isDeleted) {
      return problemResponse(404, "Not Found", "Document not found");
    }
    const items = await listDocumentLineItems(parsedParams.data.documentId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[documents] line items failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch line items");
  }
}
