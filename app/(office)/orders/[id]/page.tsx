import { notFound } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { OrderDetail, type OrderView } from "./order-detail";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: order }, { data: lines }, { data: events }, { data: approvals }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_no, order_date, status, source, taxable, gst, total, discount, total_kg, credit_check, note, created_at, created_by, " +
          "firm:firms(code, name, gst_registered), customer:customers(id, name, status, beat:beats(name)), salesman:app_users!orders_salesman_id_fkey(full_name)",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_lines")
      .select("id, line_no, unit, qty, kg, list_rate, rate, gst_rate, taxable, gst, amount, item:items(name, unit, pack_size_g)")
      .eq("order_id", id)
      .is("deleted_at", null)
      .order("line_no"),
    supabase
      .from("order_events")
      .select("id, from_status, to_status, note, at, by:app_users!order_events_by_user_fkey(full_name)")
      .eq("order_id", id)
      .order("at"),
    supabase
      .from("approval_requests")
      .select("id, kind, status, reason, amount, decision_note, decided_at, decider:app_users!approval_requests_decided_by_fkey(full_name)")
      .eq("subject_table", "orders")
      .eq("subject_id", id)
      .order("created_at"),
  ]);
  if (!order) notFound();
  return (
    <OrderDetail
      order={order as unknown as OrderView["order"]}
      lines={(lines ?? []) as unknown as OrderView["lines"]}
      events={(events ?? []) as unknown as OrderView["events"]}
      approvals={(approvals ?? []) as unknown as OrderView["approvals"]}
      canCancel={can(me, "order.create")}
    />
  );
}
