import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomerDetail, type Account, type Customer } from "./customer-detail";

type Props = { params: Promise<{ id: string }> };

export default async function CustomerPage({ params }: Props) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const me = await requireUser();
  const supabase = await createClient();

  const [{ data: customer }, { data: accounts }, { data: beats }, { data: firms }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, display_name_mr, customer_type, beat_id, whatsapp, wa_opt_out, phone, gstin, address, town, status, status_note, created_at")
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("customer_firm_accounts")
      .select("id, firm_id, tally_ledger_name, credit_limit, credit_days, active")
      .eq("customer_id", id)
      .is("deleted_at", null),
    supabase.from("v_beats").select("id, name, territory_name").order("name"),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);
  if (!customer) notFound();

  return (
    <CustomerDetail
      customer={customer as Customer}
      accounts={(accounts ?? []) as Account[]}
      beats={beats ?? []}
      firms={firms ?? []}
      canEdit={can(me, "masters.manage")}
      canCredit={can(me, "credit.manage")}
      isOwner={me.roles.includes("owner")}
    />
  );
}
