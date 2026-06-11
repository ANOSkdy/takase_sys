"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import styles from "../sheets.module.css";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const duplicateCategoryMessage =
  "同じシート名が既に存在します。既存シートの商品追加から登録してください。";

type NewSheetFormState = {
  category: string;
  productName: string;
  productMaker: string;
  spec: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string;
};

type NewSheetFormErrors = Partial<Record<keyof NewSheetFormState | "form", string>>;

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

type ValidatedNewSheet = {
  category: string;
  productName: string;
  productMaker: string | null;
  spec: string | null;
  vendorName: string;
  unitPrice: number | null;
  priceUpdatedOn: string | null;
  hasVendorPrice: boolean;
};

const initialForm: NewSheetFormState = {
  category: "",
  productName: "",
  productMaker: "",
  spec: "",
  vendorName: "",
  unitPrice: "",
  priceUpdatedOn: "",
};

function getCreateSheetErrorMessage(status: number, problem: ApiErrorResponse | null) {
  if (status === 400) return "入力内容を確認してください。";
  if (status === 409 && problem?.error?.code === "PRODUCT_ALREADY_EXISTS") {
    return "同じ品名・規格の商品が既に存在します。";
  }
  return "登録に失敗しました。時間をおいて再度お試しください。";
}

function validateNewSheetForm(
  form: NewSheetFormState,
  existingCategorySet: Set<string>,
): { errors: NewSheetFormErrors; values: ValidatedNewSheet } {
  const errors: NewSheetFormErrors = {};
  const category = form.category.trim();
  const productName = form.productName.trim();
  const productMaker = form.productMaker.trim();
  const spec = form.spec.trim();
  const vendorName = form.vendorName.trim();
  const unitPriceText = form.unitPrice.trim();
  const priceUpdatedOn = form.priceUpdatedOn.trim();

  if (!category) errors.category = "シート名を入力してください。";
  if (category.length > 200) errors.category = "シート名は200文字以内で入力してください。";
  if (category && existingCategorySet.has(category)) errors.category = duplicateCategoryMessage;
  if (!productName) errors.productName = "品名を入力してください。";
  if (productName.length > 300) errors.productName = "品名は300文字以内で入力してください。";
  if (productMaker.length > 200) errors.productMaker = "メーカーは200文字以内で入力してください。";
  if (spec.length > 300) errors.spec = "規格は300文字以内で入力してください。";
  if (vendorName.length > 200) errors.vendorName = "業者名は200文字以内で入力してください。";

  if (vendorName && !unitPriceText) {
    errors.unitPrice = "業者名を入力した場合は仕切りも入力してください。";
  }
  if (unitPriceText && !vendorName) {
    errors.vendorName = "仕切りを入力した場合は業者名も入力してください。";
  }
  if (priceUpdatedOn && (!vendorName || !unitPriceText)) {
    errors.priceUpdatedOn = "最終更新日を登録する場合は業者名と仕切りも入力してください。";
  }
  if (unitPriceText) {
    const unitPrice = Number(unitPriceText);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999999) {
      errors.unitPrice = "仕切りは0以上999999999以下の数値で入力してください。";
    }
  }
  if (priceUpdatedOn && !dateRegex.test(priceUpdatedOn)) {
    errors.priceUpdatedOn = "最終更新日はYYYY-MM-DD形式で入力してください。";
  }

  return {
    errors,
    values: {
      category,
      productName,
      productMaker: productMaker || null,
      spec: spec || null,
      vendorName,
      unitPrice: unitPriceText ? Number(unitPriceText) : null,
      priceUpdatedOn: priceUpdatedOn || null,
      hasVendorPrice: Boolean(vendorName && unitPriceText),
    },
  };
}

