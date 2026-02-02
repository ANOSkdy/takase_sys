import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { diffSummary, listDiffItems } from "@/services/documents/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

const querySchema = z.object({
  parseRunId: z.string().uuid(),
  class: z.string().optional(),
});

export async function GET(
  req: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId", parsedParams.error.flatten());
  }

  const url = new URL(req.url);
  const parsedQuery = querySchema.safeParse({
    parseRunId: url.searchParams.get("parseRunId"),
    class: url.searchParams.get("class") ?? undefined,
  });
  if (!parsedQuery.success) {
    return problemResponse(400, "Bad Request", "Invalid query", parsedQuery.error.flatten());
  }

  try {
    const [summary, items] = await Promise.all([
      diffSummary(parsedParams.data.documentId, parsedQuery.data.parseRunId),
      listDiffItems(
        parsedParams.data.documentId,
        parsedQuery.data.parseRunId,
        parsedQuery.data.class,
      ),
    ]);
    return NextResponse.json({ summary, items });
  } catch (error) {
    console.error("[documents] diff fetch failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch diff");
  }
}
