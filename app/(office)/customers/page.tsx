import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CustomersClient, type CustomerRow } from "./customers-client";

export default async function CustomersPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: customers }, { data: beats }, { data: firms }] = await Promise.all([
    supabase
      .from("customers")
      .select("id, name, customer_type, beat_id, whatsapp, town, status, accounts:customer_firm_accounts(firm_id, credit_limit, credit_days, deleted_at)")
      .is("deleted_at", null)
      .order("name")
      .limit(5000),
    supabase.from("v_beats").select("id, name, territory_name").order("name"),
    supabase.from("firms").select("id, code").is("deleted_at", null).order("code"),
  ]);

  const rows: CustomerRow[] = (customers ?? []).map((c) => ({
    ...c,
    accounts: (c.accounts ?? []).filter((a: { deleted_at: string | null }) => !a.deleted_at),
  })) as CustomerRow[];

  return (
    <CustomersClient
      customers={rows}
      beats={beats ?? []}
      firms={firms ?? []}
      canEdit={can(me, "masters.manage")}
    />
  );
}
