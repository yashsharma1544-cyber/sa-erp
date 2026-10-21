import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { CashClient, type CollectorRow, type DepositRow, type HandoverRow, type PoolReceipt } from "./cash-client";

export default async function CashPage() {
  const me = await requireUser();
  if (!can(me, "handover.count") && !can(me, "deposit.record")) redirect("/no-access");
  const supabase = await createClient();
  const monthStart = todayIST().slice(0, 8) + "01";

  const [{ data: position }, { data: handovers }, { data: pool }, { data: deposits }, { data: banks }, { data: firms }] =
    await Promise.all([
      supabase.rpc("cash_position", { p_from: monthStart }),
      supabase
        .from("cash_handovers")
        .select(
          "id, handover_no, collector_id, handed_at, expected_cash, declared, declared_total, counted, counted_total, variance, status, note, counted_at, collector:app_users!cash_handovers_collector_id_fkey(full_name), counter:app_users!cash_handovers_counted_by_fkey(full_name), items:cash_handover_receipts(deleted_at, receipt:receipts(id, receipt_no, amount, collected_on, firm_id, customer:customers(name)))",
        )
        .is("deleted_at", null)
        .neq("status", "cancelled")
        .order("handed_at", { ascending: false })
        .limit(150),
      supabase
        .from("receipts")
        .select("id, receipt_no, amount, collected_on, firm_id, collector:app_users!receipts_collected_by_fkey(full_name), customer:customers(name)")
        .eq("mode", "cash")
        .eq("status", "counted")
        .is("deleted_at", null)
        .order("collected_on"),
      supabase
        .from("deposits")
        .select("id, firm_id, deposited_on, slip_no, amount, expected_amount, variance, note, bank:bank_accounts(bank, account_last4), by:app_users!deposits_recorded_by_fkey(full_name)")
        .is("deleted_at", null)
        .order("deposited_on", { ascending: false })
        .limit(60),
      supabase.from("bank_accounts").select("id, firm_id, bank, branch, account_last4").eq("active", true).is("deleted_at", null).order("bank"),
      supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
    ]);

  return (
    <CashClient
      collectors={(position ?? []) as CollectorRow[]}
      handovers={(handovers ?? []) as unknown as HandoverRow[]}
      pool={(pool ?? []) as unknown as PoolReceipt[]}
      deposits={(deposits ?? []) as unknown as DepositRow[]}
      banks={banks ?? []}
      firms={firms ?? []}
      canCount={can(me, "handover.count")}
      canDeposit={can(me, "deposit.record")}
      today={todayIST()}
    />
  );
}
