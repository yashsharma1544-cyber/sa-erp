"use client";

import { useState, useTransition } from "react";
import { formatDateTime, formatINR } from "@/lib/format";
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
  requested_by: string;
  firm_code: string;
  requester_name: string;
  decider_name: string | null;
};

const statusStyle: Record<ApprovalRow["status"], string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  cancelled: "bg-slate-100 text-slate-600",
};

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
      <h1 className="text-2xl font-semibold">Approvals</h1>
      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

      <section className="space-y-2">
        <h2 className="font-medium">Waiting ({pendingRows.length})</h2>
        {pendingRows.length === 0 && <p className="text-sm text-slate-500">Nothing waiting.</p>}
        {pendingRows.map((r) => (
          <div key={r.id} className="space-y-2 rounded-xl bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {r.subject_label}{" "}
                  <span className="rounded bg-slate-100 px-1.5 text-xs">{r.firm_code}</span>{" "}
                  <span className="rounded bg-slate-100 px-1.5 text-xs">{r.kind}</span>
                  {r.is_bad_debt && <span className="ml-1 rounded bg-red-600 px-1.5 text-xs text-white">BAD DEBT</span>}
                </div>
                <div className="text-sm text-slate-600">{r.reason}</div>
                <div className="text-xs text-slate-500">
                  {r.requester_name} · {formatDateTime(r.created_at)}
                </div>
              </div>
              <div className="num text-lg font-semibold">{formatINR(r.amount)}</div>
            </div>
            {canDecide(r) ? (
              <div className="flex flex-wrap gap-2">
                <input
                  placeholder="Note (optional)"
                  value={notes[r.id] ?? ""}
                  onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
                  className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
                <button
                  disabled={pending}
                  onClick={() => act(() => decide(r.id, true, notes[r.id] ?? ""))}
                  className="rounded-md bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  disabled={pending}
                  onClick={() => act(() => decide(r.id, false, notes[r.id] ?? ""))}
                  className="rounded-md bg-red-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            ) : r.requested_by === myUserId ? (
              <button
                disabled={pending}
                onClick={() => act(() => cancelRequest(r.id))}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
              >
                Cancel my request
              </button>
            ) : (
              <p className="text-xs text-slate-500">
                {r.is_bad_debt ? "Only the owner can approve for a bad-debt customer." : "You cannot decide this one."}
              </p>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">Recent decisions</h2>
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
          <table className="w-full text-sm">
            <tbody>
              {decidedRows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">
                    <span className={"rounded px-1.5 text-xs " + statusStyle[r.status]}>{r.status}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.subject_label} <span className="text-xs text-slate-500">({r.firm_code})</span>
                  </td>
                  <td className="num px-3 py-2 text-right">{formatINR(r.amount)}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {r.decider_name ?? ""} {r.decided_at ? "· " + formatDateTime(r.decided_at) : ""}
                    {r.decision_note ? ` · “${r.decision_note}”` : ""}
                  </td>
                </tr>
              ))}
              {decidedRows.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-center text-slate-500">None yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
