"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const uuid = z.string().uuid();

const Order = z.object({
  clientOpId: uuid,
  firmId: uuid,
  customerId: uuid,
  source: z.enum(["office", "counter", "whatsapp_paste"]),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(500).optional(),
  lines: z
    .array(
      z.object({
        itemId: uuid,
        qty: z.string().trim().regex(/^\d{1,6}(\.\d{1,3})?$/, "Quantity must be a number with up to 3 decimals"),
        rate: z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, "Rate must be a number").optional(),
      }),
    )
    .min(1, "Add at least one item")
    .max(100, "At most 100 lines"),
});

export type OrderResult = ActionResult & { id?: string; orderNo?: string; orderStatus?: string };

export async function createOrder(input: z.input<typeof Order>): Promise<OrderResult> {
  await requirePermission("order.create");
  const parsed = Order.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  if (v.lines.some((l) => Number(l.qty) <= 0)) return { error: "Every quantity must be more than 0" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_order", {
    p: {
      client_op_id: v.clientOpId,
      firm_id: v.firmId,
      customer_id: v.customerId,
      source: v.source,
      order_date: v.orderDate,
      note: v.note || null,
      lines: v.lines.map((l) => ({ item_id: l.itemId, qty: l.qty, ...(l.rate ? { rate: l.rate } : {}) })),
    },
  });
  if (error) return { error: friendlyError(error) };
  const r = data as { id: string; order_no: string; order_status: string };
  revalidatePath("/orders");
  revalidatePath("/approvals");
  return {
    ok: r.order_status === "approved" ? `Order ${r.order_no} approved` : `Order ${r.order_no} is waiting for approval`,
    id: r.id,
    orderNo: r.order_no,
    orderStatus: r.order_status,
  };
}

export async function cancelOrder(id: string, reason: string): Promise<ActionResult> {
  await requirePermission("order.create");
  if (!uuid.safeParse(id).success) return { error: "Unknown order" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", { p_id: id, p_reason: reason });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/orders");
  revalidatePath(`/orders/${id}`);
  revalidatePath("/approvals");
  return { ok: "Order cancelled" };
}

export type CustomerHit = { id: string; name: string; beat: string | null; status: string; firmIds: string[] };

export async function searchCustomers(q: string): Promise<CustomerHit[]> {
  await requireUser();
  const term = q.trim().replace(/[%_,()]/g, " ");
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, status, beat:beats(name), accounts:customer_firm_accounts(firm_id, active, deleted_at)")
    .is("deleted_at", null)
    .neq("status", "ignore")
    .ilike("name", `%${term}%`)
    .order("name")
    .limit(20);
  type R = { id: string; name: string; status: string; beat: { name: string } | null; accounts: { firm_id: string; active: boolean; deleted_at: string | null }[] };
  return ((data ?? []) as unknown as R[]).map((c) => ({
    id: c.id,
    name: c.name,
    status: c.status,
    beat: c.beat?.name ?? null,
    firmIds: c.accounts.filter((a) => a.active && !a.deleted_at).map((a) => a.firm_id),
  }));
}

export type UsualItem = { item_id: string; times: number; last_qty: string; last_date: string };

export async function usualItems(firmId: string, customerId: string): Promise<UsualItem[]> {
  await requireUser();
  if (!uuid.safeParse(firmId).success || !uuid.safeParse(customerId).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("customer_usual_items", { p_firm_id: firmId, p_customer_id: customerId }).limit(30);
  return (data ?? []) as UsualItem[];
}

/** Save the wording of corrected pasted lines so it matches next time. */
export async function learnItemAliases(rows: { itemId: string; text: string }[]): Promise<void> {
  await requirePermission("order.create");
  const valid = rows.filter((r) => uuid.safeParse(r.itemId).success && r.text.trim().length >= 3).slice(0, 100);
  if (!valid.length) return;
  const supabase = await createClient();
  await supabase.rpc("learn_item_aliases", { p: valid.map((r) => ({ item_id: r.itemId, text: r.text })) });
}
