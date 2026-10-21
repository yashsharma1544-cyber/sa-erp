import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WhatsAppOrdersClient, type WaOrder, type SyncStatus } from "./whatsapp-orders-client";

export default async function WhatsAppOrdersPage() {
  await requirePermission("order.create");
  const supabase = await createClient();
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ data: orders }, { data: status }, { data: items }] = await Promise.all([
    supabase
      .from("wa_orders")
      .select(
        "id, external_key, group_name, sent_at, sender_name, customer_text, customer_id, message_body, parse_notes, status, problems, order_id, note, " +
          "firm:firms(code), customer:customers(name), salesman:app_users!wa_orders_salesman_id_fkey(full_name), order:orders(order_no, status, total), " +
          "lines:wa_order_lines(id, line_no, raw_line, wa_item_name, pack, qty_said, unit_said, free_qty, uncertain, item_id, qty, kg, note, problem, set_by_office, deleted_at, item:items(name, unit, pack_size_g))",
      )
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(500),
    supabase.rpc("wa_sync_status").maybeSingle(),
    supabase.from("items").select("id, name, unit").is("deleted_at", null).eq("active", true).order("name"),
  ]);
  type Raw = Omit<WaOrder, "lines"> & { lines: (WaOrder["lines"][number] & { deleted_at: string | null })[] };
  const rows: WaOrder[] = ((orders ?? []) as unknown as Raw[]).map((o) => ({
    ...o,
    lines: o.lines.filter((l) => !l.deleted_at).sort((a, b) => a.line_no - b.line_no),
  }));
  return <WhatsAppOrdersClient rows={rows} status={(status as SyncStatus | null) ?? null} items={items ?? []} />;
}
