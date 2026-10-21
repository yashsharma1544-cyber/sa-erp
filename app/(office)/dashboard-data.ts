import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { loadArCustomers } from "./receivables/data";
import type { CollectionLine, CollectorRow, DueRow, Firm, PromiseRow } from "./dashboard-types";

export type DashboardData = {
  firms: Firm[];
  jc: { label: string; start: string; end: string } | null;
  lines: CollectionLine[];
  collectors: CollectorRow[];
  due: DueRow[];
  promises: PromiseRow[];
  lastSyncAt: string | null;
};

/** Everything the owner dashboard shows, for today and the running JC. */
export async function loadDashboard(today: string): Promise<DashboardData> {
  const supabase = await createClient();
  const [{ data: firmRows }, { data: jc }, { data: sync }] = await Promise.all([
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
    supabase.from("v_journey_cycles").select("jc_label, start_date, end_date").lte("start_date", today).gte("end_date", today).maybeSingle(),
    supabase.rpc("tally_sync_status").maybeSingle(),
  ]);
  const firms = (firmRows ?? []) as Firm[];
  const from = jc?.start_date ?? today;

  const [lines, { data: collectors }, ar, { data: promises }] = await Promise.all([
    readAll<CollectionLine>((a, b) =>
      supabase
        .rpc("collection_lines", { p_from: from, p_to: today })
        .select("*")
        .order("collected_on")
        .order("firm_id")
        .order("source")
        .order("customer_id")
        .order("ledger_key")
        .order("collector_id")
        .order("mode")
        .range(a, b),
    ),
    supabase.rpc("collector_board", { p_today: today, p_jc_start: from }),
    Promise.all(firms.map((f) => loadArCustomers(f.id))),
    supabase
      .from("promises")
      .select("id, firm_id, customer_id, amount, note, customer:customers(name, beat:beats(name)), made_to_user:app_users!promises_made_to_fkey(full_name)")
      .eq("promise_date", today)
      .eq("status", "open")
      .is("deleted_at", null)
      .order("amount", { ascending: false }),
  ]);

  const due: DueRow[] = ar
    .flat()
    .filter((r) => r.status === "active" && Number(r.balance) > 0)
    .map((r) => ({
      firm_id: r.firm_id,
      beat_id: r.beat_id,
      beat_name: r.beat_name,
      territory_name: r.territory_name,
      balance: Number(r.balance),
      overdue: Number(r.overdue),
      b60_plus: Number(r.b60_plus),
    }));

  type P = {
    id: string; firm_id: string; customer_id: string; amount: string; note: string | null;
    customer: { name: string; beat: { name: string } | null } | null;
    made_to_user: { full_name: string } | null;
  };
  return {
    firms,
    jc: jc ? { label: jc.jc_label, start: jc.start_date, end: jc.end_date } : null,
    lines,
    collectors: (collectors ?? []) as CollectorRow[],
    due,
    promises: ((promises ?? []) as unknown as P[]).map((p) => ({
      id: p.id,
      firm_id: p.firm_id,
      customer_id: p.customer_id,
      customer_name: p.customer?.name ?? "—",
      beat_name: p.customer?.beat?.name ?? null,
      amount: p.amount,
      made_to_name: p.made_to_user?.full_name ?? "—",
      note: p.note,
    })),
    lastSyncAt: (sync as { last_ok_at: string | null } | null)?.last_ok_at ?? null,
  };
}
