"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { optionalDecimal, optionalText, requiredDecimal } from "@/lib/validators";

const Item = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Item name is too short").max(120),
  brandId: z.string().uuid().nullable(),
  skuGroupId: z.string().uuid().nullable(),
  category: z.enum(["tea", "oil", "other"]),
  unit: z.string().trim().min(1).max(12),
  unitsPerCase: optionalDecimal("Units per case"),
  packSizeG: optionalDecimal("Pack size"),
  kgPerUnit: requiredDecimal("Kg per unit"),
  hsn: optionalText(12),
  gstRate: requiredDecimal("GST rate", 2),
  mrp: optionalDecimal("MRP", 2),
  shelfLifeDays: z
    .string()
    .trim()
    .regex(/^(\d{1,4})?$/, "Shelf life must be whole days")
    .transform((s) => (s === "" ? null : Number(s))),
  active: z.boolean(),
});

export type ItemInput = z.input<typeof Item>;

export async function saveItem(input: ItemInput): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Item.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const row = {
    name: v.name,
    brand_id: v.brandId,
    sku_group_id: v.skuGroupId,
    category: v.category,
    unit: v.unit,
    units_per_case: v.unitsPerCase,
    pack_size_g: v.packSizeG,
    kg_per_unit: v.kgPerUnit,
    hsn: v.hsn,
    gst_rate: v.gstRate,
    mrp: v.mrp,
    shelf_life_days: v.shelfLifeDays,
    active: v.active,
  };
  const supabase = await createClient();
  const { error } = v.id ? await supabase.from("items").update(row).eq("id", v.id) : await supabase.from("items").insert(row);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/items");
  return { ok: v.id ? "Item updated" : "Item added" };
}

const Brand = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(80),
  category: z.enum(["tea", "oil", "other"]),
  active: z.boolean(),
});
export type BrandInput = z.input<typeof Brand>;

export async function saveBrand(input: BrandInput): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Brand.safeParse(input);
  if (!parsed.success) return { error: "Brand name is too short" };
  const v = parsed.data;
  const supabase = await createClient();
  const row = { name: v.name, category: v.category, active: v.active };
  const { error } = v.id ? await supabase.from("brands").update(row).eq("id", v.id) : await supabase.from("brands").insert(row);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/items");
  return { ok: v.id ? "Brand updated" : "Brand added" };
}

/** Move an item to another SKU group (or none). Group membership drives schemes and targets. */
export async function setItemGroup(itemId: string, skuGroupId: string | null): Promise<ActionResult> {
  await requirePermission("masters.manage");
  if (!z.string().uuid().safeParse(itemId).success) return { error: "Invalid item" };
  const supabase = await createClient();
  const { error } = await supabase.from("items").update({ sku_group_id: skuGroupId }).eq("id", itemId);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/items");
  return { ok: "Group updated" };
}
