import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

import ReviewPanel from "./review-panel";

const product = {
  productId: "11111111-1111-4111-8111-111111111111",
  productName: "ウェザータイト(防水部材)",
  productMaker: "フクビ化学工業(株)",
  spec: "パイプ用 150φ WTP150 □255mm",
  category: null,
  reviewStatus: "PROVISIONAL" as const,
  lastUpdatedAt: "2026-11-11T00:00:00.000Z",
  vendorPrices: [],
};

const candidate = {
  productId: "22222222-2222-4222-8222-222222222222",
  productName: "ウェザータイト(防水部材)",
  productMaker: "フクビ化学工業(株)",
  spec: "パイプ用 100φ WTP100 □205mm",
  category: null,
  reviewStatus: "VERIFIED" as const,
  lastUpdatedAt: "2026-11-10T00:00:00.000Z",
  matchedFields: ["品名", "メーカー"],
  differingFields: ["口径・寸法（150φ 255mm ／ 100φ 205mm）"],
  mergeable: true,
};

function renderPanel(candidates = [candidate]) {
  return render(
    <ReviewPanel product={product} candidates={candidates} candidateSnapshotChanges={[]} />,
  );
}

function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ReviewPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("has no reviewer name field", () => {
    renderPanel();
    expect(screen.queryByLabelText(/確認者/)).toBeNull();
  });

  it("sends the verify action with the version it was loaded with", async () => {
    const fetchMock = mockFetch(200, { ok: true, reviewStatus: "VERIFIED" });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "この内容で確定する" }));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/products/${product.productId}/review`);
    expect(JSON.parse(init.body)).toEqual({
      action: "VERIFY",
      expectedUpdatedAt: product.lastUpdatedAt,
    });
  });

  it("offers a reload when the product was changed by someone else", async () => {
    mockFetch(409, { detail: "他の操作で更新されています。", errors: { code: "STALE" } });
    renderPanel();

    fireEvent.click(screen.getByRole("button", { name: "この内容で確定する" }));

    expect(await screen.findByRole("button", { name: "再読み込み" })).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("shows matched and differing fields for candidates and says so when there are none", () => {
    const { unmount } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "既存商品へ統合" }));
    expect(screen.getByText("一致: 品名、メーカー")).toBeInTheDocument();
    expect(screen.getByText("相違: 口径・寸法（150φ 255mm ／ 100φ 205mm）")).toBeInTheDocument();
    unmount();

    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "既存商品へ統合" }));
    expect(screen.getByText("類似候補なし")).toBeInTheDocument();
  });

  it("asks which price to keep before merging and then goes to the merge target", async () => {
    const fetchMock = mockFetch(409, {
      detail: "同じ仕入先で単価が異なります。",
      errors: {
        code: "PRICE_CHOICE_REQUIRED",
        priceConflicts: [
          {
            vendorName: "山田興業株式会社",
            sourceUnitPrice: "400.00",
            sourcePriceUpdatedOn: "2026-12-01",
            targetUnitPrice: "383.00",
            targetPriceUpdatedOn: "2026-11-04",
          },
        ],
      },
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "既存商品へ統合" }));
    fireEvent.click(screen.getAllByRole("radio")[0]);
    const mergeButton = screen.getByRole("button", { name: /へ統合する$/ });
    fireEvent.click(mergeButton);

    const keepTarget = await screen.findByLabelText(/統合先の単価を残す: 383.00 円/);
    expect(mergeButton).toBeDisabled();

    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, mergedIntoProductId: candidate.productId }), {
        status: 200,
      }),
    );
    fireEvent.click(keepTarget);
    fireEvent.click(mergeButton);

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/products/${candidate.productId}`));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      action: "MERGE",
      targetProductId: candidate.productId,
      targetExpectedUpdatedAt: candidate.lastUpdatedAt,
      priceChoices: { 山田興業株式会社: "KEEP_TARGET" },
    });
  });
});
