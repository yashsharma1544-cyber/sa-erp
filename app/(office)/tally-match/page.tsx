import { can, requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { todayIST } from "@/lib/format";
import { MatchClient, type MatchRow } from "./match-client";

export default async function TallyMatchPage() {
  const me = await requirePermission("reports.view_all");
  const supabase = await createClient();
  const since = new Date(Date.now() - 75 * 86_400_000).toISOString().slice(0, 10);
  const [rows, { data: firms }] = await Promise.all([
    readAll<MatchRow>((a, b) =>
      supabase
        .from("receipts")
        .select(
          "id, receipt_no, firm_id, amount, mode, status, collected_on, tally_voucher_id, customer:customers(name), collector:app_users!receipts_collected_by_fkey(full_name), match:receipt_tally_matches(method, deleted_at)",
        )
        .gte("collected_on", since)
        .neq("status", "cancelled")
        .is("deleted_at", null)
        .order("collected_on")
        .order("id")
        .range(a, b),
    ),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);
  return <MatchClient rows={rows} firms={firms ?? []} canMatch={can(me, "receipt.reallocate")} today={todayIST()} />;
}
