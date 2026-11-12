import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getEnv } from "@/config/env";
import { resolveDocumentFileUrl } from "@/services/documents/file-url";
import { getDocumentDetail } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
});

/**
 * 出典PDF（分割済みの1ページ）をアプリ経由で配信する。
 *
 * - 取得対象は documentId から引いた storage_key のみ。任意URLは受け付けない。
 * - ストレージのURLやトークンはクライアントへ渡さない。
 * - アプリ内認証はないため、アクセス制御はアプリ外の保護（Vercel保護等）に依存する。
 */
export async function GET(_req: Request, context: { params: Promise<{ documentId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid documentId");
  }

  let doc;
  try {
    doc = await getDocumentDetail(parsedParams.data.documentId);
  } catch (error) {
    console.error("[documents] file lookup failed", error);
    return problemResponse(500, "Internal Server Error", "PDFの情報を取得できませんでした。");
  }

  if (!doc) {
    return problemResponse(404, "Not Found", "PDFが見つかりません。");
  }
  if (doc.isDeleted) {
    return problemResponse(
      410,
      "Gone",
      doc.deletedReason
        ? `このPDFは削除済みです（理由: ${doc.deletedReason}）。`
        : "このPDFは削除済みです。",
    );
  }

  const url = resolveDocumentFileUrl(doc.storageKey);
  if (!url) {
    console.error("[documents] file has unsupported storage location", {
      documentId: doc.documentId,
    });
    return problemResponse(502, "Bad Gateway", "PDFの保存先を参照できません。");
  }

  let upstream: Response;
  try {
    const headers: Record<string, string> = {};
    const token = getEnv().BLOB_READ_WRITE_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;
    upstream = await fetch(url, { headers, redirect: "error", cache: "no-store" });
  } catch (error) {
    console.error("[documents] file fetch failed", {
      documentId: doc.documentId,
      message: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(502, "Bad Gateway", "PDFを取得できませんでした。");
  }

  if (!upstream.ok || !upstream.body) {
    console.error("[documents] file fetch returned error", {
      documentId: doc.documentId,
      status: upstream.status,
    });
    return problemResponse(502, "Bad Gateway", "PDFを取得できませんでした。");
  }

  const headers = new Headers({
    "content-type": "application/pdf",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    "cache-control": "private, no-store, max-age=0",
    "x-content-type-options": "nosniff",
  });
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);

  return new Response(upstream.body, { status: 200, headers });
}
