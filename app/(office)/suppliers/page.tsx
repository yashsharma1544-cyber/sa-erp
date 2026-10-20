import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SuppliersClient, type SupplierRow } from "./suppliers-client";

export default async function SuppliersPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: suppliers }, { data: firms }] = await Promise.all([
    supabase
      .from("suppliers")
      .select(
        "id, name, kind, whatsapp, phone, gstin, address, active, terms:supplier_firm_accounts(id, firm_id, tally_ledger_name, credit_days, cash_discount_pct, cash_discount_days, active, deleted_at)",
      )
      .is("deleted_at", null)
      .order("name"),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);
  const rows = (suppliers ?? []).map((s) => ({
    ...s,
    terms: (s.terms ?? []).filter((t: { deleted_at: string | null }) => !t.deleted_at),
  })) as SupplierRow[];
  return <SuppliersClient suppliers={rows} firms={firms ?? []} canEdit={can(me, "masters.manage")} />;
}
