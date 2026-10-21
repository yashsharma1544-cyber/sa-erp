"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatDate, formatDateTime, formatINR, formatKg } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input } from "@/components/ui/field";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import type { CreditCheck } from "../../credit/actions";
import { cancelOrder } from "../actions";
import { SOURCE_LABEL, STATUS_LABEL, STATUS_TONE, type OrderStatus } from "../status";

export type OrderView = {
  order: {
    id: string; order_no: string; order_date: string; status: OrderStatus; source: string;
    taxable: string; gst: string; total: string; discount: string; total_kg: string;
    credit_check: CreditCheck | null; note: string | null; created_at: string;
    firm: { code: string; name: string; gst_registered: boolean };
    customer: { id: string; name: string; status: string; beat: { name: string } | null };
    salesman: { full_name: string } | null;
  };
  lines: {
    id: string; line_no: number; unit: string; qty: string; kg: string; list_rate: string | null; rate: string;
    gst_rate: string; taxable: string; gst: string; amount: string; item: { name: string };
  }[];
  events: { id: string; from_status: string | null; to_status: OrderStatus; note: string | null; at: string; by: { full_name: string } | null }[];
  approvals: {
    id: string; kind: string; status: string; reason: string; amount: string; decision_note: string | null;
    decided_at: string | null; decider: { full_name: string } | null;
  }[];
};

const APPROVAL_TONE = { pending: "amber", approved: "green", rejected: "red", cancelled: "neutral" } as const;

