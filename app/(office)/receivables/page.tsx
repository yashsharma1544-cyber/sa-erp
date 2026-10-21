import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { loadArCustomers } from "./data";
import { ReceivablesClient, type Period } from "./receivables-client";
import type { Dso } from "./actions";

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  await requirePermission("reports.view_all");
  const { firm: firmCode } = await searchParams;
  const supabase = await createClient();
  const today = todayIST();

  const [{ data: firmRows }, { data: jc }, { data: sync }] = await Promise.all([
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
    supabase.from("v_journey_cycles").select("jc_label, start_date, end_date").lte("start_date", today).gte("end_date", today).maybeSingle(),
    supabase.rpc("tally_sync_status").maybeSingle(),
  ]);
  const firms = firmRows ?? [];
  const firm = firms.find((f) => f.code === firmCode?.toUpperCase()) ?? firms[0];
  if (!firm) return <p className="text-sm text-slate-500">No firm is assigned to you.</p>;

  const monthStart = today.slice(0, 8) + "01";
  const periods: Period[] = [
    ...(jc ? [{ key: "jc", label: jc.jc_label, from: jc.start_date, to: today }] : []),
    { key: "month", label: "This month", from: monthStart, to: today },
    { key: "90", label: "Last 90 days", from: shiftDays(today, -89), to: today },
  ];

  const first = periods[0]!;
  const [rows, { data: dso }] = await Promise.all([
    loadArCustomers(firm.id),
    supabase.rpc("ar_dso", { p_firm_id: firm.id, p_from: first.from, p_to: first.to }).maybeSingle(),
  ]);

  return (
    <ReceivablesClient
      firms={firms}
      firm={firm}
      rows={rows}
      periods={periods}
      initialDso={(dso as Dso | null) ?? null}
      lastSyncAt={(sync as { last_ok_at: string | null } | null)?.last_ok_at ?? null}
      today={today}
    />
  );
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
