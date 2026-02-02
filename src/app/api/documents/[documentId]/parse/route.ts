import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
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
    const outcome = await parseDocument(parsedParams.data.documentId);
    if (!outcome.ok) {
      return problemResponse(outcome.status, outcome.title, outcome.detail);
    }
    return NextResponse.json({ parseRunId: outcome.parseRunId, status: "RUNNING" });
  } catch (error) {
    console.error("[documents] parse failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to parse document");
  }
}
