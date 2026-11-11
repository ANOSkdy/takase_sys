const VERCEL_BLOB_HOST = "blob.vercel-storage.com";

/**
 * documents.storage_key から、サーバーが取得してよいPDFのURLを決める。
 *
 * storage_key は登録時にクライアントから渡された値なので、そのまま fetch すると
 * 任意URLの取得（SSRF）やストレージ用トークンの外部送信につながる。
 * Vercel Blob の https URL だけを許可し、それ以外は null を返す。
 */
export function resolveDocumentFileUrl(storageKey: string): URL | null {
  const key = storageKey.trim();
  if (!key) return null;

  let url: URL;
  try {
    url = /^https?:\/\//i.test(key)
      ? new URL(key)
      : new URL(`https://${VERCEL_BLOB_HOST}/${key.replace(/^\/+/, "")}`);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.port) return null;

  const host = url.hostname.toLowerCase();
  if (host !== VERCEL_BLOB_HOST && !host.endsWith(`.${VERCEL_BLOB_HOST}`)) return null;

  return url;
}
