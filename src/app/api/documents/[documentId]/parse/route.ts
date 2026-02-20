import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { start } from "workflow/api";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDb } from "@/db/client";
import { documentParseRuns, documents } from "@/db/schema";
import { getEnv } from "@/config/env";
import { PROMPT_VERSION } from "@/services/ai/prompt";
import { getDocumentDetail } from "@/services/documents/repository";
import { runDocumentParseWorkflow } from "@/workflows/document-parse";

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

    const parseRunId = crypto.randomUUID();
    const env = getEnv();
    const model = env.GEMINI_MODEL && env.GEMINI_MODEL.trim() ? env.GEMINI_MODEL : "gemini-1.5-flash";

    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.insert(documentParseRuns).values({
        parseRunId,
        documentId,
        startedAt: new Date(),
        status: "RUNNING",
        model,
        promptVersion: PROMPT_VERSION,
        stats: {},
      });

      await tx
        .update(documents)
        .set({ status: "PARSING", parseErrorSummary: null })
        .where(eq(documents.documentId, documentId));
    });

    await start(runDocumentParseWorkflow, [parseRunId]);

    return NextResponse.json({ parseRunId, status: "RUNNING" }, { status: 202 });
  } catch (err) {
    console.error("[documents] parse failed", err);

    const msg = err instanceof Error ? err.message : String(err);
    const detail = process.env.NODE_ENV === "development" ? msg : "Failed to start parse workflow";

    return problemResponse(500, "Internal Server Error", detail);
  }
}
