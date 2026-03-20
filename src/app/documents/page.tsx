import DocumentsClient from "./documents-client";
import SharedNavHeader from "@/app/shared-nav-header";
import { getMaxPdfPages, getMaxPdfSizeMb } from "@/services/documents/constants";
import { listDocuments } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const [items, maxPdfMb, maxPdfPages] = await Promise.all([
    listDocuments(),
    getMaxPdfSizeMb(),
    getMaxPdfPages(),
  ]);

  return (
    <>
      <SharedNavHeader />
      <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
        <header style={{ display: "grid", gap: "var(--space-2)" }}>
          <h1 style={{ margin: 0 }}>納品書PDF</h1>
          <p style={{ margin: 0, color: "var(--muted)" }}>
            PDFのみアップロードできます。解析ボタンから仕入先・明細を抽出します。
          </p>
        </header>

        <DocumentsClient initialItems={items} maxPdfMb={maxPdfMb} maxPdfPages={maxPdfPages} />
      </main>
    </>
  );
}
