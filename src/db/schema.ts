import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// 1) product_master
export const productMaster = pgTable("product_master", {
  productId: uuid("product_id").primaryKey(),
  productKey: text("product_key").notNull(),
  productName: text("product_name").notNull(),
  spec: text("spec"),
  category: text("category"),
  defaultUnitPrice: numeric("default_unit_price", { precision: 12, scale: 2 }),
  qualityFlag: text("quality_flag").notNull(),
  lastUpdatedAt: timestamp("last_updated_at", { withTimezone: true }).notNull(),
  lastSourceType: text("last_source_type"),
  lastSourceId: text("last_source_id"),
});

// 2) vendor_prices
export const vendorPrices = pgTable("vendor_prices", {
  vendorPriceId: uuid("vendor_price_id").primaryKey(),
  productId: uuid("product_id").notNull(),
  vendorName: text("vendor_name").notNull(),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  priceUpdatedOn: date("price_updated_on"),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

// 3) documents
export const documents = pgTable("documents", {
  documentId: uuid("document_id").primaryKey().defaultRandom(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadGroupId: uuid("upload_group_id"),
  pageNumber: integer("page_number"),
  pageTotal: integer("page_total"),
  sourceFileHash: text("source_file_hash"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadNote: text("upload_note"),
  status: text("status").notNull().default("UPLOADED"),
  vendorName: text("vendor_name"),
  invoiceDate: date("invoice_date"),
  parseErrorSummary: text("parse_error_summary"),
  isDeleted: boolean("is_deleted").notNull().default(false),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedReason: text("deleted_reason"),
});

// 4) document_parse_runs
export const documentParseRuns = pgTable("document_parse_runs", {
  parseRunId: uuid("parse_run_id").primaryKey(),
  documentId: uuid("document_id").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull(),
  errorDetail: text("error_detail"),
});

// 5) document_line_items
export const documentLineItems = pgTable("document_line_items", {
  lineItemId: uuid("line_item_id").primaryKey(),
  parseRunId: uuid("parse_run_id").notNull(),
  lineNo: integer("line_no").notNull(),
  productNameRaw: text("product_name_raw"),
  specRaw: text("spec_raw"),
  productKeyCandidate: text("product_key_candidate"),
  quantity: numeric("quantity", { precision: 12, scale: 3 }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }),
  amount: numeric("amount", { precision: 12, scale: 2 }),
  modelConfidence: numeric("model_confidence", { precision: 4, scale: 3 }),
  systemConfidence: numeric("system_confidence", { precision: 4, scale: 3 }),
  matchedProductId: uuid("matched_product_id"),
});

// 6) document_diff_items
export const documentDiffItems = pgTable("document_diff_items", {
  diffItemId: uuid("diff_item_id").primaryKey(),
  parseRunId: uuid("parse_run_id").notNull(),
  lineItemId: uuid("line_item_id").notNull(),
  classification: text("classification").notNull(),
  reason: text("reason"),
  vendorName: text("vendor_name"),
  invoiceDate: date("invoice_date"),
  before: jsonb("before").$type<Record<string, unknown>>().notNull(),
  after: jsonb("after").$type<Record<string, unknown>>().notNull(),
});

// 7) update_history
export const updateHistory = pgTable("update_history", {
  historyId: uuid("history_id").primaryKey(),
  updateKey: text("update_key").notNull(),
  productId: uuid("product_id").notNull(),
  fieldName: text("field_name").notNull(),
  vendorName: text("vendor_name"),
  beforeValue: text("before_value"),
  afterValue: text("after_value"),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  updatedBy: text("updated_by"),
});

// 8) excel_import_runs
export const excelImportRuns = pgTable("excel_import_runs", {
  importRunId: uuid("import_run_id").primaryKey(),
  fileName: text("file_name").notNull(),
  fileHash: text("file_hash").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull(),
  errorDetail: text("error_detail"),
});
