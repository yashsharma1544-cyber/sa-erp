"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function call(fn: string, args: Record<string, unknown>, ok: string): Promise<ActionResult> {
  await requirePermission("dispatch.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/dispatch");
  revalidatePath("/orders");
  return { ok };
}

export async function createDispatch(routeDate: string, vehicleId: string, driverId: string, helpers: string, orderIds: string[]) {
  if (!date.safeParse(routeDate).success) return { error: "Pick the date" };
  if (!z.array(uuid).safeParse(orderIds).success) return { error: "Pick the orders" };
  return call(
    "create_dispatch",
    { p_route_date: routeDate, p_vehicle_id: vehicleId || null, p_driver_id: driverId || null, p_helpers: helpers, p_order_ids: orderIds },
    `Dispatch made with ${orderIds.length} order(s)`,
  );
}

export async function addOrders(dispatchId: string, orderIds: string[]) {
  if (!uuid.safeParse(dispatchId).success || !z.array(uuid).min(1).safeParse(orderIds).success) return { error: "Pick the orders" };
  return call("dispatch_add_orders", { p_dispatch_id: dispatchId, p_order_ids: orderIds }, `${orderIds.length} order(s) added`);
}

export async function removeOrder(dispatchId: string, orderId: string) {
  if (!uuid.safeParse(dispatchId).success || !uuid.safeParse(orderId).success) return { error: "Unknown order" };
  return call("dispatch_remove_order", { p_dispatch_id: dispatchId, p_order_id: orderId }, "Order taken off");
}

export async function updateDispatch(dispatchId: string, vehicleId: string, driverId: string, helpers: string, note: string) {
  if (!uuid.safeParse(dispatchId).success) return { error: "Unknown dispatch" };
  return call(
    "dispatch_update",
    { p_dispatch_id: dispatchId, p_vehicle_id: vehicleId || null, p_driver_id: driverId || null, p_helpers: helpers, p_note: note },
    "Saved",
  );
}

const STATUS_OK: Record<string, string> = {
  loading: "Loading started",
  departed: "Vehicle has left; orders are dispatched",
  returned: "Vehicle is back",
  cancelled: "Dispatch cancelled; its orders are free again",
  planned: "Back to planned",
};

export async function setStatus(dispatchId: string, status: string) {
  if (!uuid.safeParse(dispatchId).success || !STATUS_OK[status]) return { error: "Unknown step" };
  return call("dispatch_set_status", { p_dispatch_id: dispatchId, p_status: status }, STATUS_OK[status]!);
}

export async function moveOrder(orderId: string, to: string) {
  if (!uuid.safeParse(orderId).success || !date.safeParse(to).success) return { error: "Pick the date" };
  return call("set_order_planned_date", { p_order_id: orderId, p_date: to }, "Delivery date changed");
}
