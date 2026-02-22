import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDocumentDetail, listDocumentLineItems } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

export async function GET(req: Request, context: { params: Promise<{ documentId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  const { searchParams } = new URL(req.url);
  const parsedQuery = z
    .object({
      parseRunId: z.string().uuid().optional(),
    })
    .safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsedQuery.success) {
    return problemResponse(400, "Bad Request", "Invalid query", parsedQuery.error.flatten());
  }

  try {
    const doc = await getDocumentDetail(parsedParams.data.documentId);
    if (!doc || doc.isDeleted) {
      return problemResponse(404, "Not Found", "Document not found");
    }
    const items = await listDocumentLineItems(
      parsedParams.data.documentId,
      parsedQuery.data.parseRunId,
    );
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[documents] line items failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch line items");
  }
}
