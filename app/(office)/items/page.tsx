import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ItemsClient, type Brand, type ItemRow, type SkuGroup } from "./items-client";

export default async function ItemsPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: items }, { data: brands }, { data: groups }] = await Promise.all([
    supabase
      .from("items")
      .select("id, name, brand_id, sku_group_id, category, unit, units_per_case, pack_size_g, kg_per_unit, hsn, gst_rate, mrp, shelf_life_days, active")
      .is("deleted_at", null)
      .order("name"),
    supabase.from("brands").select("id, name, category, active").is("deleted_at", null).order("name"),
    supabase.from("sku_groups").select("id, code, name, description").is("deleted_at", null).order("code"),
  ]);
  return (
    <ItemsClient
      items={(items ?? []) as ItemRow[]}
      brands={(brands ?? []) as Brand[]}
      groups={(groups ?? []) as SkuGroup[]}
      canEdit={can(me, "masters.manage")}
    />
  );
}
