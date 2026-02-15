import DocumentsClient from "./documents-client";
import Link from "next/link";
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
          PDFのみアップロードできます。解析ボタンから仕入先・明細を抽出します。
        </p>
        <Link
          href="/records"
          style={{
            justifySelf: "start",
            color: "inherit",
            textDecoration: "none",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-md)",
            padding: "0.5rem 0.75rem",
          }}
        >
          仕切り表へ
        </Link>
      </header>

      <DocumentsClient initialItems={items} maxPdfMb={maxPdfMb} />
    </main>
  );
}
