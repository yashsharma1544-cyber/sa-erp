import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { CustomersClient, type CustomerRow } from "./customers-client";

export default async function CustomersPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [customers, lastBills, { data: beats }, { data: firms }] = await Promise.all([
    readAll<Omit<CustomerRow, "last_sale_date" | "accounts"> & { accounts: (CustomerRow["accounts"][number] & { deleted_at: string | null })[] }>(
      (a, b) =>
        supabase
          .from("customers")
          .select("id, name, customer_type, beat_id, whatsapp, town, status, accounts:customer_firm_accounts(firm_id, credit_limit, credit_days, deleted_at)")
          .is("deleted_at", null)
          .order("name")
          .order("id")
          .range(a, b),
    ),
    // Last Tally bill per customer, to help decide beats.
    readAll<{ customer_id: string; last_sale_date: string | null }>((a, b) =>
      supabase
        .rpc("ar_customers")
        .not("customer_id", "is", null)
        .not("last_sale_date", "is", null)
        .select("customer_id, last_sale_date")
        .order("customer_id")
        .order("firm_id")
        .range(a, b),
    ),
    supabase.from("v_beats").select("id, name, territory_name").order("name"),
    supabase.from("firms").select("id, code").is("deleted_at", null).order("code"),
  ]);

  const lastSale = new Map<string, string>();
  for (const r of lastBills) {
    if (r.last_sale_date && (lastSale.get(r.customer_id) ?? "") < r.last_sale_date) lastSale.set(r.customer_id, r.last_sale_date);
  }
  const rows: CustomerRow[] = customers.map((c) => ({
    ...c,
    accounts: (c.accounts ?? []).filter((a) => !a.deleted_at),
    last_sale_date: lastSale.get(c.id) ?? null,
  }));

  return (
    <CustomersClient
      customers={rows}
      beats={beats ?? []}
      firms={firms ?? []}
      canEdit={can(me, "masters.manage")}
    />
  );
}
