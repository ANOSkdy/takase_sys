import type { DocumentDetail, DocumentListItem, DocumentStatus } from "@/services/documents/types";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type BulkParseProgress = {
  total: number;
  done: number;
  success: number;
  failed: number;
  skipped: number;
  currentDocumentId: string | null;
  currentFileLabel: string | null;
  cancelled: boolean;
};

export type BulkParseResult = BulkParseProgress;

const TERMINAL_STATUSES: ReadonlySet<DocumentStatus> = new Set(["PARSED", "FAILED", "DELETED"]);
const SKIP_STATUSES: ReadonlySet<DocumentStatus> = new Set(["PARSED", "PARSING", "DELETED"]);

export function buildDocumentLabel(item: DocumentListItem): string {
  if (item.pageNumber && item.pageTotal) {
    return `${item.fileName} (p${item.pageNumber}/${item.pageTotal})`;
  }
  return item.fileName;
}

export function sortDocumentsForBulkParse(items: DocumentListItem[], selectedIds: Set<string>) {
  return items
    .filter((item) => selectedIds.has(item.documentId))
    .slice()
    .sort((a, b) => {
      const groupA = a.uploadGroupId ?? "zzzz";
      const groupB = b.uploadGroupId ?? "zzzz";
      if (groupA !== groupB) return groupA.localeCompare(groupB);

      const pageA = a.pageNumber ?? Number.MAX_SAFE_INTEGER;
      const pageB = b.pageNumber ?? Number.MAX_SAFE_INTEGER;
      if (pageA !== pageB) return pageA - pageB;

      if (a.fileName !== b.fileName) return a.fileName.localeCompare(b.fileName);
      if (a.uploadedAt !== b.uploadedAt) return a.uploadedAt.localeCompare(b.uploadedAt);
      return a.documentId.localeCompare(b.documentId);
    });
}

export async function waitForDocumentTerminalStatus(options: {
  documentId: string;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const { documentId, signal, timeoutMs = 180_000 } = options;
  const fetchImpl = options.fetchImpl ?? fetch;

  const startedAt = Date.now();
  let attempt = 0;

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      throw new DOMException("aborted", "AbortError");
    }

    const res = await fetchImpl(`/api/documents/${documentId}`);
    if (!res.ok) {
      throw new Error(`状態確認に失敗しました。(${res.status})`);
    }

    const detail = (await res.json()) as DocumentDetail;
    if (TERMINAL_STATUSES.has(detail.status)) {
      return detail.status;
    }

    const delayMs = getBackoffDelayMs(attempt);
    attempt += 1;
    await sleep(delayMs, signal);
  }

  throw new Error("解析待機がタイムアウトしました。");
}

export async function bulkParseSelected(options: {
  items: DocumentListItem[];
  selectedIds: Set<string>;
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
  onProgress?: (progress: BulkParseProgress) => void;
}): Promise<BulkParseResult> {
  const { items, selectedIds, signal, onProgress } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const queue = sortDocumentsForBulkParse(items, selectedIds);

  const progress: BulkParseProgress = {
    total: queue.length,
    done: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    currentDocumentId: null,
    currentFileLabel: null,
    cancelled: false,
  };

  const publish = () => onProgress?.({ ...progress });
  publish();

  for (const item of queue) {
    if (signal?.aborted) {
      progress.cancelled = true;
      break;
    }

    progress.currentDocumentId = item.documentId;
    progress.currentFileLabel = buildDocumentLabel(item);
    publish();

    if (SKIP_STATUSES.has(item.status)) {
      progress.skipped += 1;
      progress.done += 1;
      publish();
      continue;
    }

    try {
      const parseRes = await fetchImpl(`/api/documents/${item.documentId}/parse`, { method: "POST" });
      if (!(parseRes.ok || parseRes.status === 409)) {
        const text = await parseRes.text().catch(() => "");
        throw new Error(text || `解析開始に失敗しました。(${parseRes.status})`);
      }

      const finalStatus = await waitForDocumentTerminalStatus({
        documentId: item.documentId,
        fetchImpl,
        signal,
      });

      if (finalStatus === "PARSED") {
        progress.success += 1;
      } else {
        progress.failed += 1;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        progress.cancelled = true;
        break;
      }
      progress.failed += 1;
    }

    progress.done += 1;
    publish();
  }

  progress.currentDocumentId = null;
  progress.currentFileLabel = null;
  publish();
  return progress;
}

function getBackoffDelayMs(attempt: number): number {
  if (attempt <= 0) return 500;
  if (attempt === 1) return 1000;
  return 2000;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("aborted", "AbortError"));
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
