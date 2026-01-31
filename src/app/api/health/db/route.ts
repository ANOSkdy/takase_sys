export const runtime = "nodejs";

import { getSql } from "@/db/client";

export async function GET() {
  try {
    const sql = getSql();
    const result = await sql`select 1 as ok`;
    return Response.json({ ok: true, result }, { status: 200 });
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    // do not leak secrets; keep it minimal
    return Response.json({ ok: false, error: message }, { status: 503 });
  }
}
