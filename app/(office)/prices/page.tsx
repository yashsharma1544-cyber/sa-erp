import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PricesClient, type PriceRow } from "./prices-client";

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ firm?: string }> }) {
  const me = await requireUser();
  const { firm: firmCode } = await searchParams;
  const supabase = await createClient();
  const { data: firmRows } = await supabase.from("firms").select("id, code, name, gst_registered").is("deleted_at", null).order("code");
  const firms = firmRows ?? [];
  const firm = firms.find((f) => f.code === firmCode?.toUpperCase()) ?? firms[0];
  if (!firm) return <p className="text-sm text-slate-500">No firm is assigned to you.</p>;

  const [{ data: items }, { data: prices }] = await Promise.all([
    supabase.from("items").select("id, name, category, unit, kg_per_unit, gst_rate, active, brand:brands(name)").is("deleted_at", null).order("name"),
    supabase.from("v_current_prices").select("item_id, rate, effective_from, source").eq("firm_id", firm.id),
  ]);
  const byItem = new Map((prices ?? []).map((p) => [p.item_id as string, p]));
  type I = { id: string; name: string; category: string; unit: string; kg_per_unit: string; gst_rate: string; active: boolean; brand: { name: string } | null };
  const rows: PriceRow[] = ((items ?? []) as unknown as I[]).map((i) => {
    const p = byItem.get(i.id);
    return {
      item_id: i.id,
      name: i.name,
      brand: i.brand?.name ?? null,
      category: i.category,
      unit: i.unit,
      kg_per_unit: Number(i.kg_per_unit),
      gst_rate: Number(i.gst_rate),
      active: i.active,
      rate: p ? String(p.rate) : null,
      effective_from: p?.effective_from ?? null,
      source: (p?.source as PriceRow["source"]) ?? null,
    };
  });
  return <PricesClient firms={firms} firm={firm} rows={rows} canEdit={can(me, "price.manage")} />;
}
