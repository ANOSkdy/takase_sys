import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  documentDiffItems,
  documentLineItems,
  documentParseRuns,
  documents,
  productDocumentSources,
  productMaster,
  productReviewHistory,
  updateHistory,
  vendorPrices,
} from "@/db/schema";
import type { AppDb } from "@/db/types";
import { makeProductKey } from "@/domain/normalize";
import { safeParseFloat } from "@/domain/pg-numeric";
import {
  canCreateProvisionalProduct,
  collectAttentionReasons,
  decideUnverifiedPriceAction,
  formatAttentionReason,
  isAutoUpdatableStatus,
  makersConflict,
} from "@/domain/provisional-product";
import { toReviewStatus, type ReviewStatus } from "@/domain/review-status";
import { findSimilarProducts, toMatchCandidateSnapshot } from "@/services/products/candidates";

/**
 * 解析済みの「新規商品候補（NEW_CANDIDATE）」明細を、後から仮登録へ移行する。
 *
 * 判定は解析時の仮登録と同じルール（domain/provisional-product）を使う。違いは、
 * 新しい解析を作らず、既存の明細・差分に対して商品・単価・出典・履歴を付ける点だけ。
 *
 * - 対象は、指定した取込グループの削除されていない書類の「成功した最新の解析」のみ
 * - 既に商品へ紐付いた明細（自動照合・手動紐付け）と、その単価履歴には触れない
 * - 未照合（UNMATCHED）の明細は商品化せず、別集計として報告するだけ
 * - 既存・確認済みの商品にキーが一致した明細は自動で反映せず、スキップして報告する
 * - dryRun のときは同じ処理を実行したうえで必ずロールバックする（結果は実行時と同じ）
 */

export const MIGRATION_REVIEWER = "system:provisional-migration";

export type MigrationOptions = {
  uploadGroupIds: string[];
  /** false のときだけコミットする。 */
  dryRun: boolean;
  /** 指定時、作成される商品数がこの値と違えばコミットしない（ドライラン結果との照合）。 */
  expectCreated?: number | null;
};

export type MigrationLineRef = {
  fileName: string;
  pageNumber: number | null;
  lineNo: number;
  productName: string | null;
  spec: string | null;
};

export type MigrationSkipReason =
  | "MISSING_NAME_OR_KEY"
  | "KEY_INCONSISTENT"
  | "LOW_CONFIDENCE"
  | "MATCHES_MERGED_PRODUCT"
  | "EXISTING_PRODUCT_MATCH";

export const MIGRATION_SKIP_LABELS: Record<MigrationSkipReason, string> = {
  MISSING_NAME_OR_KEY: "品名または商品キーがない",
  KEY_INCONSISTENT:
    "保存済みの商品キーを品名・規格・メーカーから再現できない（メーカーを確定できない）",
  LOW_CONFIDENCE: "信頼度が仮登録の条件を満たさない",
  MATCHES_MERGED_PRODUCT: "統合済みの商品に一致（統合先を確認して手動で紐付け）",
  EXISTING_PRODUCT_MATCH: "既存・確認済みの商品に一致（自動反映せず、手動で紐付け）",
};

export type MigrationReport = {
  dryRun: boolean;
  committed: boolean;
  /** コミットしなかった理由（ドライラン以外）。 */
  abortReason: string | null;
  uploadGroupIds: string[];
  documentCount: number;
  documentsWithoutSuccessfulParse: { fileName: string; pageNumber: number | null }[];
  lineCount: number;
  /** 対象（新規商品候補）の明細数。 */
  targetLineCount: number;
  /** 既に商品へ紐付いている明細（変更しない）。 */
  alreadyLinkedLineCount: number;
  /** 以前の移行・解析で出典が付いている明細（変更しない）。 */
  alreadyMigratedLineCount: number;
  /** 未照合の明細（商品化しない。別集計）。 */
  unmatchedLines: (MigrationLineRef & { reason: string | null })[];
  createdProducts: (MigrationLineRef & {
    productKey: string;
    productMaker: string | null;
    vendorName: string | null;
    unitPrice: string | null;
    attentionReason: string | null;
    candidateCount: number;
  })[];
  /** 同じ商品キーの別明細として、作成済みの仮登録商品へ出典を追加したもの。 */
  linkedLines: (MigrationLineRef & { productKey: string })[];
  pricesAdded: number;
  priceConflicts: (MigrationLineRef & {
    vendorName: string | null;
    existingUnitPrice: string | null;
    extractedUnitPrice: string | null;
  })[];
  skipped: (MigrationLineRef & { reason: MigrationSkipReason })[];
};