export function OrderDetail({ order: o, lines, events, approvals, canCancel }: OrderView & { canCancel: boolean }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const cancellable = canCancel && ["pending_approval", "approved", "rejected"].includes(o.status);
  const c = o.credit_check;

  return (
    <div className="space-y-6">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="h-4 w-4" /> Orders
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-2xl font-semibold tracking-tight">
            {o.order_no} <Badge tone={STATUS_TONE[o.status]}>{STATUS_LABEL[o.status]}</Badge>
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {o.firm.name} · {formatDate(o.order_date)} · {SOURCE_LABEL[o.source] ?? o.source}
            {o.salesman && <> · {o.salesman.full_name}</>}
          </p>
          <p className="mt-1 text-sm">
            <Link href={`/customers/${o.customer.id}`} className="font-medium text-slate-900 hover:underline">
              {o.customer.name}
            </Link>
            <span className="ml-2 text-slate-500">{o.customer.beat?.name ?? "No beat"}</span>
            {o.customer.status === "bad_debt" && (
              <Badge tone="red" className="ml-2">
                bad debt
              </Badge>
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="num text-3xl font-semibold tracking-tight">{formatINR(o.total)}</div>
          {Number(o.total_kg) > 0 && <div className="text-sm text-slate-500">{formatKg(o.total_kg)}</div>}
        </div>
      </div>
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH className="text-right">Qty</TH>
                <TH className="text-right">Rate</TH>
                <TH className="text-right">Taxable</TH>
                {o.firm.gst_registered && <TH className="text-right">GST</TH>}
              </tr>
            </THead>
            <tbody>
              {lines.map((l) => (
                <TR key={l.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{l.item.name}</div>
                    {Number(l.kg) > 0 && l.unit !== "kg" && <div className="text-xs text-slate-500">{formatKg(l.kg)}</div>}
                  </TD>
                  <TD className="num text-right">
                    {Number(l.qty)} {l.unit}
                  </TD>
                  <TD className="num text-right">
                    {formatINR(l.rate)}
                    {l.list_rate && Number(l.rate) < Number(l.list_rate) && (
                      <div className="text-xs text-amber-700">list {formatINR(l.list_rate)}</div>
                    )}
                  </TD>
                  <TD className="num text-right">{formatINR(l.taxable)}</TD>
                  {o.firm.gst_registered && (
                    <TD className="num text-right">
                      {formatINR(l.gst)}
                      <div className="text-xs text-slate-500">{Number(l.gst_rate)}%</div>
                    </TD>
                  )}
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="space-y-1 border-t border-slate-100 px-5 py-4 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Taxable</span>
              <span className="num">{formatINR(o.taxable)}</span>
            </div>
            {o.firm.gst_registered && (
              <div className="flex justify-between">
                <span className="text-slate-500">GST</span>
                <span className="num">{formatINR(o.gst)}</span>
              </div>
            )}
            <div className="flex justify-between text-base font-semibold">
              <span>Total</span>
              <span className="num">{formatINR(o.total)}</span>
            </div>
            {o.note && <p className="pt-2 text-slate-600">Note: {o.note}</p>}
          </div>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Credit check" description="At the time the order was placed" />
            <CardBody className="space-y-1 text-sm">
              {!c ? (
                <p className="text-slate-500">—</p>
              ) : c.skipped ? (
                <p className="text-slate-600">{c.note ?? "Skipped"}</p>
              ) : (
                <>
                  <Badge tone={c.ok ? "green" : "red"}>{c.ok ? "Passed" : "Failed"}</Badge>
                  {c.reasons.map((r) => (
                    <p key={r.code} className="text-red-700">
                      {r.text}
                    </p>
                  ))}
                  <p className="text-slate-600">
                    Outstanding {formatINR(c.outstanding ?? 0)}
                    {Number(c.credit_limit) > 0 && <> · limit {formatINR(c.credit_limit ?? 0)}</>}
                  </p>
                  {c.oldest_days != null && <p className="text-slate-600">Oldest unpaid bill {c.oldest_days} days</p>}
                  {!c.terms_set && <p className="text-amber-700">No credit terms were set.</p>}
                </>
              )}
            </CardBody>
          </Card>

          {approvals.length > 0 && (
            <Card>
              <CardHeader title="Approvals" />
              <CardBody className="space-y-3 text-sm">
                {approvals.map((a) => (
                  <div key={a.id}>
                    <div className="flex items-center gap-2">
                      <Badge tone={APPROVAL_TONE[a.status as keyof typeof APPROVAL_TONE] ?? "neutral"} className="capitalize">
                        {a.kind} · {a.status}
                      </Badge>
                      <span className="num text-slate-500">{formatINR(a.amount)}</span>
                    </div>
                    <p className="mt-1 text-slate-600">{a.reason}</p>
                    {a.decided_at && (
                      <p className="text-xs text-slate-500">
                        {a.decider?.full_name ?? "—"} · {formatDateTime(a.decided_at)}
                        {a.decision_note && <> · “{a.decision_note}”</>}
                      </p>
                    )}
                  </div>
                ))}
                {approvals.some((a) => a.status === "pending") && (
                  <Link href="/approvals" className="text-sm font-medium text-brand-700 hover:underline">
                    Open Approvals →
                  </Link>
                )}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="History" />
            <CardBody className="space-y-2 text-sm">
              {events.map((e) => (
                <div key={e.id}>
                  <span className="font-medium">{STATUS_LABEL[e.to_status] ?? e.to_status}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {formatDateTime(e.at)}
                    {e.by && <> · {e.by.full_name}</>}
                  </span>
                  {e.note && <div className="text-xs text-slate-500">{e.note}</div>}
                </div>
              ))}
            </CardBody>
          </Card>

          {cancellable && (
            <Card>
              <CardBody className="space-y-2">
                {!showCancel ? (
                  <Button variant="secondary" size="sm" onClick={() => setShowCancel(true)}>
                    Cancel order
                  </Button>
                ) : (
                  <>
                    <Input placeholder="Why is it cancelled?" value={reason} onChange={(e) => setReason(e.target.value)} />
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const r = await cancelOrder(o.id, reason);
                          setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Cancelled" });
                          if (!r.error) router.refresh();
                        })
                      }
                    >
                      Cancel this order
                    </Button>
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
