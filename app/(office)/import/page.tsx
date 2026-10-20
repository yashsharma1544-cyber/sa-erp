import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ImportClient, type CustomerOption, type PartyRow } from "./import-client";

// PostgREST returns at most 1,000 rows per request; read in pages.
async function readAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return rows;
  }
}

export default async function ImportPage() {
  await requirePermission("masters.manage");
  const supabase = await createClient();

  const [parties, customers, accounts, { data: firms }] = await Promise.all([
    readAll<PartyRow>((a, b) =>
      supabase
        .from("import_parties")
        .select(
          "id, firm_id, ledger_name, tally_group, phone, erp_beat, flag, closing_balance, last_sale, sales_count, status, match_method, customer_id, suggested_customer_id, suggestion_score, decided_at",
        )
        .is("deleted_at", null)
        .order("ledger_name")
        .range(a, b),
    ),
    readAll<{ id: string; name: string; beat: { name: string } | null }>((a, b) =>
      supabase.from("customers").select("id, name, beat:beats(name)").is("deleted_at", null).order("name").range(a, b),
    ),
    readAll<{ customer_id: string; firm_id: string }>((a, b) =>
      supabase.from("customer_firm_accounts").select("customer_id, firm_id").is("deleted_at", null).order("id").range(a, b),
    ),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);

  const firmsOf = new Map<string, string[]>();
  for (const a of accounts) firmsOf.set(a.customer_id, [...(firmsOf.get(a.customer_id) ?? []), a.firm_id]);
  const options: CustomerOption[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    beat: c.beat?.name ?? null,
    firmIds: firmsOf.get(c.id) ?? [],
  }));

  return <ImportClient parties={parties} customers={options} firms={firms ?? []} />;
}
