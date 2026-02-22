"use client";

import { upload } from "@vercel/blob/client";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ReactNode } from "react";
import type { DocumentListItem } from "@/services/documents/types";
import { bulkParseSelected, buildDocumentLabel, type BulkParseProgress } from "@/app/documents/bulk-parse";

type UploadItem = {
  id: string;
  fileName: string;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
};

type DeleteState = {
  target: DocumentListItem;
  busy: boolean;
  error?: string;
};

type ParseState = {
  targetId: string;
  busy: boolean;
  fileName?: string;
};

type BulkConfirmState = {
  open: boolean;
  count: number;
};

const jstDateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function sanitizeFilename(name: string): string {
  const base = name.replace(/[\/\\]/g, "_").replace(/[\u0000-\u001f\u007f]/g, "");
  const trimmed = base.trim().slice(0, 180);
  return trimmed || "file.pdf";
}

export default function DocumentsClient({
  initialItems,
  maxPdfMb,
  maxPdfPages,
}: {
  initialItems: DocumentListItem[];
  maxPdfMb: number;
  maxPdfPages: number;
}) {
  const [items, setItems] = useState<DocumentListItem[]>(initialItems);
  const [uploadNote, setUploadNote] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<BulkConfirmState>({ open: false, count: 0 });
  const [bulkProgress, setBulkProgress] = useState<BulkParseProgress | null>(null);
  const bulkAbortRef = useRef<AbortController | null>(null);

  const maxBytes = useMemo(() => maxPdfMb * 1024 * 1024, [maxPdfMb]);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents");
    if (!res.ok) {
      throw new Error("一覧取得に失敗しました。");
    }
    const data = (await res.json()) as { items: DocumentListItem[] };
    setItems(data.items);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      refresh().catch(() => null);
    }, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const currentIds = new Set(items.map((item) => item.documentId));
      const next = new Set(Array.from(prev).filter((id) => currentIds.has(id)));
      return next;
    });
  }, [items]);

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files).slice(0, 1);
      if (fileArray.length === 0) return;

      setError(null);
      setBusy(true);

      const newUploads: UploadItem[] = fileArray.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        status: "pending",
      }));
      setUploads((prev) => [...newUploads, ...prev]);

      try {
        for (const [index, file] of fileArray.entries()) {
          const uploadId = newUploads[index]?.id;
          const updateUpload = (patch: Partial<UploadItem>) => {
            setUploads((prev) =>
              prev.map((u) => (u.id === uploadId ? { ...u, ...patch } : u)),
            );
          };

          if (file.type !== "application/pdf") {
            updateUpload({ status: "error", message: "PDF以外はアップロードできません。" });
            continue;
          }
          if (file.size > maxBytes) {
            updateUpload({
              status: "error",
              message: `ファイルサイズが上限（${maxPdfMb}MB）を超えています。`,
            });
            continue;
          }

          updateUpload({ status: "uploading", message: "アップロード準備中" });

          try {
            const sourceFileHash = await hashFile(file);
            const srcBytes = new Uint8Array(await file.arrayBuffer());
            const { getPdfPageCount, PdfSplitError, splitPdfPagesSequentially } = await import(
              "@/services/documents/pdf-split"
            );
            const pageCount = await getPdfPageCount(srcBytes);
            if (pageCount > maxPdfPages) {
              throw new Error(`ページ数が上限（${maxPdfPages}）を超えています。`);
            }

            updateUpload({ status: "uploading", message: `分割準備中（0/${pageCount}）` });

            const uploadedPages: Array<{
              storageKey: string;
              fileHash: string;
              pageNumber: number;
              pageTotal: number;
            }> = [];

            await splitPdfPagesSequentially(srcBytes, async (page) => {
              updateUpload({
                status: "uploading",
                message: `page ${page.pageNumber}/${page.pageTotal} をアップロード中`,
              });
              try {
                const pageHash = await hashBytes(page.bytes);
                const pageFile = new File([page.bytes.slice()], `${file.name}.p${page.pageNumber}.pdf`, {
                  type: "application/pdf",
                });
                const safeName = sanitizeFilename(`${file.name}.p${page.pageNumber}.pdf`);
                const pathname = `documents/${safeName}`;

                const blob = await upload(pathname, pageFile, {
                  access: "public",
                  handleUploadUrl: "/api/documents/init-upload",
                });

                uploadedPages.push({
                  storageKey: blob.url,
                  fileHash: pageHash,
                  pageNumber: page.pageNumber,
                  pageTotal: page.pageTotal,
                });
              } catch (error) {
                throw new PdfSplitError(
                  "PDF_SPLIT_PAGE_UPLOAD_FAILED",
                  `ページ ${page.pageNumber} のアップロードに失敗しました。`,
                  {
                    cause: error,
                    pageNumber: page.pageNumber,
                  },
                );
              }
            });

            updateUpload({ status: "uploading", message: "登録処理中" });

            const registerRes = await fetch("/api/documents/bulk", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                fileName: file.name,
                sourceFileHash,
                pages: uploadedPages,
                uploadNote: uploadNote.trim() || undefined,
              }),
            });

            if (!registerRes.ok) {
              const text = await registerRes.text().catch(() => "");
              throw new Error(text || "登録に失敗しました。");
            }

            updateUpload({ status: "done", message: `${uploadedPages.length}ページの登録が完了` });
            await refresh();
          } catch (err) {
            const code =
              typeof err === "object" && err !== null && "code" in err
                ? String((err as { code: unknown }).code)
                : "UPLOAD_FAILED";
            const pageNumber =
              typeof err === "object" && err !== null && "pageNumber" in err
                ? Number((err as { pageNumber: unknown }).pageNumber)
                : null;
            console.error("[documents] upload flow failed", {
              code,
              pageNumber,
              name: err instanceof Error ? err.name : "unknown",
            });
            updateUpload({
              status: "error",
              message:
                err instanceof Error
                  ? `${err.message}${code !== "UPLOAD_FAILED" ? ` (${code})` : ""}`
                  : "アップロードに失敗しました。",
            });
            setError("アップロードに失敗したファイルがあります。");
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [maxBytes, maxPdfMb, maxPdfPages, refresh, uploadNote],
  );

  const onDelete = async () => {
    if (!deleteState) return;
    setDeleteState({ ...deleteState, busy: true, error: undefined });
    try {
      const res = await fetch(`/api/documents/${deleteState.target.documentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "削除に失敗しました。");
      }
      setDeleteState(null);
      await refresh();
    } catch (err) {
      setDeleteState((prev) =>
        prev
          ? {
              ...prev,
              busy: false,
              error: err instanceof Error ? err.message : "削除失敗",
            }
          : null,
      );
    }
  };

  const onParse = async (documentId: string, fileName: string) => {
    setParseState({ targetId: documentId, busy: true, fileName });
    try {
      const res = await fetch(`/api/documents/${documentId}/parse`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "解析に失敗しました。");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました。");
    } finally {
      setParseState(null);
    }
  };

  const visibleIds = useMemo(() => items.map((item) => item.documentId), [items]);
  const selectedCount = selectedIds.size;
  const allVisibleSelected = useMemo(
    () => visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id)),
    [selectedIds, visibleIds],
  );

  const toggleItemSelection = (documentId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  };

  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of visibleIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const startBulkParse = async () => {
    const targetIds = new Set(selectedIds);
    if (targetIds.size === 0) return;

    const controller = new AbortController();
    bulkAbortRef.current = controller;
    setBulkProgress(null);
    setBulkConfirm({ open: false, count: 0 });

    try {
      await bulkParseSelected({
        items,
        selectedIds: targetIds,
        signal: controller.signal,
        onProgress: (progress) => setBulkProgress(progress),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "一括解析に失敗しました。");
    } finally {
      bulkAbortRef.current = null;
    }
  };

  const cancelBulkParse = () => {
    bulkAbortRef.current?.abort();
  };

  const selectUnfinished = () => {
    setSelectedIds(new Set(items.filter((item) => item.status !== "PARSED").map((item) => item.documentId)));
  };

  return (
    <section style={{ display: "grid", gap: "var(--space-4)" }}>
      <div style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>アップロード</h2>
        <FileDropzone onFiles={handleFiles} disabled={busy} maxPdfMb={maxPdfMb} />
        <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <label style={labelStyle}>アップロードメモ（任意）</label>
          <textarea
            value={uploadNote}
            onChange={(e) => setUploadNote(e.target.value)}
            rows={2}
            style={textareaStyle}
            placeholder="例：山田商事 2025/02 納品書"
          />
        </div>
        {error && <p style={{ color: "var(--color-danger)" }}>{error}</p>}

        {uploads.length > 0 && (
          <div style={{ marginTop: "var(--space-3)", display: "grid", gap: "var(--space-2)" }}>
            <strong>アップロード状況</strong>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {uploads.map((u) => (
                <li key={u.id} style={uploadRowStyle}>
                  <span>{u.fileName}</span>
                  <span style={uploadStatusStyle(u.status)}>{u.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ marginTop: 0 }}>一覧</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btnSecondary} onClick={selectUnfinished}>
              未完了を選択
            </button>
            <button
              style={btnPrimary}
              onClick={() => setBulkConfirm({ open: true, count: selectedCount })}
              disabled={selectedCount === 0 || Boolean(bulkAbortRef.current)}
            >
              一括解析
            </button>
            <button style={btnSecondary} onClick={() => refresh()}>
              再読み込み
            </button>
          </div>
        </div>
        {bulkProgress && (
          <div style={bulkProgressStyle}>
            <strong>
              一括解析進捗: {bulkProgress.done}/{bulkProgress.total}
            </strong>
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              成功 {bulkProgress.success} / 失敗 {bulkProgress.failed} / スキップ {bulkProgress.skipped}
            </div>
            {bulkProgress.currentFileLabel && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                現在処理中: {bulkProgress.currentFileLabel}
              </div>
            )}
            {bulkAbortRef.current && (
              <button style={btnDanger} onClick={cancelBulkParse}>
                一括解析を中止
              </button>
            )}
            {bulkProgress.cancelled && (
              <div style={{ color: "var(--color-danger)", fontSize: 13 }}>一括解析を中止しました。</div>
            )}
          </div>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    aria-label="表示中の全選択"
                    checked={allVisibleSelected}
                    onChange={(event) => toggleVisibleSelection(event.target.checked)}
                  />
                </Th>
                <Th>ファイル名</Th>
                <Th>アップロード日時</Th>
                <Th>ステータス</Th>
                <Th>仕入先</Th>
                <Th>請求日</Th>
                <Th>メモ</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.documentId}>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`${buildDocumentLabel(item)} を選択`}
                      checked={selectedIds.has(item.documentId)}
                      onChange={(event) => toggleItemSelection(item.documentId, event.target.checked)}
                    />
                  </Td>
                  <Td>{renderFileName(item)}</Td>
                  <Td muted>{formatDateTime(item.uploadedAt)}</Td>
                  <Td>
                    <StatusChip status={item.status} />
                  </Td>
                  <Td>{item.vendorName ?? "-"}</Td>
                  <Td muted>{item.invoiceDate ? formatDate(item.invoiceDate) : "-"}</Td>
                  <Td muted>{item.uploadNote ?? "-"}</Td>
                  <Td>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        style={btnPrimary}
                        onClick={() => onParse(item.documentId, item.fileName)}
                        disabled={item.status === "PARSING" || parseState?.busy}
                      >
                        解析
                      </button>
                      <a href={`/documents/${item.documentId}/diff`} style={btnLink}>
                        差分
                      </a>
                      <button
                        style={btnDanger}
                        onClick={() =>
                          setDeleteState({
                            target: item,
                            busy: false,
                          })
                        }
                      >
                        削除
                      </button>
                    </div>
                  </Td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    まだアップロードされたPDFがありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {deleteState && (
        <div style={modalBackdrop} role="dialog" aria-modal="true">
          <div style={modalPanel}>
            <h3>削除の確認</h3>
            <p style={{ color: "var(--muted)" }}>
              「{deleteState.target.fileName}」を本当に削除しますか？
            </p>

            {deleteState.error && <p style={{ color: "var(--color-danger)" }}>{deleteState.error}</p>}

            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
              <button style={btnSecondary} onClick={() => setDeleteState(null)} disabled={deleteState.busy}>
                いいえ
              </button>
              <button style={btnDanger} onClick={onDelete} disabled={deleteState.busy}>
                はい
              </button>
            </div>
          </div>
        </div>
      )}

      {parseState?.busy && (
        <div style={modalBackdrop} role="status" aria-live="polite" aria-busy="true">
          <div style={modalPanel}>
            <h3 style={{ marginTop: 0 }}>解析を実行中です</h3>
            <p style={{ color: "var(--muted)", marginBottom: 0 }}>
              {parseState.fileName
                ? `「${parseState.fileName}」を解析しています。完了までこのままお待ちください。`
                : "PDFを解析しています。完了までこのままお待ちください。"}
            </p>
          </div>
        </div>
      )}

      {bulkConfirm.open && (
        <div style={modalBackdrop} role="dialog" aria-modal="true">
          <div style={modalPanel}>
            <h3>一括解析の確認</h3>
            <p style={{ color: "var(--muted)" }}>
              選択中の {bulkConfirm.count} 件を1ページずつ順番に解析します。完了まで時間がかかる可能性があります。
            </p>
            <p style={{ color: "var(--muted)" }}>開始しますか？</p>
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
              <button
                style={btnSecondary}
                onClick={() => setBulkConfirm({ open: false, count: 0 })}
                disabled={Boolean(bulkAbortRef.current)}
              >
                キャンセル
              </button>
              <button style={btnPrimary} onClick={startBulkParse} disabled={Boolean(bulkAbortRef.current)}>
                逐次で一括解析を開始
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function FileDropzone({
  onFiles,
  disabled,
  maxPdfMb,
}: {
  onFiles: (files: FileList | File[]) => void;
  disabled: boolean;
  maxPdfMb: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    if (event.dataTransfer.files?.length) {
      onFiles(event.dataTransfer.files);
    }
  };

  return (
    <div
      style={{
        ...dropzoneStyle,
        opacity: disabled ? 0.6 : 1,
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        multiple={false}
        onChange={(event) => event.target.files && onFiles(event.target.files)}
        style={{ display: "none" }}
        disabled={disabled}
      />
      <div style={{ display: "grid", gap: 4 }}>
        <strong>PDFをドラッグ＆ドロップ</strong>
        <span style={{ color: "var(--muted)" }}>クリックでファイルを選択</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>最大 {maxPdfMb}MB / PDFのみ</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>アップロードは1ファイルずつ</span>
      </div>
    </div>
  );
}

function renderFileName(item: DocumentListItem): string {
  if (item.pageNumber && item.pageTotal) {
    return `${item.fileName} (p${item.pageNumber}/${item.pageTotal})`;
  }
  return item.fileName;
}

function StatusChip({ status }: { status: DocumentListItem["status"] }) {
  const labelMap: Record<DocumentListItem["status"], string> = {
    UPLOADED: "アップロード済み",
    PARSING: "解析中",
    PARSED: "解析完了",
    FAILED: "解析失敗",
    DELETED: "削除済み",
  };
  const colorMap: Record<string, string> = {
    UPLOADED: "#2563eb",
    PARSING: "#f59e0b",
    PARSED: "#16a34a",
    FAILED: "#dc2626",
    DELETED: "#6b7280",
  };
  return (
    <span
      style={{
        padding: "4px 8px",
        borderRadius: 999,
        background: "rgba(0,0,0,0.04)",
        color: colorMap[status] ?? "var(--text)",
        fontSize: 12,
        fontWeight: 600,
        display: "inline-block",
      }}
    >
      {labelMap[status]}
    </span>
  );
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  return hashArrayBuffer(buffer);
}

async function hashBytes(bytes: Uint8Array): Promise<string> {
  const normalized = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return hashArrayBuffer(normalized);
}

async function hashArrayBuffer(buffer: ArrayBuffer | SharedArrayBuffer): Promise<string> {
  let bytes = new Uint8Array(buffer as ArrayBuffer);
  if (!(buffer instanceof ArrayBuffer)) {
    bytes = new Uint8Array(new ArrayBuffer(buffer.byteLength));
    bytes.set(new Uint8Array(buffer));
  }
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return jstDateTimeFormatter.format(date);
}

function formatDate(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return jstDateFormatter.format(date);
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

const dropzoneStyle: CSSProperties = {
  border: "1px dashed var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-4)",
  display: "grid",
  placeItems: "center",
  cursor: "pointer",
  background: "rgba(0,0,0,0.02)",
};

const textareaStyle: CSSProperties = {
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  padding: "8px 12px",
  outline: "none",
  background: "var(--surface)",
};

const labelStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--muted)",
};

const btnSecondary: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
};

const btnPrimary: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid rgba(37,99,235,0.4)",
  background: "rgba(37,99,235,0.1)",
  color: "#2563eb",
  cursor: "pointer",
};

const btnDanger: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid rgba(220,38,38,0.4)",
  background: "rgba(220,38,38,0.1)",
  color: "#dc2626",
  cursor: "pointer",
};

const btnLink: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "rgba(0,0,0,0.02)",
  color: "var(--text)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
};

const bulkProgressStyle: CSSProperties = {
  display: "grid",
  gap: 4,
  marginBottom: "var(--space-3)",
  padding: "var(--space-3)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  background: "rgba(0,0,0,0.02)",
};

const uploadRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "var(--space-2)",
  padding: "8px 12px",
  borderRadius: "var(--radius-md)",
  background: "rgba(0,0,0,0.03)",
};

const modalBackdrop: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "grid",
  placeItems: "center",
  padding: "var(--space-4)",
  zIndex: 50,
};

const modalPanel: CSSProperties = {
  width: "min(520px, 100%)",
  background: "var(--surface)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "12px 12px",
        fontSize: 12,
        color: "var(--muted)",
        borderBottom: "1px solid var(--border)",
        background: "rgba(0,0,0,0.02)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <td
      style={{
        padding: "12px 12px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        color: muted ? "var(--muted)" : "var(--text)",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}

function uploadStatusStyle(status: UploadItem["status"]): CSSProperties {
  const colors: Record<UploadItem["status"], string> = {
    pending: "var(--muted)",
    uploading: "#2563eb",
    done: "#16a34a",
    error: "#dc2626",
  };
  return { color: colors[status], fontSize: 12 };
}
