"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ReactNode } from "react";
import type { DocumentListItem } from "@/services/documents/types";

type UploadItem = {
  id: string;
  fileName: string;
  status: "pending" | "uploading" | "done" | "error";
  message?: string;
};

type DeleteState = {
  target: DocumentListItem;
  confirmName: string;
  deletedReason: string;
  busy: boolean;
  error?: string;
};

type ParseState = {
  targetId: string;
  busy: boolean;
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

export default function DocumentsClient({
  initialItems,
  maxPdfMb,
}: {
  initialItems: DocumentListItem[];
  maxPdfMb: number;
}) {
  const [items, setItems] = useState<DocumentListItem[]>(initialItems);
  const [uploadNote, setUploadNote] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteState, setDeleteState] = useState<DeleteState | null>(null);
  const [parseState, setParseState] = useState<ParseState | null>(null);

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

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      if (fileArray.length === 0) return;
      setError(null);
      setBusy(true);

      const newUploads: UploadItem[] = fileArray.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        status: "pending",
      }));
      setUploads((prev) => [...newUploads, ...prev]);

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
          const fileHash = await hashFile(file);

          const initRes = await fetch("/api/documents/init-upload", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              contentType: file.type,
              size: file.size,
            }),
          });

          if (!initRes.ok) {
            const text = await initRes.text();
            throw new Error(text || "アップロードの初期化に失敗しました。");
          }

          const initData = (await initRes.json()) as {
            uploadUrl: string;
            storageKey: string;
          };

          updateUpload({ status: "uploading", message: "PDFアップロード中" });

          const uploadRes = await fetch(initData.uploadUrl, {
            method: "PUT",
            headers: { "content-type": "application/pdf" },
            body: file,
          });

          if (!uploadRes.ok) {
            const text = await uploadRes.text();
            throw new Error(text || "PDFのアップロードに失敗しました。");
          }

          updateUpload({ status: "uploading", message: "登録処理中" });

          const registerRes = await fetch("/api/documents", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              fileName: file.name,
              storageKey: initData.storageKey,
              fileHash,
              uploadNote: uploadNote.trim() || undefined,
            }),
          });

          if (!registerRes.ok) {
            const text = await registerRes.text();
            throw new Error(text || "登録に失敗しました。");
          }

          updateUpload({ status: "done", message: "完了" });
          await refresh();
        } catch (err) {
          updateUpload({
            status: "error",
            message: err instanceof Error ? err.message : "アップロードに失敗しました。",
          });
          setError("アップロードに失敗したファイルがあります。");
        }
      }

      setBusy(false);
    },
    [maxBytes, maxPdfMb, refresh, uploadNote],
  );

  const onDelete = async () => {
    if (!deleteState) return;
    setDeleteState({ ...deleteState, busy: true, error: undefined });
    try {
      const res = await fetch(`/api/documents/${deleteState.target.documentId}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deletedReason: deleteState.deletedReason.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "削除に失敗しました。");
      }
      setDeleteState(null);
      await refresh();
    } catch (err) {
      setDeleteState((prev) =>
        prev ? { ...prev, busy: false, error: err instanceof Error ? err.message : "削除失敗" } : null,
      );
    }
  };

  const onParse = async (documentId: string) => {
    setParseState({ targetId: documentId, busy: true });
    try {
      const res = await fetch(`/api/documents/${documentId}/parse`, { method: "POST" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "解析に失敗しました。");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "解析に失敗しました。");
    } finally {
      setParseState(null);
    }
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
              {uploads.map((upload) => (
                <li key={upload.id} style={uploadRowStyle}>
                  <span>{upload.fileName}</span>
                  <span style={uploadStatusStyle(upload.status)}>{upload.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ marginTop: 0 }}>一覧</h2>
          <button style={btnSecondary} onClick={() => refresh()}>
            再読み込み
          </button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
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
                  <Td>{item.fileName}</Td>
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
                        onClick={() => onParse(item.documentId)}
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
                            confirmName: "",
                            deletedReason: "",
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
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
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
              「{deleteState.target.fileName}」を削除します。ファイル名を入力して確認してください。
            </p>
            <div style={{ display: "grid", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <label style={labelStyle}>ファイル名の再入力</label>
              <input
                value={deleteState.confirmName}
                onChange={(e) =>
                  setDeleteState((prev) =>
                    prev ? { ...prev, confirmName: e.target.value } : prev,
                  )
                }
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
              <label style={labelStyle}>削除理由（任意）</label>
              <textarea
                value={deleteState.deletedReason}
                onChange={(e) =>
                  setDeleteState((prev) =>
                    prev ? { ...prev, deletedReason: e.target.value } : prev,
                  )
                }
                rows={2}
                style={textareaStyle}
              />
            </div>
            {deleteState.error && <p style={{ color: "var(--color-danger)" }}>{deleteState.error}</p>}
            <div style={{ display: "flex", gap: "var(--space-2)", justifyContent: "flex-end" }}>
              <button style={btnSecondary} onClick={() => setDeleteState(null)} disabled={deleteState.busy}>
                キャンセル
              </button>
              <button
                style={btnDanger}
                onClick={onDelete}
                disabled={
                  deleteState.busy || deleteState.confirmName !== deleteState.target.fileName
                }
              >
                削除する
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
        multiple
        onChange={(event) => event.target.files && onFiles(event.target.files)}
        style={{ display: "none" }}
        disabled={disabled}
      />
      <div style={{ display: "grid", gap: 4 }}>
        <strong>PDFをドラッグ＆ドロップ</strong>
        <span style={{ color: "var(--muted)" }}>クリックでファイルを選択</span>
        <span style={{ color: "var(--muted)", fontSize: 12 }}>最大 {maxPdfMb}MB / PDFのみ</span>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: DocumentListItem["status"] }) {
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
      {status}
    </span>
  );
}

async function hashFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
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

const inputStyle: CSSProperties = {
  height: 40,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  padding: "0 12px",
  outline: "none",
  background: "var(--surface)",
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
