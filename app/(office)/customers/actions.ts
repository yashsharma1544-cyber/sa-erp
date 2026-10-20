"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireRole, requireUser, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { optionalGstin, optionalMobile, optionalText, requiredDecimal } from "@/lib/validators";

const CUSTOMER_TYPES = ["kirana", "retailer", "wholesaler", "hotel", "counter", "other"] as const;

const Customer = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2, "Customer name is too short").max(120),
  displayNameMr: optionalText(120),
  customerType: z.enum(CUSTOMER_TYPES),
  beatId: z.string().uuid().nullable(),
  whatsapp: optionalMobile,
  phone: optionalMobile,
  gstin: optionalGstin,
  address: optionalText(300),
  town: optionalText(80),
});

export type CustomerInput = z.input<typeof Customer>;

export async function saveCustomer(input: CustomerInput): Promise<ActionResult & { id?: string }> {
  await requirePermission("masters.manage");
  const parsed = Customer.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const row = {
    name: v.name,
    display_name_mr: v.displayNameMr,
    customer_type: v.customerType,
    beat_id: v.beatId,
    whatsapp: v.whatsapp,
    phone: v.phone,
    gstin: v.gstin,
    address: v.address,
    town: v.town,
  };
  const supabase = await createClient();
  if (v.id) {
    const { error } = await supabase.from("customers").update(row).eq("id", v.id);
    if (error) return { error: friendlyError(error) };
    revalidatePath(`/customers/${v.id}`);
    revalidatePath("/customers");
    return { ok: "Customer updated", id: v.id };
  }
  const { data, error } = await supabase.from("customers").insert(row).select("id").single();
  if (error || !data) return { error: friendlyError(error) ?? "Could not save" };
  revalidatePath("/customers");
  return { ok: "Customer added", id: data.id };
}

const FirmAccount = z.object({
  id: z.string().uuid().optional(),
  customerId: z.string().uuid(),
  firmId: z.string().uuid(),
  tallyLedgerName: optionalText(160),
  creditLimit: requiredDecimal("Credit limit", 2),
  creditDays: z.string().trim().regex(/^\d{1,3}$/, "Credit days must be a whole number"),
  active: z.boolean(),
});

export type FirmAccountInput = z.input<typeof FirmAccount>;

export async function saveFirmAccount(input: FirmAccountInput): Promise<ActionResult> {
  const me = await requireUser();
  if (!can(me, "masters.manage") && !can(me, "credit.manage")) return { error: "You are not allowed to do this." };
  const parsed = FirmAccount.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const supabase = await createClient();
  const row: Record<string, unknown> = { tally_ledger_name: v.tallyLedgerName, active: v.active };
  // Only send credit terms when the user may change them; the database enforces this too.
  if (can(me, "credit.manage")) {
    row.credit_limit = v.creditLimit;
    row.credit_days = Number(v.creditDays);
  }
  const { error } = v.id
    ? await supabase.from("customer_firm_accounts").update(row).eq("id", v.id)
    : await supabase.from("customer_firm_accounts").insert({ ...row, customer_id: v.customerId, firm_id: v.firmId });
  if (error) return { error: error.code === "23505" ? "That Tally ledger is already linked to another customer in this firm." : friendlyError(error) };
  revalidatePath(`/customers/${v.customerId}`);
  revalidatePath("/customers");
  return { ok: "Firm account saved" };
}

export async function setCustomerStatus(
  customerId: string,
  status: "active" | "bad_debt" | "ignore",
  note: string,
): Promise<ActionResult> {
  await requireRole("owner");
  if (!z.string().uuid().safeParse(customerId).success) return { error: "Invalid customer" };
  if (status !== "active" && note.trim().length < 3) return { error: "Add a short note on why." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("customers")
    .update({ status, status_note: note.trim() || null })
    .eq("id", customerId);
  if (error) return { error: friendlyError(error) };
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/customers");
  return { ok: "Status updated" };
}
