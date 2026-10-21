import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import type { CollectPayload, FieldBill, FieldCustomer, FieldReceipt } from "@/lib/field/types";

type ListRow = {
  customer_id: string; customer_name: string; whatsapp: string | null; phone: string | null; address: string | null;
  firm_id: string; firm_code: string; ledger_key: string; balance: string; overdue: string; b60_plus: string;
  oldest_bill_date: string | null; last_receipt_date: string | null; credit_days: number | null;
  erp_collected_since_snapshot: string; open_promise_date: string | null; open_promise_amount: string | null;
  visited_today: string | null;
};

// The collector's day list for one beat, with every open bill, so the phone
// can keep working without network.
export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const beat = z.string().uuid().safeParse(req.nextUrl.searchParams.get("beat"));
  if (!beat.success) return NextResponse.json({ error: "Choose a beat" }, { status: 400 });

  const supabase = await createClient();
  const { data: rows, error } = await supabase.rpc("field_collect_list", { p_beat_id: beat.data });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byId = new Map<string, FieldCustomer>();
  for (const r of (rows ?? []) as ListRow[]) {
    const c =
      byId.get(r.customer_id) ??
      { id: r.customer_id, name: r.customer_name, whatsapp: r.whatsapp, phone: r.phone, address: r.address,
        visited_today: r.visited_today, accounts: [], bills: {} };
    c.accounts.push({
      firm_id: r.firm_id, firm_code: r.firm_code, ledger_key: r.ledger_key, balance: Number(r.balance),
      overdue: Number(r.overdue), b60_plus: Number(r.b60_plus), oldest_bill_date: r.oldest_bill_date,
      last_receipt_date: r.last_receipt_date, credit_days: r.credit_days,
      erp_collected: Number(r.erp_collected_since_snapshot), promise_date: r.open_promise_date,
      promise_amount: r.open_promise_amount === null ? null : Number(r.open_promise_amount),
    });
    byId.set(r.customer_id, c);
  }

  const ids = [...byId.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: bills, error: billError } = await supabase
      .rpc("ar_bills", { p_customer_ids: ids.slice(i, i + 150) })
      .select("customer_id, firm_id, bill_key, bill_no, bill_date, kind, bill_amount, pending, days, overdue")
      .order("bill_date", { ascending: true, nullsFirst: true });
    if (billError) return NextResponse.json({ error: billError.message }, { status: 500 });
    for (const b of bills ?? []) {
      const c = byId.get(b.customer_id as string);
      if (!c) continue;
      const list = (c.bills[b.firm_id as string] ??= []);
      list.push({
        bill_key: b.bill_key, bill_no: b.bill_no, bill_date: b.bill_date, kind: b.kind,
        bill_amount: b.bill_amount === null ? null : Number(b.bill_amount), pending: Number(b.pending),
        days: b.days, overdue: b.overdue,
      } as FieldBill);
    }
  }

  const { data: mine } = await supabase
    .from("receipts")
    .select("receipt_no, amount, mode, customer_id, firm_id, collected_at")
    .eq("collected_by", me.appUserId)
    .eq("collected_on", todayIST())
    .is("deleted_at", null)
    .order("collected_at", { ascending: false });

  const payload: CollectPayload = {
    beatId: beat.data,
    fetchedAt: new Date().toISOString(),
    customers: [...byId.values()].sort((a, b) => sum(b, "overdue") - sum(a, "overdue") || sum(b, "balance") - sum(a, "balance")),
    myToday: ((mine ?? []) as FieldReceipt[]).map((r) => ({ ...r, amount: Number(r.amount) })),
  };
  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

function sum(c: FieldCustomer, key: "overdue" | "balance") {
  return c.accounts.reduce((s, a) => s + a[key], 0);
}
