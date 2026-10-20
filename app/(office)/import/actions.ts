"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const Decide = z.object({
  id: z.string().uuid(),
  action: z.enum(["link", "new", "skip", "non_customer", "undo"]),
  customerId: z.string().uuid().optional(),
});

const done: Record<z.infer<typeof Decide>["action"], string> = {
  link: "Linked to the customer",
  new: "New customer created",
  skip: "Skipped",
  non_customer: "Marked as not a customer",
  undo: "Undone — back to pending",
};

export async function decideParty(input: z.input<typeof Decide>): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Decide.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  if (v.action === "link" && !v.customerId) return { error: "Choose a customer to link." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_decide_party", {
    p_id: v.id,
    p_action: v.action,
    p_customer_id: v.customerId ?? null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/import");
  revalidatePath("/customers");
  return { ok: done[v.action] };
}

export async function createAllPending(firmId: string): Promise<ActionResult> {
  await requirePermission("masters.manage");
  if (!z.string().uuid().safeParse(firmId).success) return { error: "Unknown firm" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_create_all_pending", { p_firm_id: firmId });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/import");
  revalidatePath("/customers");
  return { ok: `${data ?? 0} new customers created` };
}
