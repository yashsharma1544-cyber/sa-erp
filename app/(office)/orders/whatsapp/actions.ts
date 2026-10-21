"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const uuid = z.string().uuid();

async function call(fn: string, args: Record<string, unknown>, ok: string): Promise<ActionResult & { data?: unknown }> {
  await requirePermission("order.create");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/orders/whatsapp");
  revalidatePath("/orders");
  return { ok, data };
}

export async function linkCustomer(id: string, customerId: string) {
  if (!uuid.safeParse(id).success || !uuid.safeParse(customerId).success) return { error: "Pick the customer" };
  return call("wa_link_customer", { p_id: id, p_customer_id: customerId }, "Customer linked. Later orders with this name link on their own.");
}

export async function setLine(lineId: string, itemId: string, qty: string) {
  if (!uuid.safeParse(lineId).success || !uuid.safeParse(itemId).success) return { error: "Pick the item" };
  if (!/^\d{1,6}(\.\d{1,3})?$/.test(qty.trim()) || Number(qty) <= 0) return { error: "Enter the quantity" };
  return call("wa_set_line", { p_line_id: lineId, p_item_id: itemId, p_qty: qty.trim() }, "Line set");
}

export async function removeLine(lineId: string) {
  if (!uuid.safeParse(lineId).success) return { error: "Unknown line" };
  return call("wa_remove_line", { p_line_id: lineId }, "Line removed");
}

export async function placeOrder(id: string) {
  if (!uuid.safeParse(id).success) return { error: "Unknown order" };
  const r = await call("wa_place_order", { p_id: id }, "Order placed");
  if (r.error) return r;
  const d = r.data as { order_no: string; order_status: string };
  return { ok: d.order_status === "approved" ? `Order ${d.order_no} approved` : `Order ${d.order_no} is waiting for approval` };
}

export async function ignoreOrder(id: string, reason: string) {
  if (!uuid.safeParse(id).success) return { error: "Unknown order" };
  return call("wa_ignore_order", { p_id: id, p_reason: reason }, "Marked as not an order");
}

export async function syncNow() {
  const r = await call("wa_sync_now", {}, "Synced");
  if (r.error) return r;
  const d = r.data as { status: string; reason?: string; counts?: Record<string, number | string> };
  if (d.status === "skipped") return { error: d.reason ?? "Skipped" };
  if (d.status === "failed") return { error: String(d.counts?.error ?? "Sync failed") };
  const c = d.counts ?? {};
  return { ok: `${c.new ?? 0} new, ${c.placed ?? 0} placed, ${c.updated ?? 0} updated, ${c.cancelled ?? 0} cancelled` };
}

export type Suggestion = { customer_id: string; name: string; beat_name: string | null; score: number; in_firm: boolean };

export async function customerSuggestions(id: string): Promise<Suggestion[]> {
  await requirePermission("order.create");
  if (!uuid.safeParse(id).success) return [];
  const supabase = await createClient();
  const { data } = await supabase.rpc("wa_customer_suggestions", { p_id: id });
  return (data ?? []) as Suggestion[];
}