export default function NewSheetForm({ existingCategories }: { existingCategories: string[] }) {
  const router = useRouter();
  const existingCategorySet = useMemo(
    () => new Set(existingCategories.map((category) => category.trim())),
    [existingCategories],
  );
  const [form, setForm] = useState<NewSheetFormState>(initialForm);
  const [errors, setErrors] = useState<NewSheetFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  function updateField(field: keyof NewSheetFormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field] && !current.form) return current;
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  }

  async function submitNewSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const { errors: validationErrors, values } = validateNewSheetForm(form, existingCategorySet);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const body: {
      category: string;
      productName: string;
      productMaker: string | null;
      spec: string | null;
      vendorPrice?: {
        vendorName: string;
        unitPrice: number;
        priceUpdatedOn: string | null;
      };
    } = {
      category: values.category,
      productName: values.productName,
      productMaker: values.productMaker,
      spec: values.spec,
    };

    if (values.hasVendorPrice && values.unitPrice !== null) {
      body.vendorPrice = {
        vendorName: values.vendorName,
        unitPrice: values.unitPrice,
        priceUpdatedOn: values.priceUpdatedOn,
      };
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      const response = await fetch("/api/records/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setErrors({ form: getCreateSheetErrorMessage(response.status, problem) });
        return;
      }

      router.push(`/records/sheets/${encodeURIComponent(values.category)}`);
      router.refresh();
    } catch (error) {
      console.error("[records:sheets:new] sheet creation failed", error);
      setErrors({ form: "登録に失敗しました。時間をおいて再度お試しください。" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className={styles.sheetFormCard} onSubmit={submitNewSheet} noValidate>
      {errors.form && <p className={styles.errorMessage}>{errors.form}</p>}
      <section className={styles.formSection} aria-labelledby="sheet-section-title">
        <div className={styles.formSectionHeader}>
          <h2 id="sheet-section-title">新しいシート</h2>
          <p>シート名は商品カテゴリとして登録されます。既存シート名は利用できません。</p>
        </div>
        <label className={styles.formField}>
          <span>
            シート名 <strong aria-hidden="true">*</strong>
          </span>
          <input
            type="text"
            value={form.category}
            maxLength={200}
            required
            aria-invalid={Boolean(errors.category)}
            aria-describedby={errors.category ? "new-sheet-category-error" : undefined}
            onChange={(event) => updateField("category", event.target.value)}
          />
          {errors.category && (
            <small id="new-sheet-category-error" className={styles.fieldError}>
              {errors.category}
            </small>
          )}
        </label>
      </section>

      <section className={styles.formSection} aria-labelledby="first-product-section-title">
        <div className={styles.formSectionHeader}>
          <h2 id="first-product-section-title">最初の商品</h2>
          <p>空のシートは作成せず、1件目の商品を同時に登録します。</p>
        </div>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span>
              品名 <strong aria-hidden="true">*</strong>
            </span>
            <input
              type="text"
              value={form.productName}
              maxLength={300}
              required
              aria-invalid={Boolean(errors.productName)}
              aria-describedby={errors.productName ? "new-sheet-product-name-error" : undefined}
              onChange={(event) => updateField("productName", event.target.value)}
            />
            {errors.productName && (
              <small id="new-sheet-product-name-error" className={styles.fieldError}>
                {errors.productName}
              </small>
            )}
          </label>
          <label className={styles.formField}>
            <span>メーカー</span>
            <input
              type="text"
              value={form.productMaker}
              maxLength={200}
              aria-invalid={Boolean(errors.productMaker)}
              onChange={(event) => updateField("productMaker", event.target.value)}
            />
            {errors.productMaker && (
              <small className={styles.fieldError}>{errors.productMaker}</small>
            )}
          </label>
          <label className={styles.formField}>
            <span>規格</span>
            <input
              type="text"
              value={form.spec}
              maxLength={300}
              aria-invalid={Boolean(errors.spec)}
              onChange={(event) => updateField("spec", event.target.value)}
            />
            {errors.spec && <small className={styles.fieldError}>{errors.spec}</small>}
          </label>
        </div>
      </section>

      <fieldset className={styles.vendorFieldset}>
        <legend>初期業者価格（任意）</legend>
        <div className={styles.formGrid}>
          <label className={styles.formField}>
            <span>業者名</span>
            <input
              type="text"
              value={form.vendorName}
              maxLength={200}
              aria-invalid={Boolean(errors.vendorName)}
              onChange={(event) => updateField("vendorName", event.target.value)}
            />
            {errors.vendorName && <small className={styles.fieldError}>{errors.vendorName}</small>}
          </label>
          <label className={styles.formField}>
            <span>仕切り</span>
            <input
              type="number"
              min="0"
              max="999999999"
              step="0.01"
              inputMode="decimal"
              value={form.unitPrice}
              aria-invalid={Boolean(errors.unitPrice)}
              onChange={(event) => updateField("unitPrice", event.target.value)}
            />
            {errors.unitPrice && <small className={styles.fieldError}>{errors.unitPrice}</small>}
          </label>
          <label className={styles.formField}>
            <span>最終更新日</span>
            <input
              type="date"
              value={form.priceUpdatedOn}
              aria-invalid={Boolean(errors.priceUpdatedOn)}
              onChange={(event) => updateField("priceUpdatedOn", event.target.value)}
            />
            {errors.priceUpdatedOn && (
              <small className={styles.fieldError}>{errors.priceUpdatedOn}</small>
            )}
          </label>
        </div>
      </fieldset>

      <div className={styles.formActionsStatic}>
        <Link
          href="/records/sheets"
          className={styles.secondaryButton}
          aria-disabled={isSubmitting}
        >
          キャンセル
        </Link>
        <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
          {isSubmitting ? "登録中..." : "登録"}
        </button>
      </div>
    </form>
  );
}
