"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Download, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input, Select } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getBills, getDso, type Dso } from "./actions";
import { sectionOf, type ArBill, type ArCustomer, type Section } from "./types";

type Firm = { id: string; code: string; name: string };
export type Period = { key: string; label: string; from: string; to: string };
type SortKey = "balance" | "b60_plus" | "overdue" | "oldest" | "name";

const BUCKETS = [
  { key: "b0_15", label: "0–15" },
  { key: "b16_30", label: "16–30" },
  { key: "b31_45", label: "31–45" },
  { key: "b46_60", label: "46–60" },
  { key: "b60_plus", label: "60+" },
] as const;

const SECTIONS: { key: Section; label: string }[] = [
  { key: "working", label: "Outstanding" },
  { key: "parked", label: "Bad debt & ignore" },
  { key: "advance", label: "Advances" },
];

const n = (v: string | number | null | undefined) => Number(v ?? 0);
const amount = (v: string | number | null | undefined) => (n(v) === 0 ? "—" : formatINR(n(v)).replace(/\.00$/, ""));
const name = (c: ArCustomer) => c.customer_name ?? c.ledger_name;

export function ReceivablesClient({
  firms,
  firm,
  rows,
  periods,
  initialDso,
  lastSyncAt,
  today,
}: {
  firms: Firm[];
  firm: Firm;
  rows: ArCustomer[];
  periods: Period[];
  initialDso: Dso | null;
  lastSyncAt: string | null;
  today: string;
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("working");
  const [query, setQuery] = useState("");
  const [territory, setTerritory] = useState("");
  const [beat, setBeat] = useState("");
  const [onlyUnmatched, setOnlyUnmatched] = useState(false);
  const [sort, setSort] = useState<SortKey>("balance");
  const [open, setOpen] = useState<Record<string, ArBill[] | "loading" | { error: string }>>({});
  const [limit, setLimit] = useState(200);

  const working = useMemo(() => rows.filter((r) => sectionOf(r) === "working"), [rows]);
  const totals = useMemo(() => {
    const t = { balance: 0, overdue: 0, b0_15: 0, b16_30: 0, b31_45: 0, b46_60: 0, b60_plus: 0, unmatched: 0, unmatchedAmt: 0, noCredit: 0 };
    for (const r of working) {
      t.balance += n(r.balance);
      t.overdue += n(r.overdue);
      for (const b of BUCKETS) t[b.key] += n(r[b.key]);
      if (!r.customer_id) {
        t.unmatched++;
        t.unmatchedAmt += n(r.balance);
      }
      if (r.customer_id && !r.credit_days) t.noCredit++;
    }
    return t;
  }, [working]);
  const counts = useMemo(() => {
    const c: Record<Section, number> = { working: 0, parked: 0, advance: 0 };
    for (const r of rows) c[sectionOf(r)]++;
    return c;
  }, [rows]);

  const territories = useMemo(() => uniq(rows.map((r) => r.territory_name)), [rows]);
  const beats = useMemo(
    () => uniq(rows.filter((r) => !territory || r.territory_name === territory).map((r) => r.beat_name)),
    [rows, territory],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        sectionOf(r) === section &&
        (!territory || r.territory_name === territory) &&
        (!beat || r.beat_name === beat) &&
        (!onlyUnmatched || !r.customer_id) &&
        (!q || name(r).toLowerCase().includes(q) || r.ledger_name.toLowerCase().includes(q)),
    );
    const by: Record<SortKey, (a: ArCustomer, b: ArCustomer) => number> = {
      balance: (a, b) => (section === "advance" ? n(a.balance) - n(b.balance) : n(b.balance) - n(a.balance)),
      b60_plus: (a, b) => n(b.b60_plus) - n(a.b60_plus),
      overdue: (a, b) => n(b.overdue) - n(a.overdue),
      oldest: (a, b) => (a.oldest_bill_date ?? "0000").localeCompare(b.oldest_bill_date ?? "0000"),
      name: (a, b) => name(a).localeCompare(name(b)),
    };
    return list.sort(by[sort]);
  }, [rows, section, territory, beat, onlyUnmatched, query, sort]);
  const shownTotal = useMemo(() => shown.reduce((s, r) => s + n(r.balance), 0), [shown]);

  const toggle = async (r: ArCustomer) => {
    if (open[r.ledger_key]) {
      setOpen((o) => {
        const rest = { ...o };
        delete rest[r.ledger_key];
        return rest;
      });
      return;
    }
    setOpen((o) => ({ ...o, [r.ledger_key]: "loading" }));
    const res = await getBills(firm.id, r.ledger_key);
    setOpen((o) => ({ ...o, [r.ledger_key]: res.bills ?? { error: res.error ?? "Could not load bills" } }));
  };

  const snapshot = rows.find((r) => r.snapshot_date)?.snapshot_date ?? null;
  const sinceCount = rows.reduce((s, r) => s + (r.vouchers_since ?? 0), 0);
  const exportHref = (kind: "customers" | "bills") => `/receivables/export?firm=${firm.code}&kind=${kind}&section=${section}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receivables"
        description={
          <>
            Tally balances as on {snapshot ? formatDate(snapshot) : "—"}
            {sinceCount > 0 && <> plus {formatNumber(sinceCount)} vouchers since</>}
            {lastSyncAt && <> · synced {formatDateTime(lastSyncAt)}</>}. Bills are matched newest first, because Tally
            doesn&apos;t send which bill a payment cleared.
          </>
        }
        actions={
          <div className="flex gap-2 print:hidden">
            <a href={exportHref("customers")}>
              <Button variant="secondary" size="sm">
                <Download className="h-4 w-4" /> Excel
              </Button>
            </a>
            <a href={exportHref("bills")}>
              <Button variant="secondary" size="sm">
                <Download className="h-4 w-4" /> Bill-wise
              </Button>
            </a>
            <Button variant="secondary" size="sm" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> PDF
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2 print:hidden">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => router.push(`/receivables?firm=${f.code}`)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              f.id === firm.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.name}
          </button>
        ))}
      </div>
      <h2 className="hidden text-lg font-semibold print:block">
        {firm.name} · {formatDate(today)}
      </h2>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard tone="brand" label="Outstanding" value={formatINR(totals.balance)} sub={`${formatNumber(counts.working)} customers`} />
        <StatCard
          label="Overdue"
          value={formatINR(totals.overdue)}
          sub={totals.noCredit > 0 ? `${formatNumber(totals.noCredit)} customers have no credit days yet` : "Past credit days"}
        />
        <StatCard label="Over 60 days" value={formatINR(totals.b60_plus)} sub={pct(totals.b60_plus, totals.balance)} />
        <DsoCard firmId={firm.id} periods={periods} initial={initialDso} />
      </div>

      <Card className="p-5">
        <div className="mb-3 text-sm font-medium text-slate-500">Ageing by bill date (days)</div>
        <div className="grid grid-cols-5 gap-2">
          {BUCKETS.map((b) => (
            <div key={b.key}>
              <div className="text-xs text-slate-500">{b.label}</div>
              <div className="num text-sm font-semibold text-slate-900 sm:text-base">{formatINR(totals[b.key]).replace(/\.\d\d$/, "")}</div>
              <div className="mt-1.5 h-1.5 rounded-full bg-slate-100">
                <div
                  className={cn("h-1.5 rounded-full", b.key === "b60_plus" ? "bg-red-500" : b.key === "b46_60" ? "bg-amber-500" : "bg-brand-600")}
                  style={{ width: `${totals.balance ? Math.min(100, (totals[b.key] / totals.balance) * 100) : 0}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {totals.unmatched > 0 && (
        <Alert kind="info">
          {formatNumber(totals.unmatched)} Tally ledgers ({formatINR(totals.unmatchedAmt)}) are not matched to a customer yet. Match
          them on Import from Tally so they get a beat and a collector.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 print:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cn(
              "rounded-full px-3 py-1 text-sm",
              s.key === section ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {s.label} <span className="opacity-70">{formatNumber(counts[s.key])}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 print:hidden">
        <div className="lg:col-span-2">
          <SearchInput placeholder="Search customer or ledger" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <Select
          value={territory}
          onChange={(e) => {
            setTerritory(e.target.value);
            setBeat("");
          }}
        >
          <option value="">All territories</option>
          {territories.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
        <Select value={beat} onChange={(e) => setBeat(e.target.value)}>
          <option value="">All beats</option>
          {beats.map((b) => (
            <option key={b}>{b}</option>
          ))}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          <option value="balance">Sort: outstanding</option>
          <option value="b60_plus">Sort: over 60 days</option>
          <option value="overdue">Sort: overdue</option>
          <option value="oldest">Sort: oldest bill</option>
          <option value="name">Sort: name</option>
        </Select>
      </div>
      {totals.unmatched > 0 && (
        <label className="flex items-center gap-2 text-sm text-slate-600 print:hidden">
          <input type="checkbox" checked={onlyUnmatched} onChange={(e) => setOnlyUnmatched(e.target.checked)} />
          Only ledgers not matched to a customer
        </label>
      )}

      <Card>
        <Table>
          <THead>
            <tr>
              <TH className="w-8 print:hidden" />
              <TH>Customer</TH>
              <TH className="text-right">Outstanding</TH>
              {BUCKETS.map((b) => (
                <TH key={b.key} className="hidden text-right lg:table-cell print:table-cell">
                  {b.label}
                </TH>
              ))}
              <TH className="hidden text-right md:table-cell">Overdue</TH>
              <TH className="hidden md:table-cell">Last receipt</TH>
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={10}>Nothing here.</EmptyRow>}
            {shown.slice(0, limit).map((r) => {
              const o = open[r.ledger_key];
              return (
                <Fragment key={r.ledger_key}>
                  <TR className="cursor-pointer hover:bg-slate-50" onClick={() => toggle(r)}>
                    <TD className="print:hidden">
                      {o ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
                    </TD>
                    <TD>
                      <div className="font-medium text-slate-900">{name(r)}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        {r.beat_name ? <span>{r.beat_name}</span> : r.customer_id && <span className="text-amber-700">No beat</span>}
                        {!r.customer_id && <Badge tone="amber">Not matched</Badge>}
                        {r.status === "bad_debt" && <Badge tone="red">Bad debt</Badge>}
                        {r.status === "ignore" && <Badge>Ignore</Badge>}
                        {r.customer_name && r.customer_name !== r.ledger_name && <span>· Tally: {r.ledger_name}</span>}
                      </div>
                    </TD>
                    <TD className="num whitespace-nowrap text-right font-semibold text-slate-900">{formatINR(Math.abs(n(r.balance)))}</TD>
                    {BUCKETS.map((b) => (
                      <TD
                        key={b.key}
                        className={cn(
                          "num hidden whitespace-nowrap text-right lg:table-cell print:table-cell",
                          b.key === "b60_plus" && n(r.b60_plus) > 0 && "text-red-700",
                        )}
                      >
                        {amount(r[b.key])}
                      </TD>
                    ))}
                    <TD className="num hidden whitespace-nowrap text-right md:table-cell">{amount(r.overdue)}</TD>
                    <TD className="hidden whitespace-nowrap text-sm md:table-cell">
                      {r.last_receipt_date ? formatDate(r.last_receipt_date) : <span className="text-slate-400">none</span>}
                    </TD>
                  </TR>
                  {o && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={10} className="px-4 py-3">
                        <BillList state={o} customer={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
                <td className="print:hidden" />
                <td className="px-4 py-2.5">
                  {formatNumber(shown.length)} {shown.length === 1 ? "customer" : "customers"}
                </td>
                <td className="num px-4 py-2.5 text-right">{formatINR(Math.abs(shownTotal))}</td>
                <td colSpan={7} />
              </tr>
            </tfoot>
          )}
        </Table>
        {shown.length > limit && (
          <div className="border-t border-slate-100 px-4 py-3 text-sm print:hidden">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + 300)}>
              Show more ({formatNumber(shown.length - limit)} left)
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

function BillList({ state, customer }: { state: ArBill[] | "loading" | { error: string }; customer: ArCustomer }) {
  if (state === "loading") return <p className="text-sm text-slate-500">Loading bills…</p>;
  if (!Array.isArray(state)) return <p className="text-sm text-red-700">{state.error}</p>;
  if (Number(customer.balance) <= 0)
    return <p className="text-sm text-slate-500">Credit balance of {formatINR(-Number(customer.balance))}. Nothing to collect.</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
        <span>Tally balance {formatINR(customer.tally_balance)}</span>
        {Number(customer.movement) !== 0 && <span>Since then {formatINR(customer.movement)}</span>}
        <span>Credit {customer.credit_days ? `${customer.credit_days} days` : "days not set"}</span>
        {customer.last_sale_date && <span>Last bill {formatDate(customer.last_sale_date)}</span>}
        {customer.whatsapp && <span>WhatsApp {customer.whatsapp}</span>}
      </div>
      <table className="w-full max-w-2xl text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1 pr-4 font-medium">Bill</th>
            <th className="py-1 pr-4 font-medium">Date</th>
            <th className="py-1 pr-4 text-right font-medium">Days</th>
            <th className="py-1 pr-4 text-right font-medium">Bill amount</th>
            <th className="py-1 text-right font-medium">Pending</th>
          </tr>
        </thead>
        <tbody>
          {state.map((b) => (
            <tr key={b.bill_key} className="border-t border-slate-200/70">
              <td className="py-1.5 pr-4">
                {b.kind === "older" ? (
                  <span className="text-slate-600">Older than our records (before April 2025)</span>
                ) : (
                  <>
                    {b.bill_no ?? "—"}
                    {b.kind === "debit_note" && <span className="ml-1 text-xs text-slate-500">debit note</span>}
                  </>
                )}
              </td>
              <td className="py-1.5 pr-4 whitespace-nowrap">{b.bill_date ? formatDate(b.bill_date) : "—"}</td>
              <td className={cn("num py-1.5 pr-4 text-right", b.overdue && "text-red-700")}>{b.days ?? "60+"}</td>
              <td className="num py-1.5 pr-4 text-right">{b.bill_amount ? formatINR(b.bill_amount) : "—"}</td>
              <td className="num py-1.5 text-right font-medium">{formatINR(b.pending)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DsoCard({ firmId, periods, initial }: { firmId: string; periods: Period[]; initial: Dso | null }) {
  const [key, setKey] = useState(periods[0]?.key ?? "custom");
  const [from, setFrom] = useState(periods[0]?.from ?? "");
  const [to, setTo] = useState(periods[0]?.to ?? "");
  const [dso, setDso] = useState<Dso | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = (f: string, t: string) =>
    start(async () => {
      const r = await getDso({ firmId, from: f, to: t });
      setError(r.error ?? null);
      if (r.dso) setDso(r.dso);
    });

  const pick = (k: string) => {
    setKey(k);
    const p = periods.find((x) => x.key === k);
    if (p) {
      setFrom(p.from);
      setTo(p.to);
      load(p.from, p.to);
    }
  };

  return (
    <StatCard
      label="DSO"
      value={pending ? "…" : dso?.dso != null ? `${formatNumber(Number(dso.dso), 1)} days` : "—"}
      sub={dso ? `Credit sales ${formatINR(dso.credit_sales).replace(/\.\d\d$/, "")} in ${dso.days} days` : undefined}
      footer={
        <div className="space-y-2 print:hidden">
          <Select value={key} onChange={(e) => pick(e.target.value)}>
            {periods.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
            <option value="custom">Date range…</option>
          </Select>
          {key === "custom" && (
            <div className="flex gap-2">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={pending || !from || !to} onClick={() => load(from, to)}>
                Go
              </Button>
            </div>
          )}
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      }
    />
  );
}

function uniq(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort();
}

function pct(part: number, whole: number) {
  return whole ? `${formatNumber((part / whole) * 100, 1)}% of outstanding` : "";
}
