"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, HandCoins, IndianRupee, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatINR, formatNumber } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { CollectionLine, CollectorRow, DueRow, Firm, PromiseRow } from "./dashboard-types";

type Tab = "collectors" | "territories" | "beats";
const n = (v: string | number | null | undefined) => Number(v ?? 0);
const rs = (v: number) => (v === 0 ? "—" : formatINR(v).replace(/\.\d\d$/, ""));
const MODE_LABEL: Record<CollectionLine["mode"], string> = { cash: "Cash", upi: "UPI", cheque: "Cheque", bank: "Bank", tally: "In Tally" };
const OFFICE = "__office__";

type Group = { key: string; name: string; today: number; jc: number; balance: number; overdue: number; b60: number; customers: number };

function group(lines: CollectionLine[], due: DueRow[], today: string, keyOf: (x: { beat_id: string | null; beat_name: string | null; territory_name: string | null }) => [string, string]) {
  const m = new Map<string, Group>();
  const get = (k: string, name: string) => {
    let g = m.get(k);
    if (!g) m.set(k, (g = { key: k, name, today: 0, jc: 0, balance: 0, overdue: 0, b60: 0, customers: 0 }));
    return g;
  };
  for (const l of lines) {
    const [k, name] = keyOf(l);
    const g = get(k, name);
    g.jc += n(l.amount);
    if (l.collected_on === today) g.today += n(l.amount);
  }
  for (const d of due) {
    const [k, name] = keyOf(d);
    const g = get(k, name);
    g.balance += d.balance;
    g.overdue += d.overdue;
    g.b60 += d.b60_plus;
    g.customers++;
  }
  return [...m.values()].sort((a, b) => b.overdue - a.overdue || b.balance - a.balance);
}

