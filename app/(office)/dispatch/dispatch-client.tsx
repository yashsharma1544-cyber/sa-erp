"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Printer, Truck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatKg, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input, Select } from "@/components/ui/field";
import { addOrders, createDispatch, moveOrder, removeOrder, setStatus, updateDispatch } from "./actions";

export type BoardRow = {
  order_id: string; order_no: string; firm_code: string; order_date: string; planned_date: string | null; status: string;
  customer_id: string; customer_name: string; beat_id: string | null; beat_name: string | null; route_kind: string | null;
  territory_name: string | null; total: string; total_kg: string; lines: number; dispatch_id: string | null;
};
export type DispatchRow = {
  id: string; dispatch_no: string; route_date: string; status: "planned" | "loading" | "departed" | "returned" | "cancelled";
  helpers: string | null; note: string | null; vehicle_id: string | null; driver_id: string | null;
  vehicle: { reg_no: string; capacity_kg: string | null } | null; driver: { full_name: string } | null;
  orders: { order_id: string; seq: number }[];
};
type Vehicle = { id: string; reg_no: string; capacity_kg: string | null; description: string | null };
type Driver = { id: string; full_name: string };

const STATUS_TONE = { planned: "neutral", loading: "amber", departed: "blue", returned: "green", cancelled: "neutral" } as const;
const STATUS_LABEL = { planned: "Planned", loading: "Loading", departed: "On the road", returned: "Back", cancelled: "Cancelled" } as const;
const n = (v: string | number | null | undefined) => Number(v ?? 0);

