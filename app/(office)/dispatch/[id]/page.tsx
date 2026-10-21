import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatINR, formatKg, formatNumber } from "@/lib/format";
import { PrintSheetButton } from "./print-sheet-button";

type Item = {
  firm_code: string; item_id: string; item_name: string; unit: string; qty: string; kg: string;
  pack_size_g: string | null; units_per_case: string | null; packets: string | null; full_cases: string | null; loose_packets: string | null;
};
type Drop = {
  seq: number;
  order: { id: string; order_no: string; total: string; total_kg: string; firm: { code: string }; customer: { name: string; phone: string | null; beat: { name: string } | null } };
};

function packs(i: Item): string {
  const packets = Number(i.packets ?? 0);
  if (!i.packets) return "";
  const per = Number(i.units_per_case ?? 0);
  const cases = Number(i.full_cases ?? 0);
  const loose = Number(i.loose_packets ?? 0);
  const g = Number(i.pack_size_g ?? 0);
  const size = g ? (g >= 1000 ? `${g / 1000} kg` : `${g} g`) : "";
  if (per > 0) return `${cases} bag/box of ${per}${loose ? ` + ${loose} ${size || "pkt"}` : ""}`;
  return `${formatNumber(packets)} × ${size || i.unit}`;
}

export default async function LoadingSheetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("dispatch.manage");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const [{ data: d }, { data: items }, { data: drops }] = await Promise.all([
    supabase
      .from("dispatches")
      .select("id, dispatch_no, route_date, status, helpers, note, vehicle:vehicles(reg_no, capacity_kg), driver:app_users!dispatches_driver_id_fkey(full_name)")
      .eq("id", id)
      .maybeSingle(),
    supabase.rpc("dispatch_loading_items", { p_dispatch_id: id }),
    supabase
      .from("dispatch_orders")
      .select("seq, order:orders(id, order_no, total, total_kg, firm:firms(code), customer:customers(name, phone, beat:beats(name)))")
      .eq("dispatch_id", id)
      .is("deleted_at", null)
      .order("seq"),
  ]);
  if (!d) notFound();
  const disp = d as unknown as {
    dispatch_no: string; route_date: string; status: string; helpers: string | null; note: string | null;
    vehicle: { reg_no: string; capacity_kg: string | null } | null; driver: { full_name: string } | null;
  };
  const rows = (items ?? []) as Item[];
  const stops = (drops ?? []) as unknown as Drop[];
  const firms = [...new Set(rows.map((r) => r.firm_code))];
  const totalKg = rows.reduce((s, r) => s + Number(r.kg), 0);

  return (
    <div className="mx-auto max-w-4xl space-y-6 bg-white print:max-w-none">
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/dispatch?date=${disp.route_date}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
          <ArrowLeft className="h-4 w-4" /> Dispatch
        </Link>
        <PrintSheetButton />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-slate-300 pb-3">
        <div>
          <h1 className="text-2xl font-semibold">Loading sheet · {disp.dispatch_no}</h1>
          <p className="text-sm text-slate-600">
            {formatDate(disp.route_date)} · {disp.vehicle?.reg_no ?? "No vehicle"} · {disp.driver?.full_name ?? "No driver"}
            {disp.helpers && <> · {disp.helpers}</>}
          </p>
        </div>
        <div className="num text-right text-lg font-semibold">
          {formatKg(totalKg)}
          {disp.vehicle?.capacity_kg && <div className="text-xs font-normal text-slate-500">of {formatNumber(Number(disp.vehicle.capacity_kg))} kg</div>}
        </div>
      </div>

      {firms.map((f) => (
        <section key={f}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">{f === "SA" ? "Sushil Agencies" : f === "AA" ? "Anjali Agency" : f}</h2>
          <table className="w-full text-sm">
            <thead className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="py-1.5">Item</th>
                <th className="py-1.5 text-right">Qty</th>
                <th className="py-1.5">Packing</th>
                <th className="py-1.5 text-right">Weight</th>
                <th className="w-12 py-1.5 text-center">✓</th>
              </tr>
            </thead>
            <tbody>
              {rows.filter((r) => r.firm_code === f).map((r) => (
                <tr key={r.item_id} className="border-b border-slate-100">
                  <td className="py-1.5 font-medium">{r.item_name}</td>
                  <td className="num py-1.5 text-right">{Number(r.qty)} {r.unit}</td>
                  <td className="py-1.5 text-slate-600">{packs(r)}</td>
                  <td className="num py-1.5 text-right">{Number(r.kg) > 0 ? formatKg(r.kg) : "—"}</td>
                  <td className="py-1.5 text-center">☐</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">Drops</h2>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-300 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1.5">#</th>
              <th className="py-1.5">Customer</th>
              <th className="py-1.5">Order</th>
              <th className="py-1.5 text-right">Weight</th>
              <th className="py-1.5 text-right">Value</th>
              <th className="py-1.5">Received by</th>
            </tr>
          </thead>
          <tbody>
            {stops.map((s) => (
              <tr key={s.order.id} className="border-b border-slate-100">
                <td className="py-2">{s.seq}</td>
                <td className="py-2">
                  <div className="font-medium">{s.order.customer.name}</div>
                  <div className="text-xs text-slate-500">{s.order.customer.beat?.name ?? ""}{s.order.customer.phone ? ` · ${s.order.customer.phone}` : ""}</div>
                </td>
                <td className="py-2 text-xs">{s.order.order_no}</td>
                <td className="num py-2 text-right">{formatKg(s.order.total_kg)}</td>
                <td className="num py-2 text-right">{formatINR(s.order.total)}</td>
                <td className="py-2 text-slate-300">________________</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid grid-cols-3 gap-6 pt-10 text-center text-xs text-slate-500">
        <div className="border-t border-slate-300 pt-1">Loaded by</div>
        <div className="border-t border-slate-300 pt-1">Checked by</div>
        <div className="border-t border-slate-300 pt-1">Driver</div>
      </div>
    </div>
  );
}
