"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { optionalGstin, optionalMobile, optionalText, requiredDecimal } from "@/lib/validators";

const Terms = z.object({
  id: z.string().uuid().optional(),
  firmId: z.string().uuid(),
  enabled: z.boolean(),
  tallyLedgerName: optionalText(160),
  creditDays: z.string().trim().regex(/^\d{1,3}$/, "Credit days must be a whole number"),
  cashDiscountPct: requiredDecimal("Cash discount %", 2),
  cashDiscountDays: z
    .string()
    .trim()
    .regex(/^(\d{1,3})?$/, "Discount days must be a whole number")
    .transform((s) => (s === "" ? null : Number(s))),
});

const Supplier = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Supplier name is too short").max(120),
  kind: z.enum(["tea", "oil", "other"]),
  whatsapp: optionalMobile,
  phone: optionalMobile,
  gstin: optionalGstin,
  address: optionalText(300),
  active: z.boolean(),
  terms: z.array(Terms),
});

export type SupplierInput = z.input<typeof Supplier>;

export async function saveSupplier(input: SupplierInput): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Supplier.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  for (const t of v.terms) {
    if (t.enabled && Number(t.cashDiscountPct) > 0 && t.cashDiscountDays === null) {
      return { error: "Give the number of days for the cash discount." };
    }
  }
  const supabase = await createClient();
  const row = { name: v.name, kind: v.kind, whatsapp: v.whatsapp, phone: v.phone, gstin: v.gstin, address: v.address, active: v.active };

  let supplierId = v.id;
  if (supplierId) {
    const { error } = await supabase.from("suppliers").update(row).eq("id", supplierId);
    if (error) return { error: friendlyError(error) };
  } else {
    const { data, error } = await supabase.from("suppliers").insert(row).select("id").single();
    if (error || !data) return { error: friendlyError(error) ?? "Could not save" };
    supplierId = data.id;
  }

  for (const t of v.terms) {
    const termsRow = {
      tally_ledger_name: t.tallyLedgerName,
      credit_days: Number(t.creditDays),
      cash_discount_pct: t.cashDiscountPct,
      cash_discount_days: Number(t.cashDiscountPct) > 0 ? t.cashDiscountDays : null,
      active: t.enabled,
    };
    if (t.id) {
      const { error } = await supabase.from("supplier_firm_accounts").update(termsRow).eq("id", t.id);
      if (error) return { error: friendlyError(error) };
    } else if (t.enabled) {
      const { error } = await supabase
        .from("supplier_firm_accounts")
        .insert({ ...termsRow, supplier_id: supplierId, firm_id: t.firmId });
      if (error) return { error: friendlyError(error) };
    }
  }

  revalidatePath("/suppliers");
  return { ok: v.id ? "Supplier updated" : "Supplier added" };
}
