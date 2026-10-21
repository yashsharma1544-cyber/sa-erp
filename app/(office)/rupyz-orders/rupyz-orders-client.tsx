"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Link2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { linkCustomer, recheckOrders, searchCustomers } from "./actions";

type Status = "unmapped" | "cleared" | "held" | "approved" | "rejected" | "cancelled";
export type OrderRow = {
  id: string;
  rupyz_order_id: string;
  order_no: string | null;
  order_date: string;
  rupyz_customer_name: string;
  customer_id: string | null;
  customer_name: string | null;
  salesman_name: string | null;
  beat_name: string | null;
  amount: string;
  status: Status;
  credit: { reasons?: { code: string; text: string }[]; terms_set?: boolean; outstanding?: number } | null;
  checked_at: string | null;
  firm_code: string;
};

const TABS: { key: Status | "all"; label: string }[] = [
  { key: "held", label: "Held for approval" },
  { key: "unmapped", label: "Customer not linked" },
  { key: "cleared", label: "Passed" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "all", label: "All" },
];
const TONE = { unmapped: "amber", cleared: "green", held: "red", approved: "green", rejected: "red", cancelled: "neutral" } as const;
const LABEL: Record<Status, string> = {
  unmapped: "not linked",
  cleared: "passed",
  held: "held",
  approved: "approved",
  rejected: "rejected",
  cancelled: "cancelled",
};

export function RupyzOrdersClient({ rows, canLink }: { rows: OrderRow[]; canLink: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<Status | "all">(rows.some((r) => r.status === "held") ? "held" : "all");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [linking, setLinking] = useState<OrderRow | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) router.refresh();
    });

  const count = (k: Status) => rows.filter((r) => r.status === k).length;
  const shown = tab === "all" ? rows : rows.filter((r) => r.status === tab);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rupyz orders"
        description="Every Rupyz order is credit-checked when it arrives. Orders that fail wait in Approvals; passed and approved orders can be billed."
        actions={
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => recheckOrders())}>
            <RotateCw className="h-4 w-4" /> Recheck held &amp; unlinked
          </Button>
        }
      />
      {rows.length === 0 && (
        <Alert kind="info">No Rupyz orders have arrived yet. They appear here once the Rupyz feed is connected (see the runbook).</Alert>
      )}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn("rounded-full px-3 py-1 text-sm", t.key === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t.label}
            {t.key !== "all" && <span className="num ml-1.5 opacity-70">{formatNumber(count(t.key))}</span>}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Order</TH>
              <TH>Customer</TH>
              <TH className="text-right">Amount</TH>
              <TH>Credit check</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={5}>Nothing here.</EmptyRow>}
            {shown.map((r) => (
              <TR key={r.id}>
                <TD className="whitespace-nowrap">
                  <div className="font-medium text-slate-900">{r.order_no ?? r.rupyz_order_id}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(r.order_date)} · {r.firm_code}
                    {r.salesman_name && <> · {r.salesman_name}</>}
                  </div>
                </TD>
                <TD>
                  {r.customer_id ? (
                    <Link href={`/customers/${r.customer_id}`} className="font-medium text-slate-900 hover:underline">
                      {r.customer_name}
                    </Link>
                  ) : (
                    <span className="font-medium text-slate-900">{r.rupyz_customer_name}</span>
                  )}
                  {r.customer_id && r.customer_name !== r.rupyz_customer_name && (
                    <div className="text-xs text-slate-500">Rupyz: {r.rupyz_customer_name}</div>
                  )}
                </TD>
                <TD className="num text-right">{formatINR(r.amount)}</TD>
                <TD className="max-w-sm">
                  <Badge tone={TONE[r.status]}>{LABEL[r.status]}</Badge>
                  {r.credit?.reasons?.map((x) => (
                    <div key={x.code} className="mt-1 text-xs text-red-700">
                      {x.text}
                    </div>
                  ))}
                  {r.status === "cleared" && r.credit && !r.credit.terms_set && (
                    <div className="mt-1 text-xs text-amber-700">No credit terms set for this customer</div>
                  )}
                </TD>
                <TD className="whitespace-nowrap text-right">
                  {r.status === "held" && (
                    <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
                      Decide
                    </Link>
                  )}
                  {canLink && (r.status === "unmapped" || r.status === "held" || r.status === "cleared") && (
                    <Button size="sm" variant="ghost" onClick={() => setLinking(r)}>
                      <Link2 className="h-4 w-4" /> {r.customer_id ? "Relink" : "Link"}
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      {linking && (
        <LinkModal
          order={linking}
          pending={pending}
          onClose={() => setLinking(null)}
          onPick={(customerId) => {
            setLinking(null);
            run(() => linkCustomer(linking.id, customerId));
          }}
        />
      )}
    </div>
  );
}

function LinkModal({
  order, pending, onClose, onPick,
}: {
  order: OrderRow;
  pending: boolean;
  onClose: () => void;
  onPick: (customerId: string) => void;
}) {
  const [q, setQ] = useState(order.rupyz_customer_name.split(/\s+/).slice(0, 2).join(" "));
  const [results, setResults] = useState<{ id: string; name: string; beat: string | null }[]>([]);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => void searchCustomers(q).then((r) => live && setResults(r)), 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);
  return (
    <Modal open onClose={onClose} title="Link to an ERP customer" description={`Rupyz customer: ${order.rupyz_customer_name}. Later orders from this Rupyz customer link automatically.`}>
      <Input autoFocus placeholder="Search ERP customer" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3 max-h-72 divide-y divide-slate-100 overflow-y-auto">
        {results.length === 0 && <p className="py-4 text-center text-sm text-slate-500">Type at least 2 letters.</p>}
        {results.map((c) => (
          <button
            key={c.id}
            disabled={pending}
            onClick={() => onPick(c.id)}
            className="flex w-full items-center justify-between px-2 py-2.5 text-left text-sm hover:bg-slate-50"
          >
            <span className="font-medium">{c.name}</span>
            <span className="text-xs text-slate-500">{c.beat ?? "No beat"}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
