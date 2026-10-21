"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, RotateCw, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatINR, formatKg, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input, Select } from "@/components/ui/field";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { searchCustomers, type CustomerHit } from "../actions";
import { STATUS_LABEL, STATUS_TONE, type OrderStatus } from "../status";
import { packetsFor } from "@/lib/orders/packets";
import { customerSuggestions, ignoreOrder, linkCustomer, placeOrder, removeLine, setLine, syncNow, type Suggestion } from "./actions";

type Line = {
  id: string; line_no: number; raw_line: string | null; wa_item_name: string | null; pack: string | null;
  qty_said: string | null; unit_said: string | null; free_qty: string | null; uncertain: boolean;
  item_id: string | null; qty: string | null; kg: string | null; note: string | null; problem: string | null;
  set_by_office: boolean; item: { name: string; unit: string; pack_size_g: string | null } | null;
};
export type WaOrder = {
  id: string; external_key: string; group_name: string | null; sent_at: string; sender_name: string | null;
  customer_text: string | null; customer_id: string | null; message_body: string | null; parse_notes: string | null;
  status: "review" | "ordered" | "ignored" | "cancelled"; problems: string[]; order_id: string | null; note: string | null;
  firm: { code: string }; customer: { name: string } | null; salesman: { full_name: string } | null;
  order: { order_no: string; status: OrderStatus; total: string } | null;
  lines: Line[];
};
export type SyncStatus = {
  connected: boolean; started_at: string | null; status: string | null; error: string | null; last_ok_at: string | null; waiting: number;
};
type Item = { id: string; name: string; unit: string };

const TABS = [
  { key: "review", label: "To check" },
  { key: "ordered", label: "Placed" },
  { key: "other", label: "Ignored / deleted" },
] as const;

export function WhatsAppOrdersClient({ rows, status, items }: { rows: WaOrder[]; status: SyncStatus | null; items: Item[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>(rows.some((r) => r.status === "review") ? "review" : "ordered");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) router.refresh();
    });

  const shown = rows.filter((r) => (tab === "other" ? r.status === "ignored" || r.status === "cancelled" : r.status === tab));
  const count = (k: (typeof TABS)[number]["key"]) => rows.filter((r) => (k === "other" ? r.status === "ignored" || r.status === "cancelled" : r.status === k)).length;
  const placedToday = rows.filter((r) => r.status === "ordered").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp orders"
        description="Orders the salesmen post in each market's WhatsApp group. JALNA LOCAL ORDER goes to Sushil, every other group to Anjali. Orders with nothing to check are placed by themselves; the rest wait here."
        actions={
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(syncNow)}>
            <RotateCw className="h-4 w-4" /> Sync now
          </Button>
        }
      />
      {!status?.connected ? (
        <Alert kind="info">The WhatsApp orders database isn&apos;t connected yet. See the runbook, &quot;Connect WhatsApp orders&quot;.</Alert>
      ) : (
        <p className="text-xs text-slate-500">
          Last sync {status.last_ok_at ? formatDateTime(status.last_ok_at) : "—"}
          {status.status === "failed" && <span className="text-red-700"> · last try failed: {status.error}</span>}
          {" · "}
          {formatNumber(placedToday)} placed in the last 7 days
        </p>
      )}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn("rounded-full px-3 py-1 text-sm", t.key === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t.label} <span className="num ml-1 opacity-70">{formatNumber(count(t.key))}</span>
          </button>
        ))}
      </div>

      {shown.length === 0 && <Card className="px-6 py-12 text-center text-sm text-slate-500">Nothing here.</Card>}
      {shown.map((o) => (
        <OrderCard key={o.id} o={o} items={items} pending={pending} run={run} />
      ))}
    </div>
  );
}