export function DispatchClient({
  date, today, board, dispatches, vehicles, drivers,
}: {
  date: string;
  today: string;
  board: BoardRow[];
  dispatches: DispatchRow[];
  vehicles: Vehicle[];
  drivers: Driver[];
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [vehicleId, setVehicleId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [helpers, setHelpers] = useState("");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });

  const byId = useMemo(() => new Map(board.map((b) => [b.order_id, b])), [board]);
  const waiting = board.filter((b) => !b.dispatch_id);
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; title: string; sub: string; rows: BoardRow[] }>();
    for (const r of waiting) {
      const key = r.beat_id ?? "none";
      const g = m.get(key) ?? {
        key,
        title: r.beat_name ?? "No beat",
        sub: [r.territory_name, r.route_kind === "outstation" ? "outstation" : r.route_kind === "city" ? "city" : null].filter(Boolean).join(" · "),
        rows: [],
      };
      g.rows.push(r);
      m.set(key, g);
    }
    return [...m.values()].sort((a, b) => a.sub.localeCompare(b.sub) || a.title.localeCompare(b.title));
  }, [waiting]);

  const sel = waiting.filter((r) => picked.has(r.order_id));
  const selKg = sel.reduce((s, r) => s + n(r.total_kg), 0);
  const toggle = (id: string) => setPicked((p) => {
    const x = new Set(p);
    if (x.has(id)) x.delete(id);
    else x.add(id);
    return x;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispatch"
        description="Approved orders waiting for a vehicle, grouped by beat. City orders are due on their order date, outstation orders on the beat's route day. Pick orders, make a dispatch, print the loading sheet."
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" className="w-44" value={date} onChange={(e) => router.push(`/dispatch?date=${e.target.value}`)} />
            {date !== today && (
              <Button variant="ghost" size="sm" onClick={() => router.push("/dispatch")}>
                Today
              </Button>
            )}
          </div>
        }
      />
      {vehicles.length === 0 && <Alert kind="info">No vehicles yet. Add them on Masters → Vehicles (with capacity in kg).</Alert>}
      {drivers.length === 0 && <Alert kind="info">No drivers yet. Add them on Admin → Users with the Driver role.</Alert>}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="space-y-4 xl:col-span-3">
          <h2 className="text-sm font-semibold text-slate-700">
            Waiting for a vehicle on {formatDate(date)} <span className="font-normal text-slate-500">· {formatNumber(waiting.length)} orders · {formatKg(waiting.reduce((s, r) => s + n(r.total_kg), 0))}</span>
          </h2>
          {groups.length === 0 && <Card className="px-6 py-10 text-center text-sm text-slate-500">Nothing waiting for this date.</Card>}
          {groups.map((g) => {
            const all = g.rows.every((r) => picked.has(r.order_id));
            return (
              <Card key={g.key}>
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={all}
                      onChange={() => setPicked((p) => {
                        const x = new Set(p);
                        for (const r of g.rows) if (all) x.delete(r.order_id);
                        else x.add(r.order_id);
                        return x;
                      })}
                    />
                    {g.title} <span className="font-normal text-slate-500">{g.sub}</span>
                  </label>
                  <span className="num text-xs text-slate-500">
                    {g.rows.length} · {formatKg(g.rows.reduce((s, r) => s + n(r.total_kg), 0))}
                  </span>
                </div>
                <div className="divide-y divide-slate-100">
                  {g.rows.map((r) => (
                    <div key={r.order_id} className={cn("flex flex-wrap items-center gap-3 px-4 py-2 text-sm", picked.has(r.order_id) && "bg-brand-50/50")}>
                      <input type="checkbox" checked={picked.has(r.order_id)} onChange={() => toggle(r.order_id)} />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">
                          {r.customer_name} <Badge className="ml-1">{r.firm_code}</Badge>
                        </div>
                        <div className="text-xs text-slate-500">
                          <Link href={`/orders/${r.order_id}`} className="hover:underline">{r.order_no}</Link> · ordered {formatDate(r.order_date)}
                          {r.planned_date && r.planned_date < date && <span className="text-amber-700"> · was due {formatDate(r.planned_date)}</span>}
                        </div>
                      </div>
                      <div className="num w-20 text-right">{n(r.total_kg) > 0 ? formatKg(r.total_kg) : "—"}</div>
                      <div className="num w-24 text-right text-slate-500">{formatINR(r.total).replace(/\.\d\d$/, "")}</div>
                      <Input
                        type="date"
                        className="h-8 w-36 text-xs"
                        title="Move to another delivery date"
                        value={r.planned_date ?? ""}
                        onChange={(e) => e.target.value && run(() => moveOrder(r.order_id, e.target.value))}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>

        <div className="space-y-4 xl:col-span-2">
          <Card className="p-4">
            <div className="mb-3 text-sm font-semibold text-slate-700">
              {sel.length ? `${sel.length} selected · ${formatKg(selKg)}` : "Select orders on the left"}
            </div>
            <div className="grid gap-2">
              <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Vehicle (can set later)</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.reg_no}{v.capacity_kg ? ` · ${formatNumber(n(v.capacity_kg))} kg` : ""}
                  </option>
                ))}
              </Select>
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
                <option value="">Driver (can set later)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.full_name}
                  </option>
                ))}
              </Select>
              <Input placeholder="Helpers (names)" value={helpers} onChange={(e) => setHelpers(e.target.value)} />
              <Button
                disabled={pending || sel.length === 0}
                onClick={() => run(() => createDispatch(date, vehicleId, driverId, helpers, sel.map((r) => r.order_id)), () => setPicked(new Set()))}
              >
                <Truck className="h-4 w-4" /> New dispatch for {formatDate(date)}
              </Button>
            </div>
          </Card>

          {dispatches.length === 0 && <p className="text-sm text-slate-500">No dispatch for this date yet.</p>}
          {dispatches.map((d) => (
            <DispatchCard
              key={d.id}
              d={d}
              byId={byId}
              vehicles={vehicles}
              drivers={drivers}
              selected={sel.map((r) => r.order_id)}
              pending={pending}
              run={run}
              clearPicked={() => setPicked(new Set())}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DispatchCard({
  d, byId, vehicles, drivers, selected, pending, run, clearPicked,
}: {
  d: DispatchRow;
  byId: Map<string, BoardRow>;
  vehicles: Vehicle[];
  drivers: Driver[];
  selected: string[];
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) => void;
  clearPicked: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [vehicleId, setVehicleId] = useState(d.vehicle_id ?? "");
  const [driverId, setDriverId] = useState(d.driver_id ?? "");
  const [helpers, setHelpers] = useState(d.helpers ?? "");
  const orders = d.orders.map((o) => byId.get(o.order_id)).filter((x): x is BoardRow => !!x);
  const kg = orders.reduce((s, o) => s + n(o.total_kg), 0);
  const cap = n(d.vehicle?.capacity_kg);
  const open = d.status === "planned" || d.status === "loading";

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            {d.dispatch_no} <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
          </span>
        }
        description={`${d.vehicle?.reg_no ?? "No vehicle"} · ${d.driver?.full_name ?? "No driver"}${d.helpers ? ` · ${d.helpers}` : ""}`}
      />
      <div className="px-5 pb-4">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>{formatNumber(orders.length)} orders · {formatKg(kg)}</span>
          {cap > 0 && <span className={kg > cap ? "font-semibold text-red-700" : undefined}>{Math.round((kg / cap) * 100)}% of {formatNumber(cap)} kg</span>}
        </div>
        {cap > 0 && (
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className={cn("h-full rounded-full", kg > cap ? "bg-red-600" : "bg-brand-600")} style={{ width: `${Math.min(100, (kg / cap) * 100)}%` }} />
          </div>
        )}

        <div className="mt-3 divide-y divide-slate-100 text-sm">
          {orders.map((o) => (
            <div key={o.order_id} className="flex items-center gap-2 py-1.5">
              <span className="min-w-0 flex-1 truncate">
                {o.customer_name} <span className="text-xs text-slate-500">{o.firm_code} · {o.beat_name ?? "—"}</span>
              </span>
              <span className="num text-xs text-slate-500">{formatKg(o.total_kg)}</span>
              {open && (
                <button aria-label="Take off" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600" disabled={pending} onClick={() => run(() => removeOrder(d.id, o.order_id))}>
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>

        {editing && (
          <div className="mt-3 grid gap-2">
            <Select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">No vehicle</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>{v.reg_no}</option>
              ))}
            </Select>
            <Select value={driverId} onChange={(e) => setDriverId(e.target.value)}>
              <option value="">No driver</option>
              {drivers.map((x) => (
                <option key={x.id} value={x.id}>{x.full_name}</option>
              ))}
            </Select>
            <Input placeholder="Helpers" value={helpers} onChange={(e) => setHelpers(e.target.value)} />
            <Button size="sm" disabled={pending} onClick={() => run(() => updateDispatch(d.id, vehicleId, driverId, helpers, d.note ?? ""), () => setEditing(false))}>
              Save
            </Button>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {open && selected.length > 0 && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => addOrders(d.id, selected), clearPicked)}>
              Add {selected.length} selected
            </Button>
          )}
          {open && !editing && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Vehicle / driver
            </Button>
          )}
          {d.status === "planned" && (
            <Button size="sm" disabled={pending || orders.length === 0} onClick={() => run(() => setStatus(d.id, "loading"))}>
              Start loading
            </Button>
          )}
          {d.status === "loading" && (
            <Button size="sm" disabled={pending} onClick={() => run(() => setStatus(d.id, "departed"))}>
              Vehicle left
            </Button>
          )}
          {d.status === "departed" && (
            <Button size="sm" disabled={pending} onClick={() => run(() => setStatus(d.id, "returned"))}>
              Vehicle back
            </Button>
          )}
          <Link href={`/dispatch/${d.id}`}>
            <Button size="sm" variant="secondary">
              <Printer className="h-4 w-4" /> Loading sheet
            </Button>
          </Link>
          {open && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm(`Cancel ${d.dispatch_no}? Its orders go back to waiting.`) && run(() => setStatus(d.id, "cancelled"))}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
