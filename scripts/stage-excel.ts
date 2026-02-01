import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import xlsx from "xlsx";
import postgres from "postgres";

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function norm(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim();
}

function toText(v: unknown) {
  const s = norm(v);
  return s || null;
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const r = rows[i] ?? [];
    const hasName = r.some((c) => norm(c) === "品名");
    const hasSpec = r.some((c) => norm(c) === "規格");
    if (hasName && hasSpec) return i;
  }
  return -1;
}

type VendorGroup = { vendorName: string; dateCol: number; priceCol: number };

function detectVendorGroups(header: unknown[], sub: unknown[]): VendorGroup[] {
  const groups: VendorGroup[] = [];
  for (let col = 2; col < header.length; col++) {
    const vendor = norm(header[col]);
    const h2 = norm(sub[col]);
    const h2n = norm(sub[col + 1]);
    if (vendor && h2 === "最終更新日" && h2n === "仕切り") {
      groups.push({ vendorName: vendor, dateCol: col, priceCol: col + 1 });
      col++;
    }
  }
  return groups;
}

async function main() {
  const file = arg("--file");
  const importRunId = arg("--import-run-id");
  if (!file || !importRunId) {
    console.error('Usage: pnpm tsx scripts/stage-excel.ts -- --file ".\\材料仕切り表.xlsx" --import-run-id "<uuid>"');
    process.exit(1);
  }

  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL(_UNPOOLED) is required.");

  const filePath = path.resolve(process.cwd(), file);
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

  const wb = xlsx.readFile(filePath, { cellDates: true });
  const sql = postgres(url, { max: 1, prepare: false });

  try {
    await sql.begin(async (tx) => {
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];

        // 1) 原本行をそのまま投入
        for (let i = 0; i < rows.length; i++) {
          await tx`
            insert into stg_excel_rows (import_run_id, sheet_name, row_index, row_json)
            values (${importRunId}::uuid, ${sheetName}, ${i}, ${tx.json(rows[i])})
            on conflict (import_run_id, sheet_name, row_index) do nothing
          `;
        }

        // 2) 業者別パターンだけ抽出して行形式ステージへ展開（見つからなくてもOK）
        const headerRow = findHeaderRow(rows);
        if (headerRow < 0) continue;

        const header = rows[headerRow] ?? [];
        const sub = rows[headerRow + 1] ?? [];
        const groups = detectVendorGroups(header, sub);
        if (groups.length === 0) continue;

        for (let r = headerRow + 2; r < rows.length; r++) {
          const row = rows[r] ?? [];
          const name = toText(row[0]);
          const spec = toText(row[1]);
          if (!name) continue;

          for (const g of groups) {
            const unitPrice = toText(row[g.priceCol]);
            if (!unitPrice) continue;

            await tx`
              insert into stg_vendor_price_rows (
                import_run_id, sheet_name,
                product_name_raw, spec_raw, vendor_name_raw,
                price_updated_on_raw, unit_price_raw,
                source_row_index
              ) values (
                ${importRunId}::uuid, ${sheetName},
                ${name}, ${spec},
                ${g.vendorName},
                ${toText(row[g.dateCol])},
                ${unitPrice},
                ${r}
              )
            `;
          }
        }
      }

      // statsは後で更新してもOK。まずはRUNNINGのままでもよい
    });

    console.log("staging ok", { importRunId, sheets: wb.SheetNames.length });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
