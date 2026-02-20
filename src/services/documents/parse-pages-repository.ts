import "server-only";
import { z } from "zod";
import { getSql } from "@/db/client";
import { assertNoDateSqlParams } from "@/db/sql-params";
import type { ParsedInvoice } from "@/services/ai/schema";

const pageKeySchema = z.object({
  parseRunId: z.string().uuid(),
  pageNo: z.number().int().positive(),
});

const pagePatchSchema = z.object({
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"]),
  parsedJson: z.custom<ParsedInvoice>().optional(),
  errorSummary: z.string().max(500).nullable().optional(),
  stepId: z.string().max(255).nullable().optional(),
  attempt: z.number().int().positive().nullable().optional(),
  markStartedAt: z.boolean().optional(),
  markFinishedAt: z.boolean().optional(),
});

export type ParsePageRow = {
  parseRunId: string;
  pageNo: number;
  status: string;
  parsedJson: ParsedInvoice | null;
  errorSummary: string | null;
};

export async function upsertDocumentParsePage(input: {
  parseRunId: string;
  pageNo: number;
  patch: z.input<typeof pagePatchSchema>;
}): Promise<void> {
  const key = pageKeySchema.parse({ parseRunId: input.parseRunId, pageNo: input.pageNo });
  const patch = pagePatchSchema.parse(input.patch);
  const sql = getSql();

  const params = [
    key.parseRunId,
    key.pageNo,
    patch.status,
    patch.parsedJson ? JSON.stringify(patch.parsedJson) : null,
    patch.errorSummary ?? null,
    patch.stepId ?? null,
    patch.attempt ?? null,
    patch.markStartedAt ?? false,
    patch.markFinishedAt ?? false,
  ];

  assertNoDateSqlParams(params, "upsertDocumentParsePage");

  await sql.unsafe(
    `
      INSERT INTO document_parse_pages (
        parse_run_id, page_no, status, parsed_json, error_summary, step_id, attempt, started_at, finished_at
      ) VALUES (
        $1,$2,$3,$4::jsonb,$5,$6,$7,
        CASE WHEN $8::boolean THEN now() ELSE NULL END,
        CASE WHEN $9::boolean THEN now() ELSE NULL END
      )
      ON CONFLICT (parse_run_id, page_no)
      DO UPDATE SET
        status = EXCLUDED.status,
        parsed_json = COALESCE(EXCLUDED.parsed_json, document_parse_pages.parsed_json),
        error_summary = EXCLUDED.error_summary,
        step_id = EXCLUDED.step_id,
        attempt = EXCLUDED.attempt,
        started_at = COALESCE(EXCLUDED.started_at, document_parse_pages.started_at),
        finished_at = COALESCE(EXCLUDED.finished_at, document_parse_pages.finished_at),
        updated_at = now()
    `,
    params,
  );
}

export async function getDocumentParsePageStatus(input: {
  parseRunId: string;
  pageNo: number;
}): Promise<string | null> {
  const key = pageKeySchema.parse(input);
  const sql = getSql();
  const rows = await sql.unsafe<{ status: string }[]>(
    `SELECT status FROM document_parse_pages WHERE parse_run_id = $1 AND page_no = $2 LIMIT 1`,
    [key.parseRunId, key.pageNo],
  );
  return rows[0]?.status ?? null;
}

export async function listSucceededParsePages(parseRunId: string): Promise<ParsePageRow[]> {
  const runId = z.string().uuid().parse(parseRunId);
  const sql = getSql();
  const rows = await sql.unsafe<
    { parse_run_id: string; page_no: number; status: string; parsed_json: ParsedInvoice | null; error_summary: string | null }[]
  >(
    `
      SELECT parse_run_id, page_no, status, parsed_json, error_summary
      FROM document_parse_pages
      WHERE parse_run_id = $1 AND status = 'SUCCEEDED'
      ORDER BY page_no ASC
    `,
    [runId],
  );

  return rows.map((row) => ({
    parseRunId: row.parse_run_id,
    pageNo: row.page_no,
    status: row.status,
    parsedJson: row.parsed_json,
    errorSummary: row.error_summary,
  }));
}

export async function listFailedPageNos(parseRunId: string): Promise<number[]> {
  const runId = z.string().uuid().parse(parseRunId);
  const sql = getSql();
  const rows = await sql.unsafe<{ page_no: number }[]>(
    `
      SELECT page_no
      FROM document_parse_pages
      WHERE parse_run_id = $1 AND status = 'FAILED'
      ORDER BY page_no ASC
    `,
    [runId],
  );
  return rows.map((row) => row.page_no);
}