export function OwnerDashboard({
  firms, jc, lines, collectors, due, promises, lastSyncAt, today, jcDayNo,
}: {
  firms: Firm[];
  jc: { label: string; start: string; end: string } | null;
  lines: CollectionLine[];
  collectors: CollectorRow[];
  due: DueRow[];
  promises: PromiseRow[];
  lastSyncAt: string | null;
  today: string;
  jcDayNo: number;
}) {
  const [firm, setFirm] = useState<string>("");
  const [tab, setTab] = useState<Tab>("collectors");

  const L = useMemo(() => lines.filter((l) => !firm || l.firm_id === firm), [lines, firm]);
  const D = useMemo(() => due.filter((d) => !firm || d.firm_id === firm), [due, firm]);
  const P = useMemo(() => promises.filter((p) => !firm || p.firm_id === firm), [promises, firm]);

  const k = useMemo(() => {
    const t = { today: 0, todayErp: 0, todayTally: 0, todayReceipts: 0, jc: 0, balance: 0, overdue: 0, b60: 0, modes: {} as Record<string, number> };
    for (const l of L) {
      const a = n(l.amount);
      t.jc += a;
      if (l.collected_on !== today) continue;
      t.today += a;
      t.todayReceipts += l.receipts;
      if (l.source === "erp") t.todayErp += a;
      else t.todayTally += a;
      t.modes[l.mode] = (t.modes[l.mode] ?? 0) + a;
    }
    for (const d of D) {
      t.balance += d.balance;
      t.overdue += d.overdue;
      t.b60 += d.b60_plus;
    }
    return t;
  }, [L, D, today]);

  // Paid today per customer+firm, to show which promises came good.
  const paidToday = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) if (l.collected_on === today && l.customer_id) m.set(`${l.firm_id}:${l.customer_id}`, (m.get(`${l.firm_id}:${l.customer_id}`) ?? 0) + n(l.amount));
    return m;
  }, [lines, today]);
  const promisesAmt = P.reduce((s, p) => s + n(p.amount), 0);
  const promisesKept = P.filter((p) => (paidToday.get(`${p.firm_id}:${p.customer_id}`) ?? 0) >= n(p.amount)).length;

  const collectorRows = useMemo(() => {
    const byId = new Map<string, { today: number; jc: number; receipts: number }>();
    for (const l of L) {
      const id = l.source === "tally" ? OFFICE : (l.collector_id ?? OFFICE);
      const r = byId.get(id) ?? { today: 0, jc: 0, receipts: 0 };
      r.jc += n(l.amount);
      if (l.collected_on === today) {
        r.today += n(l.amount);
        r.receipts += l.receipts;
      }
      byId.set(id, r);
    }
    const rows = collectors.map((c) => ({ ...c, ...(byId.get(c.collector_id) ?? { today: 0, jc: 0, receipts: 0 }) }));
    rows.sort((a, b) => b.today - a.today || b.jc - a.jc || a.collector_name.localeCompare(b.collector_name));
    return { rows, office: byId.get(OFFICE) ?? { today: 0, jc: 0, receipts: 0 } };
  }, [L, collectors, today]);

  const territories = useMemo(() => group(L, D, today, (x) => [x.territory_name ?? "", x.territory_name ?? "No territory"]), [L, D, today]);
  const beats = useMemo(() => group(L, D, today, (x) => [x.beat_id ?? "", x.beat_name ?? "No beat"]), [L, D, today]);
  const jcDays = jc ? Math.max(jcDayNo, 1) : 1;

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[{ id: "", code: "", name: "Both firms" }, ...firms].map((f) => (
            <button
              key={f.id || "all"}
              onClick={() => setFirm(f.id)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium",
                f.id === firm ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
              )}
            >
              {f.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">
          ERP receipts plus Tally receipts not matched to one{lastSyncAt && <> · Tally synced {formatDateTime(lastSyncAt)}</>}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="brand"
          label="Collected today"
          icon={<Wallet className="h-4 w-4" />}
          value={formatINR(k.today).replace(/\.\d\d$/, "")}
          sub={`${formatNumber(k.todayReceipts)} receipts · field ${rs(k.todayErp)} · Tally ${rs(k.todayTally)}`}
        />
        <StatCard
          label={jc ? `Collected in ${jc.label}` : "Collected this JC"}
          icon={<HandCoins className="h-4 w-4" />}
          value={formatINR(k.jc).replace(/\.\d\d$/, "")}
          sub={jc ? `Day ${jcDayNo} · about ${rs(Math.round(k.jc / jcDays))} a day` : "No JC for today"}
        />
        <Link href="/receivables" className="block transition hover:-translate-y-0.5">
          <StatCard
            label="To collect"
            icon={<IndianRupee className="h-4 w-4" />}
            value={formatINR(k.balance).replace(/\.\d\d$/, "")}
            sub={`Overdue ${rs(k.overdue)} · 60+ days ${rs(k.b60)}`}
          />
        </Link>
        <StatCard
          label="Promises due today"
          icon={<CalendarCheck className="h-4 w-4" />}
          value={formatNumber(P.length)}
          sub={P.length ? `${rs(promisesAmt)} · ${promisesKept} paid so far` : "None due"}
        />
      </div>

      {k.today > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {Object.entries(k.modes)
            .sort((a, b) => b[1] - a[1])
            .map(([m, v]) => (
              <span key={m} className="rounded-full bg-white px-3 py-1 text-slate-600 ring-1 ring-slate-200">
                {MODE_LABEL[m as CollectionLine["mode"]]} <span className="num font-medium text-slate-900">{rs(v)}</span>
              </span>
            ))}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
          {(["collectors", "territories", "beats"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn("rounded-full px-3 py-1 text-sm capitalize", t === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
            >
              By {t === "collectors" ? "collector" : t === "territories" ? "territory" : "beat"}
            </button>
          ))}
        </div>

        {tab === "collectors" ? (
          <Table>
            <THead>
              <tr>
                <TH>Collector</TH>
                <TH className="text-right">Today</TH>
                <TH className="text-right">This JC</TH>
                <TH className="text-right">Cash in hand</TH>
                <TH className="text-right">Promises today</TH>
                <TH className="text-right">Visits today</TH>
                <TH className="text-right">Overdue in their beats</TH>
              </tr>
            </THead>
            <tbody>
              {collectorRows.rows.map((c) => (
                <TR key={c.collector_id}>
                  <TD>
                    <div className="font-medium text-slate-900">{c.collector_name}</div>
                    <div className="text-xs text-slate-500">
                      {c.collection_beats?.length ? c.collection_beats.join(", ") : "No collection beats yet"}
                      {c.last_activity_at && <> · last {formatDateTime(c.last_activity_at)}</>}
                    </div>
                  </TD>
                  <TD className="num text-right">
                    {rs(c.today)}
                    {c.receipts > 0 && <div className="text-xs text-slate-500">{c.receipts} receipts</div>}
                  </TD>
                  <TD className="num text-right">{rs(c.jc)}</TD>
                  <TD className="num text-right">
                    {rs(n(c.cash_in_hand))}
                    {c.oldest_cash && c.oldest_cash < today && <div className="text-xs text-amber-700">since {c.oldest_cash.slice(8)}/{c.oldest_cash.slice(5, 7)}</div>}
                  </TD>
                  <TD className="num text-right">{c.promises_today ? `${c.promises_today} · ${rs(n(c.promises_today_amount))}` : "—"}</TD>
                  <TD className="num text-right">{c.visits_today || "—"}</TD>
                  <TD className="num text-right">
                    {rs(n(c.beats_overdue))}
                    {n(c.beats_outstanding) > 0 && <div className="text-xs text-slate-500">of {rs(n(c.beats_outstanding))}</div>}
                  </TD>
                </TR>
              ))}
              <TR className="bg-slate-50/60">
                <TD>
                  <div className="font-medium text-slate-900">Office / Tally</div>
                  <div className="text-xs text-slate-500">Receipts entered in Tally with no ERP receipt</div>
                </TD>
                <TD className="num text-right">
                  {rs(collectorRows.office.today)}
                  {collectorRows.office.receipts > 0 && <div className="text-xs text-slate-500">{collectorRows.office.receipts} receipts</div>}
                </TD>
                <TD className="num text-right">{rs(collectorRows.office.jc)}</TD>
                <TD colSpan={4} />
              </TR>
            </tbody>
          </Table>
        ) : (
          <GroupTable rows={tab === "territories" ? territories : beats} label={tab === "territories" ? "Territory" : "Beat"} />
        )}
      </Card>

      <Card>
        <CardHeader title="Promises due today" description="Open promises for today. Paid means today's collections from that customer cover the promise." />
        <Table>
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH>Promised to</TH>
              <TH className="text-right">Amount</TH>
              <TH className="text-right">Paid today</TH>
            </tr>
          </THead>
          <tbody>
            {P.length === 0 && <EmptyRow colSpan={4}>No promises due today.</EmptyRow>}
            {P.map((p) => {
              const paid = paidToday.get(`${p.firm_id}:${p.customer_id}`) ?? 0;
              return (
                <TR key={p.id}>
                  <TD>
                    <Link href={`/customers/${p.customer_id}`} className="font-medium text-slate-900 hover:underline">
                      {p.customer_name}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500">
                      {firms.find((f) => f.id === p.firm_id)?.code} · {p.beat_name ?? "No beat"}
                    </span>
                    {p.note && <div className="text-xs text-slate-500">{p.note}</div>}
                  </TD>
                  <TD>{p.made_to_name}</TD>
                  <TD className="num text-right">{rs(n(p.amount))}</TD>
                  <TD className="num text-right">
                    {paid >= n(p.amount) ? <Badge tone="green">{rs(paid)}</Badge> : paid > 0 ? <Badge tone="amber">{rs(paid)}</Badge> : "—"}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </section>
  );
}

function GroupTable({ rows, label }: { rows: Group[]; label: string }) {
  return (
    <Table>
      <THead>
        <tr>
          <TH>{label}</TH>
          <TH className="text-right">Today</TH>
          <TH className="text-right">This JC</TH>
          <TH className="text-right">To collect</TH>
          <TH className="text-right">Overdue</TH>
          <TH className="text-right">60+ days</TH>
        </tr>
      </THead>
      <tbody>
        {rows.length === 0 && <EmptyRow colSpan={6}>Nothing to show.</EmptyRow>}
        {rows.map((g) => (
          <TR key={g.key || "none"}>
            <TD>
              <div className="font-medium text-slate-900">{g.name}</div>
              {g.customers > 0 && <div className="text-xs text-slate-500">{formatNumber(g.customers)} customers owe</div>}
            </TD>
            <TD className="num text-right">{rs(g.today)}</TD>
            <TD className="num text-right">{rs(g.jc)}</TD>
            <TD className="num text-right">{rs(g.balance)}</TD>
            <TD className={cn("num text-right", g.overdue > 0 && "font-medium text-red-700")}>{rs(g.overdue)}</TD>
            <TD className="num text-right">{rs(g.b60)}</TD>
          </TR>
        ))}
      </tbody>
    </Table>
  );
}
