"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const Terms = z
  .object({
    firmId: z.string().uuid(),
    customerIds: z.array(z.string().uuid()).min(1, "Pick at least one customer").max(2000, "Pick at most 2,000 at a time"),
    creditLimit: z
      .string()
      .trim()
      .regex(/^(\d{1,12}(\.\d{1,2})?)?$/, "Credit limit must be a rupee amount")
      .transform((s) => (s === "" ? null : s)),
    creditDays: z
      .string()
      .trim()
      .regex(/^\d{0,3}$/, "Credit days must be a whole number")
      .transform((s) => (s === "" ? null : Number(s)))
      .refine((d) => d === null || d <= 365, "Credit days must be 365 or less"),
  })
  .refine((v) => v.creditLimit !== null || v.creditDays !== null, "Enter a credit limit, credit days or both");

/** Same credit limit and/or days for many customers in one firm. Blank leaves that value as it is. */
export async function setCreditTerms(input: z.input<typeof Terms>): Promise<ActionResult> {
  await requirePermission("credit.manage");
  const parsed = Terms.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_credit_terms", {
    p_firm_id: v.firmId,
    p_customer_ids: v.customerIds,
    p_credit_limit: v.creditLimit,
    p_credit_days: v.creditDays,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/credit");
  revalidatePath("/receivables");
  return { ok: `Credit terms updated for ${Number(data ?? 0)} customer(s)` };
}

export type CreditCheck = {
  ok: boolean;
  skipped: boolean;
  reasons: { code: string; text: string }[];
  terms_set?: boolean;
  outstanding?: number;
  tally_outstanding?: number;
  unposted_receipts?: number;
  credit_limit?: number;
  available?: number | null;
  credit_days?: number;
  grace_days?: number;
  oldest_bill_date?: string | null;
  oldest_bill_no?: string | null;
  oldest_days?: number | null;
  oldest_is_older_than_records?: boolean;
  note?: string;
};

export async function checkCredit(firmId: string, customerId: string, amount: string): Promise<{ error?: string; result?: CreditCheck }> {
  if (!z.string().uuid().safeParse(firmId).success || !z.string().uuid().safeParse(customerId).success) return { error: "Unknown customer" };
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount.trim())) return { error: "Enter the order amount" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("credit_check", { p_firm_id: firmId, p_customer_id: customerId, p_order_amount: amount.trim() });
  if (error) return { error: friendlyError(error) };
  return { result: data as CreditCheck };
}
