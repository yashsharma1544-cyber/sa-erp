"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardPaste, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatINR, formatKg, formatNumber } from "@/lib/format";
import { lineTotals, orderTotals } from "@/lib/orders/math";
import { parseOrderMessage, prepareItems } from "@/lib/orders/parse";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { checkCredit, type CreditCheck } from "../../credit/actions";
import { createOrder, learnItemAliases, searchCustomers, usualItems, type CustomerHit, type UsualItem } from "../actions";

type Firm = { id: string; code: string; name: string; gst_registered: boolean };
export type ItemOption = {
  id: string; name: string; unit: string; kgPerUnit: number; gstRate: number; category: string;
  aliases: string[]; popularity: number;
};
// Pasted lines keep what the message said, so the office can check it and corrections can be learnt.
type Pasted = { raw: string; text: string; suggested: string | null; candidates: string[]; note: string | null; confidence: "high" | "low" | "none" };
type Line = { key: string; itemId: string; qty: string; rate: string; pasted?: Pasted };

const newId = () => crypto.randomUUID();

export function NewOrderClient({
  firms, items, rates, today, startWithPaste = false,
}: {
  firms: Firm[];
  items: ItemOption[];
  rates: Record<string, Record<string, number>>;
  today: string;
  startWithPaste?: boolean;
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
  const [customerHint, setCustomerHint] = useState("");
  const [showPaste, setShowPaste] = useState(startWithPaste);
  const [message, setMessage] = useState("");
  const prepared = useMemo(
    () => prepareItems(items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, kgPerUnit: i.kgPerUnit, aliases: i.aliases, popularity: i.popularity }))),
    [items],
  );

  const readMessage = () => {
    const m = parseOrderMessage(message, prepared);
    if (m.lines.length === 0) return setError("No item lines found in the message.");
    setError(null);
    setSource("whatsapp_paste");
    if (!customer && m.customerHint) setCustomerHint(m.customerHint);
    setLines((ls) => [
      ...ls,
      ...m.lines.map((l, i, all) => {
        // An item already on the order (or twice in the message) is left for the office to pick.
        const taken = !!l.itemId && (ls.some((x) => x.itemId === l.itemId) || all.slice(0, i).some((y) => y.itemId === l.itemId));
        return {
          key: newId(),
          itemId: taken ? "" : (l.itemId ?? ""),
          qty: l.qty === null ? "" : String(l.qty),
          rate: "",
          pasted: { raw: l.raw, text: l.text, suggested: l.itemId, candidates: l.candidates, note: l.note, confidence: l.confidence },
        };
      }),
    ]);
    setShowPaste(false);
    setMessage("");
  };

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
      const it = l.itemId ? itemById.get(l.itemId) : undefined;
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
    if (lines.some((l) => !l.itemId)) return setError("Pick the item for every line, or remove the lines you don't need.");
    if (lines.some((l) => !(Number(l.qty) > 0))) return setError("Enter a quantity on every line.");
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
      // Remember the wording of pasted lines the office had to fix or confirm.
      const learn = lines
        .filter((l) => l.pasted && l.pasted.text && (l.itemId !== l.pasted.suggested || l.pasted.confidence !== "high"))
        .map((l) => ({ itemId: l.itemId, text: l.pasted!.text }));
      if (learn.length) await learnItemAliases(learn);
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
            {!showPaste ? (
              <CardBody>
                <Button variant="secondary" onClick={() => setShowPaste(true)}>
                  <ClipboardPaste className="h-4 w-4" /> Paste a WhatsApp order
                </Button>
              </CardBody>
            ) : (
              <CardBody className="space-y-3">
                <Field label="WhatsApp message" hint="Paste the whole message, Marathi or English. Each line becomes an order line for you to check.">
                  <textarea
                    autoFocus
                    rows={7}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                    placeholder={"Om Sai Kirana Lonar\nलायन 250 - 5 किलो\nvikram dust 10 rs 20 pkt\nvinayak 15 ltr jar 2"}
                  />
                </Field>
                <div className="flex gap-2">
                  <Button onClick={readMessage} disabled={!message.trim()}>
                    Read message
                  </Button>
                  <Button variant="ghost" onClick={() => setShowPaste(false)}>
                    Close
                  </Button>
                </div>
              </CardBody>
            )}
          </Card>

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
                <CustomerPicker value={customer} onChange={setCustomer} hint={customerHint} />
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
                  const it = l.itemId ? itemById.get(l.itemId) : undefined;
                  if (!it) {
                    return (
                      <TR key={l.key} className="bg-amber-50/60">
                        <TD colSpan={4}>
                          <div className="mb-2 text-sm">
                            <Badge tone="amber">Not matched</Badge> <span className="text-slate-600">“{l.pasted?.raw}”</span>
                          </div>
                          <ItemPicker
                            items={items}
                            exclude={lines.map((x) => x.itemId)}
                            rateOf={listRate}
                            onPick={(id) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: id } : x)))}
                          />
                        </TD>
                        <TD className="text-right">
                          <button
                            aria-label="Remove line"
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                            onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </TD>
                      </TR>
                    );
                  }
                  const list = listRate(l.itemId);
                  const rate = Number(l.rate || list || 0);
                  const t = lineTotals({ qty: Number(l.qty) || 0, rate, listRate: list, gstRate: it.gstRate, kgPerUnit: it.kgPerUnit }, !!firm?.gst_registered);
                  const low = list !== null && l.rate !== "" && Number(l.rate) < list;
                  return (
                    <TR key={l.key} className={l.pasted && l.pasted.confidence !== "high" && l.itemId === l.pasted.suggested ? "bg-amber-50/60" : undefined}>
                      <TD>
                        {l.pasted && l.pasted.candidates.length > 1 ? (
                          <Select
                            className="h-9 font-medium"
                            value={l.itemId}
                            onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, itemId: e.target.value, rate: "" } : x)))}
                          >
                            {[...new Set([l.itemId, ...l.pasted.candidates])].map((id) => (
                              <option key={id} value={id}>
                                {itemById.get(id)?.name ?? id}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <div className="font-medium text-slate-900">{it.name}</div>
                        )}
                        <div className="text-xs text-slate-500">
                          per {it.unit}
                          {t.kg > 0 && it.unit !== "kg" && <> · {formatKg(t.kg)}</>}
                        </div>
                        {l.pasted && (
                          <div className="mt-1 text-xs text-slate-500">
                            {l.pasted.confidence !== "high" && l.itemId === l.pasted.suggested && <Badge tone="amber" className="mr-1">check</Badge>}
                            “{l.pasted.raw}”{l.pasted.note && <span className="text-amber-700"> · {l.pasted.note}</span>}
                          </div>
                        )}
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

function CustomerPicker({ value, onChange, hint }: { value: CustomerHit | null; onChange: (c: CustomerHit | null) => void; hint?: string }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // A pasted message's first line is usually the shop name: search for it.
  useEffect(() => {
    if (hint) {
      setQ(hint.split(/\s+/).slice(0, 2).join(" "));
      setOpen(true);
    }
  }, [hint]);
  const [hits, setHits] = useState<CustomerHit[]>([]);
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
