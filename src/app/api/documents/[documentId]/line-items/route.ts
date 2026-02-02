import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { listLineItems } from "@/services/documents/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

const querySchema = z.object({
  parseRunId: z.string().uuid(),
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
  });
  if (!parsedQuery.success) {
    return problemResponse(400, "Bad Request", "Invalid parseRunId", parsedQuery.error.flatten());
  }

  try {
    const items = await listLineItems(parsedParams.data.documentId, parsedQuery.data.parseRunId);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[documents] line items fetch failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch line items");
  }
}
