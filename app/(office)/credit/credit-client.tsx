"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatINR, formatNumber, todayIST } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input, Select } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { setCreditTerms } from "./actions";

type Firm = { id: string; code: string; name: string };
export type TermsRow = {
  customer_id: string;
  customer_name: string;
  status: "active" | "bad_debt" | "ignore";
  customer_type: string;
  beat_name: string | null;
  territory_name: string | null;
  has_account: boolean;
  credit_limit: number | string;
  credit_days: number;
  outstanding: number | string;
  oldest_bill_date: string | null;
  sales_90d: number | string;
};
type TermsFilter = "all" | "unset" | "set" | "over";

const n = (v: string | number | null | undefined) => Number(v ?? 0);
const rupees = (v: string | number) => (n(v) === 0 ? "—" : formatINR(n(v)).replace(/\.00$/, ""));
const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
const SHOW = 300;

export function CreditClient({ firms, firm, rows, graceDays }: { firms: Firm[]; firm: Firm; rows: TermsRow[]; graceDays: number }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [territory, setTerritory] = useState("");
  const [beat, setBeat] = useState("");
  const [terms, setTerms] = useState<TermsFilter>("all");
  const [withBalance, setWithBalance] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [limit, setLimit] = useState("");
  const [days, setDays] = useState("");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const today = todayIST();

  const ageOf = (r: TermsRow) =>
    r.oldest_bill_date ? Math.round((Date.parse(today) - Date.parse(r.oldest_bill_date)) / 86_400_000) : null;
  const isOver = (r: TermsRow) => {
    const age = ageOf(r);
    return (n(r.credit_limit) > 0 && n(r.outstanding) > n(r.credit_limit)) || (r.credit_days > 0 && age !== null && age > r.credit_days + graceDays);
  };

  const territories = useMemo(() => uniq(rows.map((r) => r.territory_name)), [rows]);
  const beats = useMemo(() => uniq(rows.filter((r) => !territory || r.territory_name === territory).map((r) => r.beat_name)), [rows, territory]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        r.status !== "ignore" &&
        (!withBalance || n(r.outstanding) > 0 || n(r.sales_90d) > 0) &&
        (!territory || r.territory_name === territory) &&
        (!beat || r.beat_name === beat) &&
        (terms === "all" ||
          (terms === "unset" && n(r.credit_limit) === 0 && r.credit_days === 0) ||
          (terms === "set" && (n(r.credit_limit) > 0 || r.credit_days > 0)) ||
          (terms === "over" && isOver(r))) &&
        (!q || r.customer_name.toLowerCase().includes(q)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, query, territory, beat, terms, withBalance]);

  const counts = useMemo(() => {
    let unset = 0;
    for (const r of rows) if (r.status === "active" && n(r.credit_limit) === 0 && r.credit_days === 0 && (n(r.outstanding) > 0 || n(r.sales_90d) > 0)) unset++;
    return { unset };
  }, [rows]);

  const allPicked = filtered.length > 0 && filtered.every((r) => picked.has(r.customer_id));
  const togglePick = (id: string) =>
    setPicked((p) => {
      const next = new Set(p);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const pickAll = () =>
    setPicked((p) => {
      const next = new Set(p);
      for (const r of filtered) if (allPicked) next.delete(r.customer_id);
      else next.add(r.customer_id);
      return next;
    });

  const apply = () =>
    start(async () => {
      const r = await setCreditTerms({ firmId: firm.id, customerIds: [...picked], creditLimit: limit, creditDays: days });
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) {
        setPicked(new Set());
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit terms"
        description={
          <>
            Credit limit and credit days per customer for {firm.name}. Orders are held for approval when outstanding plus
            the order is over the limit, or the oldest unpaid bill is older than credit days + {graceDays} grace days. A
            blank (0) limit or days means that rule is not checked yet.
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => router.push(`/credit?firm=${f.code}`)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              f.id === firm.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.name}
          </button>
        ))}
      </div>

      {counts.unset > 0 && (
        <Alert kind="info">
          {formatNumber(counts.unset)} active customers with a balance or recent sales have no credit terms in {firm.code} yet.
          Pick a beat, select all, and set the terms once.
        </Alert>
      )}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput placeholder="Search customer" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={territory} onChange={(e) => (setTerritory(e.target.value), setBeat(""))}>
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
          <Select value={terms} onChange={(e) => setTerms(e.target.value as TermsFilter)}>
            <option value="all">All terms</option>
            <option value="unset">Terms not set</option>
            <option value="set">Terms set</option>
            <option value="over">Over limit or overdue now</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={withBalance} onChange={(e) => setWithBalance(e.target.checked)} />
            Only with balance or sales in 90 days
          </label>
        </div>
      </Card>

      <Card className="sticky top-2 z-10 flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-medium">{formatNumber(picked.size)} selected</span>
        <Input className="w-40" inputMode="decimal" placeholder="Credit limit ₹" value={limit} onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} />
        <Input className="w-32" inputMode="numeric" placeholder="Credit days" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
        <Button disabled={pending || picked.size === 0 || (!limit && !days)} onClick={apply}>
          Set for selected
        </Button>
        <span className="text-xs text-slate-500">Leave a box blank to keep what each customer has.</span>
        {picked.size > 0 && (
          <button className="text-sm text-slate-500 underline" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        )}
      </Card>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH className="w-8">
                <input type="checkbox" aria-label="Select all shown" checked={allPicked} onChange={pickAll} />
              </TH>
              <TH>Customer</TH>
              <TH className="text-right">Outstanding</TH>
              <TH className="text-right">Oldest bill</TH>
              <TH className="text-right">Sales 90 days</TH>
              <TH className="text-right">Limit</TH>
              <TH className="text-right">Days</TH>
            </tr>
          </THead>
          <tbody>
            {filtered.length === 0 && <EmptyRow colSpan={7}>No customers match.</EmptyRow>}
            {filtered.slice(0, SHOW).map((r) => {
              const age = ageOf(r);
              const overLimit = n(r.credit_limit) > 0 && n(r.outstanding) > n(r.credit_limit);
              const overDays = r.credit_days > 0 && age !== null && age > r.credit_days + graceDays;
              return (
                <TR key={r.customer_id} className={picked.has(r.customer_id) ? "bg-brand-50/50" : undefined}>
                  <TD>
                    <input type="checkbox" aria-label={`Select ${r.customer_name}`} checked={picked.has(r.customer_id)} onChange={() => togglePick(r.customer_id)} />
                  </TD>
                  <TD>
                    <Link href={`/customers/${r.customer_id}`} className="font-medium text-slate-900 hover:underline">
                      {r.customer_name}
                    </Link>
                    {r.status === "bad_debt" && (
                      <Badge tone="red" className="ml-2">
                        bad debt
                      </Badge>
                    )}
                    <div className="text-xs text-slate-500">{r.beat_name ?? "No beat"}</div>
                  </TD>
                  <TD className={cn("num text-right", overLimit && "font-semibold text-red-700")}>{rupees(r.outstanding)}</TD>
                  <TD className={cn("num text-right", overDays && "font-semibold text-red-700")}>{age === null ? "—" : `${age} d`}</TD>
                  <TD className="num text-right">{rupees(r.sales_90d)}</TD>
                  <TD className="num text-right">{rupees(r.credit_limit)}</TD>
                  <TD className="num text-right">{r.credit_days || "—"}</TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {filtered.length > SHOW && (
          <p className="px-5 py-3 text-xs text-slate-500">
            Showing {SHOW} of {formatNumber(filtered.length)}. &quot;Select all&quot; still picks all {formatNumber(filtered.length)}; narrow by beat or search to see the rest.
          </p>
        )}
      </Card>
    </div>
  );
}
