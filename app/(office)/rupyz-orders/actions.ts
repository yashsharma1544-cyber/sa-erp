"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const id = z.string().uuid();

function summary(r: Record<string, number> | null): string {
  const parts = Object.entries(r ?? {}).map(([k, v]) => `${v} ${k}`);
  return parts.length ? `Rechecked: ${parts.join(", ")}` : "Nothing to recheck";
}

export async function recheckOrders(ids?: string[]): Promise<ActionResult> {
  await requireUser();
  if (ids && !z.array(id).safeParse(ids).success) return { error: "Unknown order" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("recheck_rupyz_orders", { p_ids: ids ?? null });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/rupyz-orders");
  revalidatePath("/approvals");
  return { ok: summary(data as Record<string, number> | null) };
}

export async function linkCustomer(orderId: string, customerId: string): Promise<ActionResult> {
  await requireUser();
  if (!id.safeParse(orderId).success || !id.safeParse(customerId).success) return { error: "Pick the ERP customer" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("link_rupyz_customer", { p_order_id: orderId, p_customer_id: customerId });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/rupyz-orders");
  revalidatePath("/approvals");
  return { ok: `Linked. ${Number(data ?? 0)} order(s) checked again.` };
}

export async function searchCustomers(q: string): Promise<{ id: string; name: string; beat: string | null }[]> {
  await requireUser();
  const term = q.trim().replace(/[%_,()]/g, " ");
  if (term.length < 2) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, name, beat:beats(name)")
    .is("deleted_at", null)
    .ilike("name", `%${term}%`)
    .order("name")
    .limit(15);
  return ((data ?? []) as unknown as { id: string; name: string; beat: { name: string } | null }[]).map((c) => ({
    id: c.id,
    name: c.name,
    beat: c.beat?.name ?? null,
  }));
}