class RollbackMigration extends Error {}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type ProductInfo = {
  productId: string;
  productKey: string;
  productMaker: string | null;
  reviewStatus: ReviewStatus;
};

export async function migrateProvisionalProducts<H extends PgQueryResultHKT>(
  db: AppDb<H>,
  options: MigrationOptions,
): Promise<MigrationReport> {
  const report: MigrationReport = {
    dryRun: options.dryRun,
    committed: false,
    abortReason: null,
    uploadGroupIds: options.uploadGroupIds,
    documentCount: 0,
    documentsWithoutSuccessfulParse: [],
    lineCount: 0,
    targetLineCount: 0,
    alreadyLinkedLineCount: 0,
    alreadyMigratedLineCount: 0,
    unmatchedLines: [],
    createdProducts: [],
    linkedLines: [],
    pricesAdded: 0,
    priceConflicts: [],
    skipped: [],
  };
  if (options.uploadGroupIds.length === 0) {
    report.abortReason = "取込グループが指定されていません。";
    return report;
  }

  try {
    await db.transaction(async (tx) => {
      // 実DBには旧来の重複キーがあり、一意制約がない環境もある。
      // 手動移行中の商品作成を直列化し、照合からINSERTまでの競合を防ぐ。
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`LOCK TABLE product_master IN SHARE ROW EXCLUSIVE MODE`);
      // 1) 対象の固定: 削除されていない書類の、成功した最新の解析だけを使う。
      const docRows = await tx
        .select({
          documentId: documents.documentId,
          fileName: documents.fileName,
          pageNumber: documents.pageNumber,
          vendorName: documents.vendorName,
          invoiceDate: documents.invoiceDate,
        })
        .from(documents)
        .where(
          and(
            inArray(documents.uploadGroupId, options.uploadGroupIds),
            eq(documents.isDeleted, false),
          ),
        );
      report.documentCount = docRows.length;
      if (docRows.length === 0) return;

      const runRows = await tx
        .select({
          parseRunId: documentParseRuns.parseRunId,
          documentId: documentParseRuns.documentId,
        })
        .from(documentParseRuns)
        .where(
          and(
            inArray(
              documentParseRuns.documentId,
              docRows.map((doc) => doc.documentId),
            ),
            eq(documentParseRuns.status, "SUCCEEDED"),
          ),
        )
        .orderBy(desc(documentParseRuns.startedAt));
      const latestRunByDocument = new Map<string, string>();
      for (const run of runRows) {
        if (!latestRunByDocument.has(run.documentId)) {
          latestRunByDocument.set(run.documentId, run.parseRunId);
        }
      }

      const docs = [...docRows].sort(
        (a, b) =>
          a.fileName.localeCompare(b.fileName, "ja") ||
          (a.pageNumber ?? 0) - (b.pageNumber ?? 0) ||
          a.documentId.localeCompare(b.documentId),
      );
      const docByRun = new Map<string, (typeof docs)[number]>();
      for (const doc of docs) {
        const runId = latestRunByDocument.get(doc.documentId);
        if (runId) docByRun.set(runId, doc);
        else {
          report.documentsWithoutSuccessfulParse.push({
            fileName: doc.fileName,
            pageNumber: doc.pageNumber ?? null,
          });
        }
      }
      const runIds = Array.from(docByRun.keys());
      if (runIds.length === 0) return;

      const lineRows = await tx
        .select({
          lineItemId: documentLineItems.lineItemId,
          parseRunId: documentLineItems.parseRunId,
          lineNo: documentLineItems.lineNo,
          productMaker: documentLineItems.productMaker,
          productNameRaw: documentLineItems.productNameRaw,
          specRaw: documentLineItems.specRaw,
          productKeyCandidate: documentLineItems.productKeyCandidate,
          quantity: documentLineItems.quantity,
          unitPrice: documentLineItems.unitPrice,
          amount: documentLineItems.amount,
          systemConfidence: documentLineItems.systemConfidence,
          matchedProductId: documentLineItems.matchedProductId,
          diffItemId: documentDiffItems.diffItemId,
          classification: documentDiffItems.classification,
          diffReason: documentDiffItems.reason,
          diffVendorName: documentDiffItems.vendorName,
          diffInvoiceDate: documentDiffItems.invoiceDate,
          diffAfter: documentDiffItems.after,
          sourceProductId: productDocumentSources.productId,
        })
        .from(documentLineItems)
        .leftJoin(
          documentDiffItems,
          and(
            eq(documentDiffItems.lineItemId, documentLineItems.lineItemId),
            eq(documentDiffItems.parseRunId, documentLineItems.parseRunId),
          ),
        )
        .leftJoin(
          productDocumentSources,
          eq(productDocumentSources.lineItemId, documentLineItems.lineItemId),
        )
        .where(inArray(documentLineItems.parseRunId, runIds));
      report.lineCount = lineRows.length;

      const docOrder = new Map(docs.map((doc, index) => [doc.documentId, index]));
      const lines = lineRows
        .map((row) => ({ row, doc: docByRun.get(row.parseRunId)! }))
        .sort(
          (a, b) =>
            docOrder.get(a.doc.documentId)! - docOrder.get(b.doc.documentId)! ||
            a.row.lineNo - b.row.lineNo,
        );

      const findProductByKey = async (productKey: string): Promise<ProductInfo | null> => {
        const [row] = await tx
          .select({
            productId: productMaster.productId,
            productKey: productMaster.productKey,
            productMaker: productMaster.productMaker,
            reviewStatus: productMaster.reviewStatus,
          })
          .from(productMaster)
          .where(eq(productMaster.productKey, productKey))
          // 重複キーがある場合は、解析時と同じく統合済みでない最新の行を優先する。
          .orderBy(
            sql`(${productMaster.reviewStatus} = 'MERGED')`,
            desc(productMaster.lastUpdatedAt),
            productMaster.productId,
          )
          .limit(1);
        return row
          ? {
              productId: row.productId,
              productKey: row.productKey,
              productMaker: row.productMaker ?? null,
              reviewStatus: toReviewStatus(row.reviewStatus),
            }
          : null;
      };

      for (const { row, doc } of lines) {
        const ref: MigrationLineRef = {
          fileName: doc.fileName,
          pageNumber: doc.pageNumber ?? null,
          lineNo: row.lineNo,
          productName: row.productNameRaw ?? null,
          spec: row.specRaw ?? null,
        };

        if (row.sourceProductId) {
          report.alreadyMigratedLineCount += 1;
          continue;
        }
        if (row.classification === "UNMATCHED" && !row.matchedProductId) {
          report.unmatchedLines.push({ ...ref, reason: row.diffReason ?? null });
          continue;
        }
        if (row.matchedProductId || row.classification !== "NEW_CANDIDATE" || !row.diffItemId) {
          report.alreadyLinkedLineCount += 1;
          continue;
        }

        report.targetLineCount += 1;
        const skip = (reason: MigrationSkipReason) => report.skipped.push({ ...ref, reason });

        const productName = row.productNameRaw;
        const productKey = row.productKeyCandidate;
        if (!productName || !productKey) {
          skip("MISSING_NAME_OR_KEY");
          continue;
        }
        const after = (row.diffAfter ?? {}) as Record<string, unknown>;
        // 過去の明細にはメーカーが保存されていない。差分の after.productMaker を出典として補う。
        // 商品キーの文字列からメーカーを推測することはしない。
        const productMaker = row.productMaker ?? stringOrNull(after.productMaker);
        const spec = row.specRaw ?? null;
        if (makeProductKey(productName, spec, productMaker) !== productKey) {
          skip("KEY_INCONSISTENT");
          continue;
        }
        const confidence = safeParseFloat(row.systemConfidence);
        if (!canCreateProvisionalProduct(confidence)) {
          skip("LOW_CONFIDENCE");
          continue;
        }

        const vendorName = row.diffVendorName ?? doc.vendorName ?? null;
        const invoiceDate = row.diffInvoiceDate ?? doc.invoiceDate ?? null;
        const unitPrice = row.unitPrice ?? null;

        // 照合: 商品キーの完全一致。旧形式キー（メーカーなし）はメーカーが矛盾しない場合のみ。
        let product = await findProductByKey(productKey);
        if (!product) {
          const legacyKey = makeProductKey(productName, spec);
          if (legacyKey !== productKey) {
            const legacy = await findProductByKey(legacyKey);
            if (legacy && !makersConflict(productMaker, legacy.productMaker)) product = legacy;
          }
        }

        let created = false;
        if (!product) {
          const now = new Date();
          const [inserted] = await tx
            .insert(productMaster)
            .values({
              productId: crypto.randomUUID(),
              productKey,
              productMaker,
              productName,
              spec,
              category: null,
              qualityFlag: "OK",
              lastUpdatedAt: now,
              lastSourceType: "PDF",
              lastSourceId: row.parseRunId,
              reviewStatus: "PROVISIONAL",
            })
            .onConflictDoNothing()
            .returning({ productId: productMaster.productId });
          if (inserted) {
            created = true;
            product = {
              productId: inserted.productId,
              productKey,
              productMaker,
              reviewStatus: "PROVISIONAL",
            };
          } else {
            product = await findProductByKey(productKey);
          }
        }
        if (!product) {
          skip("MISSING_NAME_OR_KEY");
          continue;
        }
        if (product.reviewStatus === "MERGED") {
          skip("MATCHES_MERGED_PRODUCT");
          continue;
        }
        if (isAutoUpdatableStatus(product.reviewStatus)) {
          skip("EXISTING_PRODUCT_MATCH");
          continue;
        }

        // ここから先は未確認（仮登録・要確認）の商品への反映。
        const [existingPrice] = vendorName
          ? await tx
              .select({ unitPrice: vendorPrices.unitPrice })
              .from(vendorPrices)
              .where(
                and(
                  eq(vendorPrices.productId, product.productId),
                  eq(vendorPrices.vendorName, vendorName),
                ),
              )
              .limit(1)
          : [];
        const priceAction = decideUnverifiedPriceAction({
          existingUnitPrice: safeParseFloat(existingPrice?.unitPrice ?? null),
          newUnitPrice: safeParseFloat(unitPrice),
          vendorName,
        });

        const attentionReasons = collectAttentionReasons({
          unitPrice: safeParseFloat(unitPrice),
          quantity: safeParseFloat(row.quantity),
          amount: safeParseFloat(row.amount),
          vendorName,
          invoiceDate,
          spec,
        });
        if (priceAction === "CONFLICT") attentionReasons.push("登録済みの単価と相違");
        const attentionReason = formatAttentionReason(attentionReasons);

        let priceAdded = false;
        if (priceAction === "ADD" && vendorName && unitPrice) {
          const [insertedPrice] = await tx
            .insert(vendorPrices)
            .values({
              vendorPriceId: crypto.randomUUID(),
              productId: product.productId,
              vendorName,
              unitPrice,
              priceUpdatedOn: invoiceDate,
              sourceType: "PDF",
              sourceId: row.parseRunId,
              updatedAt: new Date(),
            })
            .onConflictDoNothing({ target: [vendorPrices.productId, vendorPrices.vendorName] })
            .returning({ vendorPriceId: vendorPrices.vendorPriceId });
          if (insertedPrice) {
            priceAdded = true;
            report.pricesAdded += 1;
            await tx
              .insert(updateHistory)
              .values({
                historyId: crypto.randomUUID(),
                // 解析時の仮登録と同じキー形式。再実行しても重複しない。
                updateKey: `${row.parseRunId}:${product.productId}:unit_price`,
                productId: product.productId,
                fieldName: "unit_price",
                vendorName,
                beforeValue: null,
                afterValue: unitPrice,
                sourceType: "PDF",
                sourceId: row.parseRunId,
                updatedAt: new Date(),
                updatedBy: "SYSTEM",
              })
              .onConflictDoNothing({ target: updateHistory.updateKey });
          }
        }
        if (priceAction === "CONFLICT") {
          report.priceConflicts.push({
            ...ref,
            vendorName,
            existingUnitPrice: existingPrice?.unitPrice ?? null,
            extractedUnitPrice: unitPrice,
          });
        }

        const candidates = created
          ? await findSimilarProducts(tx, {
              productId: product.productId,
              productName,
              productMaker,
              spec,
            })
          : [];

        await tx
          .insert(productDocumentSources)
          .values({
            lineItemId: row.lineItemId,
            productId: product.productId,
            linkedBy: MIGRATION_REVIEWER,
            linkMethod: created ? "PROVISIONAL_CREATE" : "EXACT_MATCH",
            attentionReason,
            matchCandidates: toMatchCandidateSnapshot(candidates),
          })
          .onConflictDoNothing({ target: productDocumentSources.lineItemId });

        if (created) {
          await tx.insert(productReviewHistory).values({
            productId: product.productId,
            action: "PROVISIONAL_CREATE",
            sourceLineItemId: row.lineItemId,
            beforeSnapshot: {},
            afterSnapshot: {
              productKey,
              productName,
              productMaker,
              spec,
              category: null,
              reviewStatus: "PROVISIONAL",
              vendorName,
              unitPrice,
              invoiceDate,
              systemConfidence: row.systemConfidence,
              documentId: doc.documentId,
              parseRunId: row.parseRunId,
              migrated: true,
            },
            note: attentionReason,
            reviewedBy: MIGRATION_REVIEWER,
          });
        }

        // 明細と差分を、解析時に仮登録した場合と同じ状態にする（要確認一覧から外れる）。
        await tx
          .update(documentLineItems)
          .set({
            matchedProductId: product.productId,
            ...(row.productMaker ? {} : { productMaker }),
          })
          .where(eq(documentLineItems.lineItemId, row.lineItemId));

        let classification = "NO_CHANGE";
        let reason = "LINKED_TO_UNVERIFIED_PRODUCT";
        if (created) {
          classification = "UPDATE";
          reason = "PROVISIONAL_PRODUCT_CREATED";
        } else if (priceAction === "CONFLICT") {
          classification = "BLOCKED";
          reason = "UNVERIFIED_PRODUCT_PRICE_CONFLICT";
        } else if (priceAdded) {
          classification = "UPDATE";
          reason = "UNVERIFIED_PRODUCT_PRICE_ADDED";
        }
        await tx
          .update(documentDiffItems)
          .set({
            classification,
            reason,
            after: { ...after, productId: product.productId },
          })
          .where(eq(documentDiffItems.diffItemId, row.diffItemId));

        if (created) {
          report.createdProducts.push({
            ...ref,
            productKey,
            productMaker,
            vendorName,
            unitPrice,
            attentionReason,
            candidateCount: candidates.length,
          });
        } else {
          report.linkedLines.push({ ...ref, productKey });
        }
      }

      if (
        !options.dryRun &&
        options.expectCreated != null &&
        options.expectCreated !== report.createdProducts.length
      ) {
        report.abortReason = `作成される商品数（${report.createdProducts.length}）が、指定された件数（${options.expectCreated}）と一致しません。ドライランをやり直して内容を確認してください。`;
        throw new RollbackMigration();
      }
      if (options.dryRun) throw new RollbackMigration();
      report.committed = true;
    });
  } catch (error) {
    if (!(error instanceof RollbackMigration)) throw error;
  }

  return report;
}

