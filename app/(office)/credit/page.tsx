import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import { CreditClient, type TermsRow } from "./credit-client";

export default async function CreditPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  await requirePermission("credit.manage");
  const { firm: firmCode } = await searchParams;
  const supabase = await createClient();
  const [{ data: firmRows }, { data: grace }] = await Promise.all([
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
    supabase.from("app_settings").select("value").eq("key", "credit_grace_days").maybeSingle(),
  ]);
  const firms = firmRows ?? [];
  const firm = firms.find((f) => f.code === firmCode?.toUpperCase()) ?? firms[0];
  if (!firm) return <p className="text-sm text-slate-500">No firm is assigned to you.</p>;

  const rows = await readAll<TermsRow>((a, b) =>
    supabase
      .rpc("credit_terms_list", { p_firm_id: firm.id })
      .select("customer_id, customer_name, status, customer_type, beat_name, territory_name, has_account, credit_limit, credit_days, outstanding, oldest_bill_date, sales_90d")
      .order("customer_name")
      .order("customer_id")
      .range(a, b),
  );

  return <CreditClient firms={firms} firm={firm} rows={rows} graceDays={Number(grace?.value ?? 0)} />;
}
