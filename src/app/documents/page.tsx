import DocumentsClient from "./documents-client";
import { getMaxPdfSizeMb } from "@/services/documents/constants";
import { listDocuments } from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const [items, maxPdfMb] = await Promise.all([listDocuments(), getMaxPdfSizeMb()]);

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>納品書PDF</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          PDFのみアップロードできます。解析はPR2で対応します。
        </p>
      </header>

      <DocumentsClient initialItems={items} maxPdfMb={maxPdfMb} />
    </main>
  );
}
