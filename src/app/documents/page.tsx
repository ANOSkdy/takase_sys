import DocumentsClient from "./documents-client";
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
    <main className="documents-page">
      <header className="ui-page-header">
        <div>
          <h1>納品書PDF</h1>
          <p>PDFのみアップロードできます。解析ボタンから仕入先・明細を抽出します。</p>
        </div>
      </header>

      <DocumentsClient initialItems={items} maxPdfMb={maxPdfMb} maxPdfPages={maxPdfPages} />
    </main>
  );
}
