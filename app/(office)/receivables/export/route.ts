import { NextResponse, type NextRequest } from "next/server";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { loadArBills, loadArCustomers, sectionOf, type Section } from "../data";

// CSV with a BOM so Excel opens it as UTF-8. Amounts are plain numbers so
// Excel can add them up.
export async function GET(req: NextRequest) {
  await requirePermission("reports.view_all");
  const p = req.nextUrl.searchParams;
  const supabase = await createClient();
  const { data: firm } = await supabase
    .from("firms")
    .select("id, code, name")
    .eq("code", (p.get("firm") ?? "SA").toUpperCase())
    .is("deleted_at", null)
    .maybeSingle();
  if (!firm) return NextResponse.json({ error: "Unknown firm" }, { status: 404 });

  const section = (["working", "parked", "advance"].includes(p.get("section") ?? "") ? p.get("section") : "working") as Section;
  const customers = (await loadArCustomers(firm.id)).filter((c) => sectionOf(c) === section);
  const label = (c: (typeof customers)[number]) => c.customer_name ?? c.ledger_name;

  let rows: (string | number | null)[][];
  if (p.get("kind") === "bills") {
    const wanted = new Map(customers.map((c) => [c.ledger_key, c]));
    const bills = (await loadArBills(firm.id)).filter((b) => wanted.has(b.ledger_key));
    rows = [
      ["Customer", "Tally ledger", "Beat", "Bill", "Bill date", "Days", "Bucket", "Overdue", "Bill amount", "Pending"],
      ...bills.map((b) => {
        const c = wanted.get(b.ledger_key)!;
        return [
          label(c), c.ledger_name, c.beat_name, b.kind === "older" ? "Older than records" : b.bill_no, b.bill_date, b.days,
          b.bucket, b.overdue ? "Yes" : "No", b.bill_amount, b.pending,
        ];
      }),
    ];
  } else {
    rows = [
      ["Customer", "Tally ledger", "Territory", "Beat", "Status", "Outstanding", "0-15", "16-30", "31-45", "46-60", "60+",
        "Overdue", "Credit days", "Oldest bill", "Last receipt", "Last sale", "WhatsApp"],
      ...customers.map((c) => [
        label(c), c.ledger_name, c.territory_name, c.beat_name, c.customer_id ? c.status : "not matched", c.balance,
        c.b0_15, c.b16_30, c.b31_45, c.b46_60, c.b60_plus, c.overdue, c.credit_days, c.oldest_bill_date,
        c.last_receipt_date, c.last_sale_date, c.whatsapp,
      ]),
    ];
  }

  const csv = "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const file = `receivables-${firm.code}-${p.get("kind") === "bills" ? "bills" : "customers"}-${section}-${todayIST()}.csv`;
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}

function cell(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Quote when needed; prefix formula-like text so Excel doesn't run it.
  const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? "'" + s : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
