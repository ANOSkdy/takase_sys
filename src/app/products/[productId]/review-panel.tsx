"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ReviewStatusBadge } from "@/components/product/ReviewStatus";
import type { ReviewStatus } from "@/domain/review-status";
import type { SimilarProductCandidate } from "@/services/products/candidates";
import type { MergePriceConflict, PriceChoice } from "@/services/products/review";
import type {
  CandidateSnapshotChange,
  ProductListItem,
  ProductVendorPrice,
} from "@/services/products/types";

type PanelProduct = {
  productId: string;
  productName: string;
  productMaker: string | null;
  spec: string | null;
  category: string | null;
  reviewStatus: ReviewStatus;
  lastUpdatedAt: string;
  vendorPrices: ProductVendorPrice[];
};

type MergeTarget = {
  productId: string;
  productName: string;
  spec: string | null;
  reviewStatus: ReviewStatus;
  lastUpdatedAt: string;
};

type Problem = {
  detail?: string;
  errors?: {
    code?: string;
    conflictingProductId?: string | null;
    priceConflicts?: MergePriceConflict[];
  };
};

type Mode = "idle" | "requestReview" | "correct" | "merge";

function isMergeable(status: ReviewStatus) {
  return status === "VERIFIED" || status === "LEGACY";
}

export default function ReviewPanel({
  product,
  candidates,
  candidateSnapshotChanges,
}: {
  product: PanelProduct;
  candidates: SimilarProductCandidate[];
  candidateSnapshotChanges: CandidateSnapshotChange[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [conflictingProductId, setConflictingProductId] = useState<string | null>(null);

  const [reason, setReason] = useState("");
  const [form, setForm] = useState({
    productName: product.productName,
    productMaker: product.productMaker ?? "",
    spec: product.spec ?? "",
    category: product.category ?? "",
  });
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.vendorPrices.map((row) => [row.vendorPriceId, row.unitPrice])),
  );

  const [target, setTarget] = useState<MergeTarget | null>(null);
  const [priceConflicts, setPriceConflicts] = useState<MergePriceConflict[]>([]);
  const [priceChoices, setPriceChoices] = useState<Record<string, PriceChoice>>({});
  const [keyword, setKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<MergeTarget[] | null>(null);
  const [searching, setSearching] = useState(false);

  const resetMessages = () => {
    setError(null);
    setStale(false);
    setConflictingProductId(null);
  };

  const openMode = (next: Mode) => {
    resetMessages();
    setMode((current) => (current === next ? "idle" : next));
  };

  /** 成功時は遷移先のIDまたは null、失敗時は false。 */
  const submit = async (body: Record<string, unknown>): Promise<string | null | false> => {
    if (busy) return false;
    setBusy(true);
    resetMessages();
    try {
      const res = await fetch(`/api/products/${product.productId}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...body,
          expectedUpdatedAt: product.lastUpdatedAt,
        }),
      });
      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as Problem | null;
        const code = problem?.errors?.code;
        setError(problem?.detail ?? "操作に失敗しました。");
        setStale(code === "STALE");
        setConflictingProductId(problem?.errors?.conflictingProductId ?? null);
        if (code === "PRICE_CHOICE_REQUIRED") {
          setPriceConflicts(problem?.errors?.priceConflicts ?? []);
        }
        return false;
      }
      const result = (await res.json()) as { mergedIntoProductId?: string };
      return result.mergedIntoProductId ?? null;
    } catch {
      setError("通信エラーが発生しました。時間をおいて再度お試しください。");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const done = (mergedInto: string | null) => {
    setMode("idle");
    if (mergedInto) router.push(`/products/${mergedInto}`);
    else router.refresh();
  };

  const verify = async () => {
    const result = await submit({ action: "VERIFY" });
    if (result !== false) done(result);
  };

  const requestReview = async (event: FormEvent) => {
    event.preventDefault();
    const result = await submit({ action: "REQUEST_REVIEW", reason });
    if (result !== false) {
      setReason("");
      done(result);
    }
  };

  const correct = async (event: FormEvent) => {
    event.preventDefault();
    const result = await submit({
      action: "CORRECT",
      ...form,
      prices: product.vendorPrices
        .filter((row) => (priceInputs[row.vendorPriceId] ?? "").trim() !== "")
        .map((row) => ({
          vendorPriceId: row.vendorPriceId,
          unitPrice: priceInputs[row.vendorPriceId],
        })),
    });
    if (result !== false) done(result);
  };

  const merge = async () => {
    if (!target) {
      setError("統合先の商品を選択してください。");
      return;
    }
    const result = await submit({
      action: "MERGE",
      targetProductId: target.productId,
      targetExpectedUpdatedAt: target.lastUpdatedAt,
      priceChoices,
    });
    if (result !== false) done(result);
  };

  const chooseTarget = (next: MergeTarget) => {
    setTarget(next);
    setPriceConflicts([]);
    setPriceChoices({});
    resetMessages();
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    const term = keyword.trim();
    if (!term) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/products?keyword=${encodeURIComponent(term)}&limit=20`, {
        cache: "no-store",
      });
      const data = res.ok ? ((await res.json()) as { items: ProductListItem[] }) : { items: [] };
      setSearchResults(
        data.items
          .filter((item) => item.productId !== product.productId && isMergeable(item.reviewStatus))
          .map((item) => ({
            productId: item.productId,
            productName: item.productName,
            spec: item.spec,
            reviewStatus: item.reviewStatus,
            lastUpdatedAt: item.lastUpdatedAt,
          })),
      );
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const unresolvedConflicts = priceConflicts.filter((c) => !priceChoices[c.vendorName]);

  return (
    <section style={cardStyle} aria-label="確認操作">
      <h2 style={{ marginTop: 0 }}>確認操作</h2>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {product.reviewStatus !== "VERIFIED" && (
          <button type="button" style={btnPrimary} disabled={busy} onClick={verify}>
            この内容で確定する
          </button>
        )}
        <button
          type="button"
          style={btnSecondary}
          disabled={busy}
          onClick={() => openMode("correct")}
        >
          読み取り内容を修正
        </button>
        <button
          type="button"
          style={btnSecondary}
          disabled={busy}
          onClick={() => openMode("merge")}
        >
          既存商品へ統合
        </button>
        {product.reviewStatus !== "NEEDS_REVIEW" && (
          <button
            type="button"
            style={btnSecondary}
            disabled={busy}
            onClick={() => openMode("requestReview")}
          >
            再確認を依頼
          </button>
        )}
      </div>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
          {conflictingProductId && (
            <>
              {" "}
              <a href={`/products/${conflictingProductId}`}>同じ内容の商品を開く</a>
            </>
          )}
          {stale && (
            <>
              {" "}
              <button type="button" style={btnSecondary} onClick={() => window.location.reload()}>
                再読み込み
              </button>
            </>
          )}
        </div>
      )}

      {mode === "requestReview" && (
        <form onSubmit={requestReview} style={subPanelStyle}>
          <label htmlFor="review-reason" style={labelStyle}>
            再確認が必要な理由（必須）
          </label>
          <input
            id="review-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            required
            style={inputStyle}
          />
          <div>
            <button type="submit" style={btnPrimary} disabled={busy}>
              要確認にする
            </button>
          </div>
        </form>
      )}

      {mode === "correct" && (
        <form onSubmit={correct} style={subPanelStyle}>
          <p style={hintStyle}>
            修正しても確認済みにはなりません。内容が正しければ、修正後に「確定する」を押してください。
            PDFから抽出した原文は変更されません。
          </p>
          {(
            [
              ["productName", "品名（必須）", 300],
              ["productMaker", "メーカー", 200],
              ["spec", "規格", 500],
              ["category", "カテゴリ", 200],
            ] as const
          ).map(([key, label, max]) => (
            <div key={key} style={{ display: "grid", gap: 4 }}>
              <label htmlFor={`correct-${key}`} style={labelStyle}>
                {label}
              </label>
              <input
                id={`correct-${key}`}
                value={form[key]}
                onChange={(event) => setForm({ ...form, [key]: event.target.value })}
                maxLength={max}
                required={key === "productName"}
                style={inputStyle}
              />
            </div>
          ))}
          {product.vendorPrices.map((row) => (
            <div key={row.vendorPriceId} style={{ display: "grid", gap: 4 }}>
              <label htmlFor={`price-${row.vendorPriceId}`} style={labelStyle}>
                単価: {row.vendorName}
              </label>
              <input
                id={`price-${row.vendorPriceId}`}
                inputMode="decimal"
                value={priceInputs[row.vendorPriceId] ?? ""}
                onChange={(event) =>
                  setPriceInputs({ ...priceInputs, [row.vendorPriceId]: event.target.value })
                }
                style={{ ...inputStyle, maxWidth: 200 }}
              />
            </div>
          ))}
          <div>
            <button type="submit" style={btnPrimary} disabled={busy}>
              修正を保存
            </button>
          </div>
        </form>
      )}

      {mode === "merge" && (
        <div style={subPanelStyle}>
          <p style={hintStyle}>
            この商品の出典と仕入先単価を統合先へ移し、この商品を「統合済み」にします。
            統合先にできるのは、確認済みまたは既存データの商品だけです。統合先の確認状態は変わりません。
          </p>

          <h3 style={subHeadingStyle}>類似候補</h3>
          {candidates.length === 0 ? (
            <p style={{ margin: 0 }}>類似候補なし</p>
          ) : (
            <ul style={listStyle}>
              {candidates.map((candidate) => (
                <li key={candidate.productId} style={candidateStyle}>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="radio"
                      name="merge-target"
                      disabled={!candidate.mergeable}
                      checked={target?.productId === candidate.productId}
                      onChange={() => chooseTarget(candidate)}
                    />
                    <span style={{ display: "grid", gap: 2 }}>
                      <span>
                        <a
                          href={`/products/${candidate.productId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {candidate.productName}
                        </a>{" "}
                        <ReviewStatusBadge status={candidate.reviewStatus} />
                      </span>
                      <span style={hintStyle}>
                        {candidate.productMaker ?? "メーカーなし"} ／ {candidate.spec ?? "規格なし"}
                      </span>
                      <span style={{ fontSize: 12 }}>
                        一致: {candidate.matchedFields.join("、") || "なし"}
                      </span>
                      <span
                        style={{
                          fontSize: 12,
                          color: candidate.differingFields.length
                            ? "var(--color-danger)"
                            : "var(--muted)",
                          fontWeight: candidate.differingFields.length ? 700 : 400,
                        }}
                      >
                        相違: {candidate.differingFields.join("、") || "なし"}
                      </span>
                      {!candidate.mergeable && (
                        <span style={hintStyle}>
                          未確認の商品のため統合先にできません（先に確定が必要です）。
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {candidateSnapshotChanges.length > 0 && (
            <div style={hintStyle}>
              取込時点の候補から変わったもの:
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                {candidateSnapshotChanges.map((change) => (
                  <li key={change.productId}>
                    {change.productName ?? change.productId}: {change.change}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 style={subHeadingStyle}>候補以外から探す</h3>
          <form onSubmit={search} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="品名・規格で検索"
              aria-label="統合先を検索"
              style={{ ...inputStyle, minWidth: 240 }}
            />
            <button type="submit" style={btnSecondary} disabled={searching}>
              {searching ? "検索中..." : "検索"}
            </button>
          </form>
          {searchResults && searchResults.length === 0 && (
            <p style={{ margin: 0 }}>統合先にできる商品は見つかりませんでした。</p>
          )}
          {searchResults && searchResults.length > 0 && (
            <ul style={listStyle}>
              {searchResults.map((item) => (
                <li key={item.productId} style={candidateStyle}>
                  <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <input
                      type="radio"
                      name="merge-target"
                      checked={target?.productId === item.productId}
                      onChange={() => chooseTarget(item)}
                    />
                    <span>
                      <a href={`/products/${item.productId}`} target="_blank" rel="noreferrer">
                        {item.productName}
                      </a>{" "}
                      <ReviewStatusBadge status={item.reviewStatus} />
                      <span style={{ ...hintStyle, display: "block" }}>
                        {item.spec ?? "規格なし"}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {priceConflicts.length > 0 && (
            <div style={{ display: "grid", gap: 8 }}>
              <h3 style={subHeadingStyle}>単価の選択（同じ仕入先で単価が異なります）</h3>
              {priceConflicts.map((conflict) => (
                <fieldset key={conflict.vendorName} style={fieldsetStyle}>
                  <legend>{conflict.vendorName}</legend>
                  {(
                    [
                      [
                        "KEEP_TARGET",
                        "統合先の単価を残す",
                        conflict.targetUnitPrice,
                        conflict.targetPriceUpdatedOn,
                      ],
                      [
                        "USE_SOURCE",
                        "この商品の単価に置き換える",
                        conflict.sourceUnitPrice,
                        conflict.sourcePriceUpdatedOn,
                      ],
                    ] as const
                  ).map(([choice, label, price, date]) => (
                    <label key={choice} style={{ display: "block" }}>
                      <input
                        type="radio"
                        name={`price-${conflict.vendorName}`}
                        checked={priceChoices[conflict.vendorName] === choice}
                        onChange={() =>
                          setPriceChoices({ ...priceChoices, [conflict.vendorName]: choice })
                        }
                      />{" "}
                      {label}: {price} 円（価格更新日 {date ?? "不明"}）
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          )}

          <div>
            <button
              type="button"
              style={btnPrimary}
              disabled={busy || !target || unresolvedConflicts.length > 0}
              onClick={merge}
            >
              {target ? `「${target.productName}」へ統合する` : "統合先を選択してください"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

const subPanelStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  marginTop: 16,
  paddingTop: 16,
  borderTop: "1px solid var(--border)",
};

const labelStyle: CSSProperties = { fontSize: 12, color: "var(--muted)" };
const hintStyle: CSSProperties = { fontSize: 12, color: "var(--muted)", margin: 0 };
const subHeadingStyle: CSSProperties = { fontSize: 14, margin: 0 };
const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "grid",
  gap: 8,
};

const candidateStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
};

const fieldsetStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "8px 10px",
  margin: 0,
};

const inputStyle: CSSProperties = {
  height: 36,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  padding: "0 10px",
  background: "var(--surface)",
};

const btnPrimary: CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--color-primary)",
  color: "#fff",
  cursor: "pointer",
};

const btnSecondary: CSSProperties = {
  height: 36,
  padding: "0 14px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
};

const errorStyle: CSSProperties = {
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--color-danger)",
  background: "var(--color-danger-soft)",
  color: "var(--color-danger)",
};
