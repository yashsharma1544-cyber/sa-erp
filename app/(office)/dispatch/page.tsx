import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { DispatchClient, type BoardRow, type DispatchRow } from "./dispatch-client";

export default async function DispatchPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  await requirePermission("dispatch.manage");
  const { date: d } = await searchParams;
  const today = todayIST();
  const date = d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : today;
  const supabase = await createClient();
  const [{ data: board }, { data: dispatches }, { data: vehicles }, { data: drivers }] = await Promise.all([
    supabase.rpc("dispatch_board", { p_date: date }),
    supabase
      .from("dispatches")
      .select("id, dispatch_no, route_date, status, helpers, note, vehicle_id, driver_id, vehicle:vehicles(reg_no, capacity_kg), driver:app_users!dispatches_driver_id_fkey(full_name), orders:dispatch_orders(order_id, seq, deleted_at)")
      .eq("route_date", date)
      .neq("status", "cancelled")
      .order("dispatch_no"),
    supabase.from("vehicles").select("id, reg_no, capacity_kg, description").eq("active", true).is("deleted_at", null).order("reg_no"),
    supabase.from("app_users").select("id, full_name, roles:user_roles!inner(role)").eq("roles.role", "driver").eq("active", true).is("deleted_at", null).order("full_name"),
  ]);
  type D = Omit<DispatchRow, "orders"> & { orders: { order_id: string; seq: number; deleted_at: string | null }[] };
  const rows: DispatchRow[] = ((dispatches ?? []) as unknown as D[]).map((x) => ({
    ...x,
    orders: x.orders.filter((o) => !o.deleted_at).sort((a, b) => a.seq - b.seq),
  }));
  return (
    <DispatchClient
      date={date}
      today={today}
      board={(board ?? []) as BoardRow[]}
      dispatches={rows}
      vehicles={vehicles ?? []}
      drivers={(drivers ?? []).map((u) => ({ id: u.id as string, full_name: u.full_name as string }))}
    />
  );
}
