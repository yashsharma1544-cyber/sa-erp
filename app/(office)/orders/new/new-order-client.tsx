"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR, formatKg, formatNumber } from "@/lib/format";
import { lineTotals, orderTotals } from "@/lib/orders/math";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { checkCredit, type CreditCheck } from "../../credit/actions";
import { createOrder, searchCustomers, usualItems, type CustomerHit, type UsualItem } from "../actions";

type Firm = { id: string; code: string; name: string; gst_registered: boolean };
export type ItemOption = { id: string; name: string; unit: string; kgPerUnit: number; gstRate: number; category: string };
type Line = { key: string; itemId: string; qty: string; rate: string };

const newId = () => crypto.randomUUID();

export function NewOrderClient({
  firms, items, rates, today,
}: {
  firms: Firm[];
  items: ItemOption[];
  rates: Record<string, Record<string, number>>;
  today: string;
}) {
  const router = useRouter();
  const [firmId, setFirmId] = useState(firms[0]?.id ?? "");
  const firm = firms.find((f) => f.id === firmId);
  const [customer, setCustomer] = useState<CustomerHit | null>(null);
  const [source, setSource] = useState<"office" | "counter" | "whatsapp_paste">("office");
  const [orderDate, setOrderDate] = useState(today);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [usual, setUsual] = useState<UsualItem[]>([]);
  const [credit, setCredit] = useState<CreditCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opId, setOpId] = useState(newId);
  const [pending, start] = useTransition();

  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const listRate = (itemId: string) => rates[firmId]?.[itemId] ?? null;

  useEffect(() => {
    if (!customer || !firmId) return setUsual([]);
    let live = true;
    void usualItems(firmId, customer.id).then((u) => live && setUsual(u));
    return () => {
      live = false;
    };
  }, [customer, firmId]);

  const inputs = lines
    .map((l) => {
      const it = itemById.get(l.itemId);
      const qty = Number(l.qty);
      const rate = Number(l.rate || listRate(l.itemId) || 0);
      if (!it || !(qty > 0) || !(rate > 0)) return null;
      return { qty, rate, listRate: listRate(l.itemId), gstRate: it.gstRate, kgPerUnit: it.kgPerUnit };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const totals = orderTotals(inputs, !!firm?.gst_registered);

  // Credit preview, refreshed shortly after the total changes.
  useEffect(() => {
    if (!customer || !firmId || source === "counter") return setCredit(null);
    const t = setTimeout(() => {
      void checkCredit(firmId, customer.id, String(totals.amount)).then((r) => setCredit(r.result ?? null));
    }, 500);
    return () => clearTimeout(t);
  }, [customer, firmId, source, totals.amount]);

  const addItem = (itemId: string, qty = "") => {
    if (lines.some((l) => l.itemId === itemId)) return;
    setLines((ls) => [...ls, { key: newId(), itemId, qty, rate: "" }]);
  };

  const submit = () => {
    setError(null);
    if (!customer) return setError("Pick the customer");
    start(async () => {
      const r = await createOrder({
        clientOpId: opId,
        firmId,
        customerId: customer.id,
        source,
        orderDate,
        note: note || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          // Send a rate only when it differs from the list (or there is no list rate).
          ...(l.rate && Number(l.rate) !== listRate(l.itemId) ? { rate: l.rate } : {}),
        })),
      });
      if (r.error) return setError(r.error);
      setOpId(newId());
      router.push(`/orders/${r.id}`);
    });
  };

  const belowList = lines.some((l) => l.rate && listRate(l.itemId) !== null && Number(l.rate) < listRate(l.itemId)!);

  return (
    <div className="space-y-6">
      <PageHeader
        title="New order"
        description="Quantities are in the Tally billing unit (kg for packet tea, Pkt for sachet strips, box / jar / tin for oil). Rates come from the price list."
        actions={
          <Link href="/orders">
            <Button variant="secondary" size="sm">
              Back to orders
            </Button>
          </Link>
        }
      />
      {error && <Alert kind="error">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Firm">
                <div className="flex gap-2">
                  {firms.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFirmId(f.id)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-sm font-medium",
                        f.id === firmId ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200",
                      )}
                    >
                      {f.name}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Customer">
                <CustomerPicker value={customer} onChange={setCustomer} />
              </Field>
              <Field label="Order from">
                <Select value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
                  <option value="office">Office (phone / visit)</option>
                  <option value="whatsapp_paste">WhatsApp message</option>
                  <option value="counter">Mondha counter, cash</option>
                </Select>
              </Field>
              <Field label="Order date">
                <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </Field>
              {customer && firm && !customer.firmIds.includes(firm.id) && (
                <p className="text-xs text-amber-700 sm:col-span-2">
                  {customer.name} has no {firm.code} account yet. The order still goes through, with no credit terms.
                </p>
              )}
            </CardBody>
          </Card>

          {usual.length > 0 && (
            <Card>
              <CardHeader title="Usually buys" description="Last 90 days in Tally and the ERP. Tap to add with the last quantity." />
              <CardBody className="flex flex-wrap gap-2">
                {usual.map((u) => {
                  const it = itemById.get(u.item_id);
                  if (!it) return null;
                  const added = lines.some((l) => l.itemId === u.item_id);
                  return (
                    <button
                      key={u.item_id}
                      disabled={added}
                      onClick={() => addItem(u.item_id, String(Number(u.last_qty)))}
                      className={cn(
                        "rounded-full px-3 py-1 text-sm ring-1",
                        added ? "bg-brand-50 text-brand-800 ring-brand-200" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                      )}
                    >
                      {it.name} <span className="text-xs text-slate-500">· {Number(u.last_qty)} {it.unit} · {u.times}×</span>
                    </button>
                  );
                })}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Items" />
            <Table>
              <THead>
                <tr>
                  <TH>Item</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Rate</TH>
                  <TH className="text-right">Amount</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {lines.map((l) => {
                  const it = itemById.get(l.itemId)!;
                  const list = listRate(l.itemId);
                  const rate = Number(l.rate || list || 0);
                  const t = lineTotals({ qty: Number(l.qty) || 0, rate, listRate: list, gstRate: it.gstRate, kgPerUnit: it.kgPerUnit }, !!firm?.gst_registered);
                  const low = list !== null && l.rate !== "" && Number(l.rate) < list;
                  return (
                    <TR key={l.key}>
                      <TD>
                        <div className="font-medium text-slate-900">{it.name}</div>
                        <div className="text-xs text-slate-500">
                          per {it.unit}
                          {t.kg > 0 && it.unit !== "kg" && <> · {formatKg(t.kg)}</>}
                        </div>
                      </TD>
                      <TD className="text-right">
                        <Input
                          className="num ml-auto w-24 text-right"
                          inputMode="decimal"
                          value={l.qty}
                          autoFocus={!l.qty}
                          onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                        />
                      </TD>
                      <TD className="text-right">
                        <Input
                          className={cn("num ml-auto w-28 text-right", low && "border-amber-400")}
                          inputMode="decimal"
                          placeholder={list ? String(list) : "Rate"}
                          value={l.rate}
                          onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, rate: e.target.value.replace(/[^\d.]/g, "") } : x)))}
                        />
                        {list === null && <div className="mt-1 text-xs text-amber-700">No list rate</div>}
                        {low && <div className="mt-1 text-xs text-amber-700">Below list {list}</div>}
                      </TD>
                      <TD className="num text-right">{t.taxable > 0 ? formatINR(t.taxable) : "—"}</TD>
                      <TD className="text-right">
                        <button
                          aria-label={`Remove ${it.name}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </TD>
                    </TR>
                  );
                })}
              </tbody>
            </Table>
            <div className="border-t border-slate-100 p-4">
              <ItemPicker items={items} exclude={lines.map((l) => l.itemId)} rateOf={listRate} onPick={(id) => addItem(id)} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="lg:sticky lg:top-4">
            <CardHeader title="Total" />
            <CardBody className="space-y-2 text-sm">
              <Row label="Items" value={formatNumber(lines.length)} />
              <Row label="Weight" value={totals.kg > 0 ? formatKg(totals.kg) : "—"} />
              <Row label="Taxable" value={formatINR(totals.taxable)} />
              {firm?.gst_registered && <Row label="GST" value={formatINR(totals.gst)} />}
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 text-base font-semibold">
                <span>Order total</span>
                <span className="num">{formatINR(totals.amount)}</span>
              </div>
              {totals.discount > 0 && <p className="text-xs text-amber-700">Below list by {formatINR(totals.discount)}: needs a discount approval.</p>}

              {credit && (
                <div className={cn("rounded-lg p-3 text-xs", credit.ok ? "bg-brand-50 text-brand-900" : "bg-red-50 text-red-800")}>
                  <Badge tone={credit.ok ? "green" : "red"}>{credit.ok ? "Credit OK" : "Needs credit approval"}</Badge>
                  {credit.reasons.map((r) => (
                    <div key={r.code} className="mt-1">
                      {r.text}
                    </div>
                  ))}
                  <div className="mt-1 text-slate-600">
                    Outstanding {formatINR(credit.outstanding ?? 0)}
                    {credit.available != null && <> · available {formatINR(credit.available)}</>}
                  </div>
                  {!credit.terms_set && <div className="mt-1 text-amber-700">No credit terms set for this customer.</div>}
                </div>
              )}
              {source === "counter" && <p className="text-xs text-slate-500">Counter cash sale: no credit check.</p>}

              <Field label="Note (optional)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
              </Field>
              <Button className="w-full" disabled={pending || !customer || lines.length === 0} onClick={submit}>
                {(credit && !credit.ok) || belowList ? "Submit for approval" : "Place order"}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function CustomerPicker({ value, onChange }: { value: CustomerHit | null; onChange: (c: CustomerHit | null) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void searchCustomers(q).then((r) => live && setHits(r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm">
        <span className="truncate font-medium">
          {value.name}
          <span className="ml-2 text-xs font-normal text-slate-500">{value.beat ?? "No beat"}</span>
          {value.status === "bad_debt" && (
            <Badge tone="red" className="ml-2">
              bad debt
            </Badge>
          )}
        </span>
        <button className="text-xs text-brand-700 underline" onClick={() => onChange(null)}>
          Change
        </button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input placeholder="Type 2+ letters" value={q} onFocus={() => setOpen(true)} onChange={(e) => (setQ(e.target.value), setOpen(true))} />
      {open && hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                onChange(c);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
            >
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-slate-500">{c.beat ?? "No beat"}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemPicker({
  items, exclude, rateOf, onPick,
}: {
  items: ItemOption[];
  exclude: string[];
  rateOf: (id: string) => number | null;
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return items.filter((i) => !exclude.includes(i.id) && words.every((w) => i.name.toLowerCase().includes(w))).slice(0, 12);
  }, [q, items, exclude]);
  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        <Plus className="h-4 w-4 text-slate-400" />
        <Input ref={ref} placeholder="Add item: type part of the name, e.g. lion 250" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {hits.length > 0 && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {hits.map((i) => {
            const r = rateOf(i.id);
            return (
              <button
                key={i.id}
                onClick={() => {
                  onPick(i.id);
                  setQ("");
                }}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium">{i.name}</span>
                <span className="num text-xs text-slate-500">{r ? `${formatINR(r)} / ${i.unit}` : "no rate"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
