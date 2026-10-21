import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { ChequesClient, type ChequeRow } from "./cheques-client";

export default async function ChequesPage() {
  const me = await requireUser();
  if (!can(me, "cheque.manage") && !can(me, "reports.view_all")) redirect("/no-access");
  const supabase = await createClient();
  const [{ data: cheques }, { data: banks }, { data: firms }] = await Promise.all([
    supabase
      .from("cheques")
      .select(
        "id, status, deposited_on, cleared_on, bounced_on, bounce_reason, note, bank:bank_accounts(bank, account_last4), receipt:receipts(id, receipt_no, firm_id, amount, collected_on, cheque_no, cheque_date, cheque_bank, cheque_photo_path, customer:customers(name), collector:app_users!receipts_collected_by_fkey(full_name)), bounce:cheque_bounces(id, charge_amount, charge_status, debit_note_ref)",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("bank_accounts").select("id, firm_id, bank, account_last4").eq("active", true).is("deleted_at", null).order("bank"),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);
  return (
    <ChequesClient
      cheques={(cheques ?? []) as unknown as ChequeRow[]}
      banks={banks ?? []}
      firms={firms ?? []}
      canManage={can(me, "cheque.manage")}
      isOwner={me.roles.includes("owner")}
      today={todayIST()}
    />
  );
}
