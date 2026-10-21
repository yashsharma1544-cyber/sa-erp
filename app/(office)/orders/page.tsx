import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/format";
import { OrdersClient, type OrderListRow } from "./orders-client";

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const me = await requireUser();
  if (!can(me, "order.create") && !can(me, "reports.view_all")) redirect("/no-access");
  const sp = await searchParams;
  const today = todayIST();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = sp.to && iso.test(sp.to) ? sp.to : today;
  const from = sp.from && iso.test(sp.from) ? sp.from : to.slice(0, 8) + "01";
  const supabase = await createClient();
  const [{ data }, { data: firms }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, order_no, order_date, status, source, total, total_kg, discount, firm_id, created_at, " +
          "customer:customers(id, name, beat:beats(name)), salesman:app_users!orders_salesman_id_fkey(full_name)",
      )
      .is("deleted_at", null)
      .gte("order_date", from)
      .lte("order_date", to)
      .order("order_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);
  type R = Omit<OrderListRow, "customer_name" | "customer_id" | "beat_name" | "salesman_name"> & {
    customer: { id: string; name: string; beat: { name: string } | null } | null;
    salesman: { full_name: string } | null;
  };
  const rows: OrderListRow[] = ((data ?? []) as unknown as R[]).map(({ customer, salesman, ...r }) => ({
    ...r,
    customer_id: customer?.id ?? "",
    customer_name: customer?.name ?? "—",
    beat_name: customer?.beat?.name ?? null,
    salesman_name: salesman?.full_name ?? null,
  }));
  return <OrdersClient rows={rows} firms={firms ?? []} from={from} to={to} canCreate={can(me, "order.create")} />;
}
