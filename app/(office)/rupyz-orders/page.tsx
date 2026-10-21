import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { RupyzOrdersClient, type OrderRow } from "./rupyz-orders-client";

export default async function RupyzOrdersPage() {
  const me = await requireUser();
  if (!can(me, "order.approve") && !can(me, "credit.manage")) redirect("/no-access");
  const supabase = await createClient();
  const { data } = await supabase
    .from("rupyz_orders")
    .select(
      "id, rupyz_order_id, order_no, order_date, rupyz_customer_name, customer_id, salesman_name, beat_name, amount, status, credit, checked_at, " +
        "firm:firms(code), customer:customers(name)",
    )
    .is("deleted_at", null)
    .order("order_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);
  const rows = ((data ?? []) as unknown as Array<Omit<OrderRow, "firm_code" | "customer_name"> & { firm: { code: string } | null; customer: { name: string } | null }>).map(
    ({ firm, customer, ...r }) => ({ ...r, firm_code: firm?.code ?? "", customer_name: customer?.name ?? null }),
  );
  return <RupyzOrdersClient rows={rows} canLink={can(me, "masters.manage")} />;
}