function OrderCard({
  o, items, pending, run,
}: {
  o: WaOrder;
  items: Item[];
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>) => void;
}) {
  const [showMsg, setShowMsg] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState("");
  const editable = o.status === "review";
  const kg = o.lines.reduce((s, l) => s + Number(l.kg ?? 0), 0);

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{o.customer?.name ?? o.customer_text ?? "No customer name"}</span>
            {o.customer && o.customer_text && o.customer.name.toLowerCase() !== o.customer_text.toLowerCase() && (
              <span className="text-xs text-slate-500">(“{o.customer_text}”)</span>
            )}
            <Badge>{o.firm.code}</Badge>
            {o.order && (
              <Link href={`/orders/${o.order_id}`}>
                <Badge tone={STATUS_TONE[o.order.status]}>
                  {o.order.order_no} · {STATUS_LABEL[o.order.status]}
                </Badge>
              </Link>
            )}
            {o.status === "ignored" && <Badge>not an order</Badge>}
            {o.status === "cancelled" && <Badge>deleted in WhatsApp</Badge>}
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {o.group_name} · {o.salesman?.full_name ?? o.sender_name ?? "?"}
            {!o.salesman && o.sender_name && <span className="text-amber-700"> (not linked)</span>} · {formatDateTime(o.sent_at)}
            {kg > 0 && <> · {formatKg(kg)}</>}
            {o.order && <> · {formatINR(o.order.total)}</>}
          </p>
          {o.note && <p className="mt-1 text-xs text-slate-500">{o.note}</p>}
        </div>
        <button className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800" onClick={() => setShowMsg(!showMsg)}>
          {showMsg ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />} Message
        </button>
      </div>
      {showMsg && (
        <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-700">
          {o.message_body ?? "(photo)"}
          {o.parse_notes && <div className="mt-2 text-xs text-amber-700">Reader’s note: {o.parse_notes}</div>}
        </pre>
      )}

      {editable && o.problems.length > 0 && (
        <ul className="mt-3 space-y-0.5 text-sm text-amber-800">
          {o.problems.map((p) => (
            <li key={p}>• {p}</li>
          ))}
        </ul>
      )}
      {editable && !o.customer_id && <CustomerLink waOrderId={o.id} onPick={(c) => run(() => linkCustomer(o.id, c))} hint={o.customer_text ?? ""} />}

      <div className="mt-3">
        <Table>
          <THead>
            <tr>
              <TH>As written</TH>
              <TH>Item</TH>
              <TH className="text-right">Order qty</TH>
              <TH className="text-right">Weight</TH>
              {editable && <TH />}
            </tr>
          </THead>
          <tbody>
            {o.lines.map((l) => (
              <LineRow key={l.id} l={l} items={items} editable={editable} pending={pending} run={run} />
            ))}
          </tbody>
        </Table>
      </div>

      {editable && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
          <Button disabled={pending || o.problems.length > 0} onClick={() => run(() => placeOrder(o.id))}>
            Place order
          </Button>
          {!ignoring ? (
            <Button variant="ghost" onClick={() => setIgnoring(true)}>
              Not an order
            </Button>
          ) : (
            <>
              <Input className="w-64" placeholder="Why? e.g. enquiry, duplicate" value={reason} onChange={(e) => setReason(e.target.value)} />
              <Button variant="secondary" disabled={pending} onClick={() => run(() => ignoreOrder(o.id, reason))}>
                Mark
              </Button>
            </>
          )}
          {o.problems.length > 0 && <span className="text-xs text-slate-500">Fix the points above to place it.</span>}
        </div>
      )}
    </Card>
  );
}

