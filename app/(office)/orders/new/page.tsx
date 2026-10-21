import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { NewOrderClient, type ItemOption } from "./new-order-client";

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ paste?: string }> }) {
  const { paste } = await searchParams;
  await requirePermission("order.create");
  const supabase = await createClient();
  const [{ data: firms }, { data: items }, { data: prices }, { data: aliases }, { data: popularity }] = await Promise.all([
    supabase.from("firms").select("id, code, name, gst_registered").is("deleted_at", null).order("code"),
    supabase.from("items").select("id, name, unit, kg_per_unit, gst_rate, category").is("deleted_at", null).eq("active", true).order("name"),
    supabase.from("v_current_prices").select("firm_id, item_id, rate"),
    supabase.from("item_aliases").select("item_id, alias_name").is("deleted_at", null).limit(5000),
    supabase.rpc("item_popularity"),
  ]);
  const aliasMap = new Map<string, string[]>();
  for (const a of aliases ?? []) aliasMap.set(a.item_id, [...(aliasMap.get(a.item_id) ?? []), a.alias_name]);
  const pop = new Map(((popularity ?? []) as { item_id: string; lines: number }[]).map((p) => [p.item_id, Number(p.lines)]));
  const rates: Record<string, Record<string, number>> = {};
  for (const p of prices ?? []) (rates[p.firm_id as string] ??= {})[p.item_id as string] = Number(p.rate);
  const options: ItemOption[] = (items ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    unit: i.unit,
    kgPerUnit: Number(i.kg_per_unit),
    gstRate: Number(i.gst_rate),
    category: i.category,
    aliases: aliasMap.get(i.id) ?? [],
    popularity: pop.get(i.id) ?? 0,
  }));
  return <NewOrderClient firms={firms ?? []} items={options} rates={rates} today={todayIST()} startWithPaste={paste === "1"} />;
}
