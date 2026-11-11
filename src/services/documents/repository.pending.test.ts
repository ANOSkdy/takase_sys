// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/test/pglite";

let t: TestDb;

vi.mock("server-only", () => ({}));
vi.mock("@/db/client", () => ({
  getDb: () => t.db,
}));

import {
  getPendingDiffReviewSummary,
  listPendingDiffReviewItems,
} from "@/services/documents/repository";

async function addDocument(): Promise<string> {
  const [row] = await t.rows<{ document_id: string }>(
    `INSERT INTO documents (file_name, file_hash, storage_key)
     VALUES ('納品書1.pdf', 'hash', 'documents/x.pdf') RETURNING document_id`,
  );
  return row.document_id;
}

async function addRunWithDiff(input: {
  documentId: string;
  startedAt: string;
  status: "SUCCEEDED" | "FAILED";
  classification?: string;
}) {
  const [run] = await t.rows<{ parse_run_id: string }>(
    `INSERT INTO document_parse_runs (document_id, started_at, status, model, prompt_version)
     VALUES ($1, $2, $3, 'test', 'test') RETURNING parse_run_id`,
    [input.documentId, input.startedAt, input.status],
  );
  if (!input.classification) return;
  const [item] = await t.rows<{ line_item_id: string }>(
    `INSERT INTO document_line_items (parse_run_id, line_no, product_name_raw)
     VALUES ($1, 1, '品名') RETURNING line_item_id`,
    [run.parse_run_id],
  );
  await t.rows(
    `INSERT INTO document_diff_items (parse_run_id, line_item_id, classification)
     VALUES ($1, $2, $3)`,
    [run.parse_run_id, item.line_item_id, input.classification],
  );
}

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

describe("pending diff review", () => {
  it("ignores candidates from an older parse once a newer parse has handled the line", async () => {
    const documentId = await addDocument();
    await addRunWithDiff({
      documentId,
      startedAt: "2026-11-10T00:00:00Z",
      status: "SUCCEEDED",
      classification: "NEW_CANDIDATE",
    });
    await addRunWithDiff({
      documentId,
      startedAt: "2026-11-11T00:00:00Z",
      status: "SUCCEEDED",
      classification: "UPDATE",
    });

    expect(await listPendingDiffReviewItems()).toHaveLength(0);
    expect(await getPendingDiffReviewSummary()).toEqual({
      total: 0,
      newCandidate: 0,
      unmatched: 0,
    });
  });

  it("keeps showing the last successful parse when a later parse failed", async () => {
    const documentId = await addDocument();
    await addRunWithDiff({
      documentId,
      startedAt: "2026-11-10T00:00:00Z",
      status: "SUCCEEDED",
      classification: "UNMATCHED",
    });
    await addRunWithDiff({ documentId, startedAt: "2026-11-11T00:00:00Z", status: "FAILED" });

    expect(await listPendingDiffReviewItems()).toHaveLength(1);
    expect(await getPendingDiffReviewSummary()).toEqual({
      total: 1,
      newCandidate: 0,
      unmatched: 1,
    });
  });
});