function LineRow({
  l, items, editable, pending, run,
}: {
  l: Line;
  items: Item[];
  editable: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [itemId, setItemId] = useState(l.item_id ?? "");
  const [qty, setQty] = useState(l.qty ? String(Number(l.qty)) : "");
  const unit = items.find((i) => i.id === itemId)?.unit ?? l.item?.unit ?? "";
  return (
    <TR className={l.problem ? "bg-amber-50/60" : undefined}>
      <TD className="text-sm">
        <div className="font-mono text-slate-700">{l.raw_line}</div>
        <div className="text-xs text-slate-500">
          {l.qty_said !== null && <>{Number(l.qty_said)} {l.unit_said ?? "(no unit)"}</>}
          {l.free_qty && <> · free {Number(l.free_qty)}</>}
        </div>
      </TD>
      <TD className="text-sm">
        {editing ? (
          <Select className="h-9" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="">Pick the item</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        ) : (
          <>
            <div className="font-medium text-slate-900">{l.item?.name ?? <span className="text-amber-700">{l.wa_item_name ?? "—"}</span>}</div>
            {l.note && <div className="text-xs text-slate-500">{l.note}</div>}
            {l.problem && <div className="text-xs text-amber-800">{l.problem}</div>}
          </>
        )}
      </TD>
      <TD className="num text-right">
        {editing ? (
          <div className="flex items-center justify-end gap-1">
            <Input className="w-24 text-right" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d.]/g, ""))} />
            <span className="text-xs text-slate-500">{unit}</span>
          </div>
        ) : l.qty && l.item ? (
          (() => {
            const pkts = packetsFor(l.item, Number(l.qty));
            return pkts !== null ? (
              <>
                {pkts} pkt<div className="text-xs text-slate-500">billed {Number(l.qty)} kg</div>
              </>
            ) : (
              <>
                {Number(l.qty)} {l.item.unit}
              </>
            );
          })()
        ) : (
          "—"
        )}
      </TD>
      <TD className="num text-right">{l.kg && Number(l.kg) > 0 ? formatKg(l.kg) : "—"}</TD>
      {editable && (
        <TD className="whitespace-nowrap text-right">
          {editing ? (
            <>
              <Button size="sm" disabled={pending || !itemId || !qty} onClick={() => run(async () => {
                const r = await setLine(l.id, itemId, qty);
                if (!r.error) setEditing(false);
                return r;
              })}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant={l.problem ? "secondary" : "ghost"} onClick={() => setEditing(true)}>
                {l.problem ? "Fix" : "Change"}
              </Button>
              <button
                aria-label="Remove line"
                className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                disabled={pending}
                onClick={() => run(() => removeLine(l.id))}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
        </TD>
      )}
    </TR>
  );
}

function CustomerLink({ waOrderId, onPick, hint }: { waOrderId: string; onPick: (customerId: string) => void; hint: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [suggested, setSuggested] = useState<Suggestion[] | null>(null);
  useEffect(() => {
    let live = true;
    void customerSuggestions(waOrderId).then((r) => live && setSuggested(r));
    return () => {
      live = false;
    };
  }, [waOrderId]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void searchCustomers(q).then((r) => live && setHits(r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  const top = useMemo(() => hits.slice(0, 8), [hits]);
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
      <div className="mb-2 text-sm font-medium text-slate-700">
        Which customer is “{hint}”? <span className="font-normal text-slate-500">Linked once, remembered for next time.</span>
      </div>
      {suggested && suggested.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {suggested.map((c) => (
            <button
              key={c.customer_id}
              onClick={() => onPick(c.customer_id)}
              className={cn(
                "rounded-full px-3 py-1 text-sm ring-1 hover:bg-slate-50",
                Number(c.score) >= 0.9 ? "bg-brand-50 ring-brand-300" : "bg-white ring-slate-200",
              )}
            >
              {c.name} <span className="text-xs text-slate-500">· {c.beat_name ?? "no beat"}{!c.in_firm && " · new to this firm"}</span>
            </button>
          ))}
        </div>
      )}
      <Input placeholder="Or search another customer" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-2 flex flex-wrap gap-2">
        {top.map((c) => (
          <button key={c.id} onClick={() => onPick(c.id)} className="rounded-full bg-white px-3 py-1 text-sm ring-1 ring-slate-200 hover:bg-slate-50">
            {c.name} <span className="text-xs text-slate-500">· {c.beat ?? "no beat"}</span>
          </button>
        ))}
        {q.trim().length >= 2 && top.length === 0 && <span className="text-xs text-slate-500">No customer found. Add them on Customers first.</span>}
      </div>
    </div>
  );
}
