"use client";

import { useState, useTransition } from "react";
import { Check, CheckCircle2, X } from "lucide-react";
import { formatDateTime, formatINR } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input } from "@/components/ui/field";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { cancelRequest, decide } from "./actions";

export type ApprovalRow = {
  id: string;
  kind: string;
  permission_key: string;
  subject_label: string;
  amount: string;
  is_bad_debt: boolean;
  reason: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
  requested_by: string | null;
  subject_table: string | null;
  details: {
    salesman?: string;
    credit?: { outstanding?: number; credit_limit?: number; oldest_days?: number | null; credit_days?: number };
  } | null;
  firm_code: string;
  requester_name: string;
  decider_name: string | null;
};

const statusTone = { pending: "amber", approved: "green", rejected: "red", cancelled: "neutral" } as const;

export function ApprovalsClient({
  rows,
  myUserId,
  isOwner,
  myPermissions,
}: {
  rows: ApprovalRow[];
  myUserId: string;
  isOwner: boolean;
  myPermissions: string[];
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pendingRows = rows.filter((r) => r.status === "pending");
  const decidedRows = rows.filter((r) => r.status !== "pending");

  function canDecide(r: ApprovalRow) {
    if (isOwner) return true;
    return r.requested_by !== myUserId && myPermissions.includes(r.permission_key) && !r.is_bad_debt;
  }

  function act(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approvals"
        description="Orders over credit, discounts, returns and scheme changes wait here. Only the owner can approve for a bad-debt customer."
      />
      {error && <Alert kind="error">{error}</Alert>}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-700">
          Waiting <span className="num ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{pendingRows.length}</span>
        </h2>

        {pendingRows.length === 0 && (
          <Card className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
              <CheckCircle2 className="h-6 w-6" />
            </span>
            <p className="mt-3 font-medium">All clear</p>
            <p className="text-sm text-slate-500">Nothing is waiting for approval.</p>
          </Card>
        )}

        {pendingRows.map((r) => (
          <Card key={r.id} className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{r.subject_label}</span>
                  <Badge>{r.firm_code}</Badge>
                  <Badge tone="blue" className="capitalize">
                    {r.kind}
                  </Badge>
                  {r.is_bad_debt && <Badge tone="red">Bad debt</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-600">{r.reason}</p>
                {r.details?.credit && (
                  <p className="mt-1 text-xs text-slate-500">
                    Outstanding {formatINR(r.details.credit.outstanding ?? 0)}
                    {Number(r.details.credit.credit_limit) > 0 && <> · limit {formatINR(r.details.credit.credit_limit ?? 0)}</>}
                    {r.details.credit.oldest_days != null && <> · oldest bill {r.details.credit.oldest_days} days</>}
                    {Number(r.details.credit.credit_days) > 0 && <> · credit days {r.details.credit.credit_days}</>}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-500">
                  Asked by {r.requester_name} · {formatDateTime(r.created_at)}
                </p>
              </div>
              <div className="num text-right text-2xl font-semibold tracking-tight">{formatINR(r.amount)}</div>
            </div>

            <div className="mt-4 border-t border-slate-100 pt-4">
              {canDecide(r) ? (
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Note (optional)"
                    value={notes[r.id] ?? ""}
                    onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                    className="min-w-0 flex-1"
                  />
                  <Button variant="success" disabled={pending} onClick={() => act(() => decide(r.id, true, notes[r.id] ?? ""))}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button variant="danger" disabled={pending} onClick={() => act(() => decide(r.id, false, notes[r.id] ?? ""))}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              ) : r.requested_by === myUserId ? (
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => act(() => cancelRequest(r.id))}>
                  Cancel my request
                </Button>
              ) : (
                <p className="text-sm text-slate-500">
                  {r.is_bad_debt ? "Only the owner can approve for a bad-debt customer." : "You cannot decide this one."}
                </p>
              )}
            </div>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader title="Recent decisions" />
        <Table>
          <THead>
            <tr>
              <TH>Status</TH>
              <TH>Request</TH>
              <TH className="text-right">Amount</TH>
              <TH>Decided by</TH>
            </tr>
          </THead>
          <tbody>
            {decidedRows.map((r) => (
              <TR key={r.id}>
                <TD>
                  <Badge tone={statusTone[r.status]} className="capitalize">
                    {r.status}
                  </Badge>
                </TD>
                <TD>
                  <span className="font-medium text-slate-900">{r.subject_label}</span>{" "}
                  <span className="text-xs text-slate-500">{r.firm_code}</span>
                  {r.decision_note && <div className="text-xs text-slate-500">“{r.decision_note}”</div>}
                </TD>
                <TD className="num text-right">{formatINR(r.amount)}</TD>
                <TD className="text-slate-600">
                  {r.decider_name ?? "—"}
                  {r.decided_at && <div className="text-xs text-slate-500">{formatDateTime(r.decided_at)}</div>}
                </TD>
              </TR>
            ))}
            {decidedRows.length === 0 && <EmptyRow colSpan={4}>No decisions yet.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
