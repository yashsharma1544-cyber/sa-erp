"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const Delegation = z
  .object({
    userId: z.string().uuid(),
    permissionKey: z.string().min(3),
    maxAmount: z
      .string()
      .trim()
      .regex(/^(\d{1,12}(\.\d{1,2})?)?$/, "Limit must be a rupee amount, e.g. 50000"),
    validFrom: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
    validTo: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
    note: z.string().trim().max(200),
  })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, { message: "'To' date is before 'From'" });

export type DelegationInput = z.input<typeof Delegation>;

export async function addDelegation(input: DelegationInput): Promise<{ error?: string }> {
  await requireRole("owner");
  const parsed = Delegation.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("approval_delegations").insert({
    delegate_user_id: v.userId,
    permission_key: v.permissionKey,
    max_amount: v.maxAmount || null, // string → numeric, no float
    valid_from: v.validFrom || null,
    valid_to: v.validTo || null,
    note: v.note || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/approval-limits");
  return {};
}

export async function endDelegation(id: string): Promise<{ error?: string }> {
  await requireRole("owner");
  const supabase = await createClient();
  const { error } = await supabase.from("approval_delegations").update({ active: false }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/approval-limits");
  return {};
}