function lineLabel(line: MigrationLineRef): string {
  const page = line.pageNumber != null ? `・${line.pageNumber}ページ目` : "";
  return `${line.fileName}${page} 明細${line.lineNo}: ${line.productName ?? "(品名なし)"}${
    line.spec ? ` / ${line.spec}` : ""
  }`;
}

/** 人が読むための結果表示。 */
export function formatMigrationReport(report: MigrationReport): string {
  const out: string[] = [];
  out.push(
    report.dryRun
      ? "=== ドライラン（変更はすべて取り消し済み。DBは変わっていません） ==="
      : report.committed
        ? "=== 実行結果（コミット済み） ==="
        : "=== 実行中止（変更はすべて取り消し済み。DBは変わっていません） ===",
  );
  if (report.abortReason) out.push(`中止理由: ${report.abortReason}`);
  out.push(`取込グループ: ${report.uploadGroupIds.join(", ")}`);
  out.push(`書類（ページ）: ${report.documentCount} / 明細: ${report.lineCount}`);
  out.push(`  対象（新規商品候補）      : ${report.targetLineCount} 明細`);
  out.push(`  作成する仮登録商品        : ${report.createdProducts.length} 商品`);
  out.push(`  同じ商品への出典追加      : ${report.linkedLines.length} 明細`);
  out.push(`  追加する仕入先単価        : ${report.pricesAdded} 件`);
  out.push(`  単価の相違（上書きしない）: ${report.priceConflicts.length} 明細`);
  out.push(`  スキップ                  : ${report.skipped.length} 明細`);
  out.push(`  未照合（商品化しない）    : ${report.unmatchedLines.length} 明細`);
  out.push(`  紐付け済み（変更しない）  : ${report.alreadyLinkedLineCount} 明細`);
  out.push(`  移行済み（変更しない）    : ${report.alreadyMigratedLineCount} 明細`);

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    out.push("", `--- ${title} ---`, ...rows);
  };
  section(
    "成功した解析がない書類（対象外）",
    report.documentsWithoutSuccessfulParse.map(
      (doc) => `${doc.fileName}${doc.pageNumber != null ? `・${doc.pageNumber}ページ目` : ""}`,
    ),
  );
  section(
    "作成する仮登録商品",
    report.createdProducts.map(
      (line) =>
        `${lineLabel(line)} | メーカー: ${line.productMaker ?? "なし"} | ${
          line.vendorName ?? "仕入先不明"
        } ${line.unitPrice ?? "単価なし"}${
          line.attentionReason ? ` | 注意: ${line.attentionReason}` : ""
        }${line.candidateCount ? ` | 類似候補 ${line.candidateCount}件` : ""}`,
    ),
  );
  section("同じ商品への出典追加（重複の集約）", report.linkedLines.map(lineLabel));
  section(
    "単価の相違（登録済みの単価は変更しない）",
    report.priceConflicts.map(
      (line) =>
        `${lineLabel(line)} | ${line.vendorName ?? "仕入先不明"}: 登録済み ${
          line.existingUnitPrice ?? "-"
        } / 抽出 ${line.extractedUnitPrice ?? "-"}`,
    ),
  );
  section(
    "スキップ",
    report.skipped.map((line) => `${lineLabel(line)} | ${MIGRATION_SKIP_LABELS[line.reason]}`),
  );
  section(
    "未照合（別集計。商品化しない）",
    report.unmatchedLines.map((line) => `${lineLabel(line)} | ${line.reason ?? "-"}`),
  );
  return out.join("\n");
}
