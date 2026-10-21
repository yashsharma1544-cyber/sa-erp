"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatKg, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, type OrderStatus } from "./status";

type Firm = { id: string; code: string; name: string };
export type OrderListRow = {
  id: string;
  order_no: string;
  order_date: string;
  status: OrderStatus;
  source: string;
  total: string;
  total_kg: string;
  discount: string;
  firm_id: string;
  created_at: string;
  customer_id: string;
  customer_name: string;
  beat_name: string | null;
  salesman_name: string | null;
};

const TABS: { key: "open" | OrderStatus | "all"; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "pending_approval", label: "Waiting approval" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];
const OPEN: OrderStatus[] = ["pending_approval", "approved", "loading"];

export function OrdersClient({ rows, firms, from, to, canCreate }: { rows: OrderListRow[]; firms: Firm[]; from: string; to: string; canCreate: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("open");
  const [firm, setFirm] = useState("");
  const [q, setQ] = useState("");

  const inFirm = useMemo(() => rows.filter((r) => !firm || r.firm_id === firm), [rows, firm]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return inFirm.filter(
      (r) =>
        (tab === "all" || (tab === "open" ? OPEN.includes(r.status) : r.status === tab)) &&
        (!s || r.customer_name.toLowerCase().includes(s) || r.order_no.toLowerCase().includes(s) || (r.salesman_name ?? "").toLowerCase().includes(s)),
    );
  }, [inFirm, tab, q]);
  const live = inFirm.filter((r) => r.status !== "cancelled" && r.status !== "rejected");
  const value = live.reduce((s, r) => s + Number(r.total), 0);
  const kg = live.reduce((s, r) => s + Number(r.total_kg), 0);
  const waiting = inFirm.filter((r) => r.status === "pending_approval");
  const count = (k: (typeof TABS)[number]["key"]) =>
    k === "all" ? inFirm.length : k === "open" ? inFirm.filter((r) => OPEN.includes(r.status)).length : inFirm.filter((r) => r.status === k).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Orders"
        description="Every order is credit-checked when it is placed. Orders that fail, or carry a rate below the price list, wait in Approvals."
        actions={
          canCreate && (
            <Link href="/orders/new">
              <Button>
                <Plus className="h-4 w-4" /> New order
              </Button>
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-end gap-3">
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
        <div className="ml-auto flex items-center gap-2 text-sm">
          <Input type="date" className="w-40" value={from} onChange={(e) => router.push(`/orders?from=${e.target.value}&to=${to}`)} />
          <span className="text-slate-500">to</span>
          <Input type="date" className="w-40" value={to} onChange={(e) => router.push(`/orders?from=${from}&to=${e.target.value}`)} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard tone="brand" label="Orders" value={formatNumber(live.length)} sub={`${formatDate(from)} – ${formatDate(to)}, not cancelled or rejected`} />
        <StatCard label="Order value" value={formatINR(value).replace(/\.\d\d$/, "")} sub={kg > 0 ? `${formatKg(kg)} with known weight` : "Weight not set for these items"} />
        <Link href="/approvals" className="block transition hover:-translate-y-0.5">
          <StatCard
            label="Waiting approval"
            value={formatNumber(waiting.length)}
            sub={waiting.length ? formatINR(waiting.reduce((s, r) => s + Number(r.total), 0)).replace(/\.\d\d$/, "") : "Nothing waiting"}
          />
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn("rounded-full px-3 py-1 text-sm", t.key === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t.label} <span className="num ml-1 opacity-70">{formatNumber(count(t.key))}</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-72">
          <SearchInput placeholder="Customer, order no, salesman" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Order</TH>
              <TH>Customer</TH>
              <TH>From</TH>
              <TH className="text-right">Weight</TH>
              <TH className="text-right">Total</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={6}>No orders here.</EmptyRow>}
            {shown.map((r) => (
              <TR key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/orders/${r.id}`)}>
                <TD className="whitespace-nowrap">
                  <Link href={`/orders/${r.id}`} className="font-medium text-slate-900 hover:underline">
                    {r.order_no}
                  </Link>
                  <div className="text-xs text-slate-500">{formatDate(r.order_date)}</div>
                </TD>
                <TD>
                  <div className="font-medium text-slate-900">{r.customer_name}</div>
                  <div className="text-xs text-slate-500">{r.beat_name ?? "No beat"}</div>
                </TD>
                <TD className="text-sm">
                  {SOURCE_LABEL[r.source] ?? r.source}
                  {r.salesman_name && <div className="text-xs text-slate-500">{r.salesman_name}</div>}
                </TD>
                <TD className="num text-right">{Number(r.total_kg) > 0 ? formatKg(r.total_kg) : "—"}</TD>
                <TD className="num text-right">
                  {formatINR(r.total)}
                  {Number(r.discount) > 0 && <div className="text-xs text-amber-700">−{formatINR(r.discount)} below list</div>}
                </TD>
                <TD>
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
