"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { getCandidates, matchReceipt, unmatchReceipt, type Candidate, type MatchedTo } from "./actions";

export type MatchRow = {
  id: string;
  receipt_no: string;
  firm_id: string;
  amount: string;
  mode: string;
  status: string;
  collected_on: string;
  tally_voucher_id: string | null;
  customer: { name: string } | null;
  collector: { full_name: string } | null;
  match: { method: "auto" | "manual"; deleted_at: string | null }[];
};
type Firm = { id: string; code: string; name: string };
type View = "waiting" | "matched";

const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000);

export function MatchClient({ rows, firms, canMatch, today }: { rows: MatchRow[]; firms: Firm[]; canMatch: boolean; today: string }) {
  const router = useRouter();
  const [firmId, setFirmId] = useState(firms[0]?.id ?? "");
  const [view, setView] = useState<View>("waiting");
  const [open, setOpen] = useState<MatchRow | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const firmRows = useMemo(() => rows.filter((r) => r.firm_id === firmId && r.status !== "bounced"), [rows, firmId]);
  const waiting = firmRows.filter((r) => !r.tally_voucher_id).sort((a, b) => a.collected_on.localeCompare(b.collected_on));
  const matched = firmRows.filter((r) => r.tally_voucher_id).sort((a, b) => b.collected_on.localeCompare(a.collected_on));
  const late = waiting.filter((r) => daysBetween(r.collected_on, today) > 2);
  const auto = matched.filter((r) => r.match.find((m) => !m.deleted_at)?.method === "auto").length;
  const shown = view === "waiting" ? waiting : matched;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tally match"
        description="Each ERP receipt should appear as a receipt voucher in Tally. Matches happen by themselves after every sync when the customer, amount and date agree; match the rest here."
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="flex flex-wrap gap-2">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => setFirmId(f.id)}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", f.id === firmId ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Not in Tally yet" value={formatINR(waiting.reduce((s, r) => s + Number(r.amount), 0))} sub={`${formatNumber(waiting.length)} receipts`} />
        <StatCard
          tone={late.length ? "brand" : "neutral"}
          label="Waiting more than 2 days"
          value={formatNumber(late.length)}
          sub={late.length ? "Key these into Tally or match them" : "All recent"}
        />
        <StatCard label="Matched (75 days)" value={formatNumber(matched.length)} sub={`${formatNumber(auto)} by themselves`} />
      </div>

      <div className="flex gap-2">
        {(["waiting", "matched"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn("rounded-full px-3 py-1 text-sm", v === view ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {v === "waiting" ? `Not in Tally ${formatNumber(waiting.length)}` : `Matched ${formatNumber(matched.length)}`}
          </button>
        ))}
      </div>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH>Receipt</TH>
              <TH className="text-right">Amount</TH>
              <TH>Collected</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={5}>{view === "waiting" ? "Everything is in Tally." : "Nothing matched yet."}</EmptyRow>}
            {shown.map((r) => {
              const days = daysBetween(r.collected_on, today);
              const m = r.match.find((x) => !x.deleted_at);
              return (
                <TR key={r.id}>
                  <TD>
                    <div className="font-medium">{r.customer?.name}</div>
                    <div className="text-xs text-slate-500">{r.collector?.full_name}</div>
                  </TD>
                  <TD>
                    {r.receipt_no}
                    <div className="text-xs uppercase text-slate-500">{r.mode}</div>
                  </TD>
                  <TD className="num text-right font-semibold">{formatINR(r.amount)}</TD>
                  <TD>
                    {formatDate(r.collected_on)}
                    {view === "waiting" && <div className={cn("text-xs", days > 2 ? "font-medium text-red-700" : "text-slate-500")}>{days} days</div>}
                  </TD>
                  <TD className="text-right">
                    {view === "matched" && m && <Badge tone={m.method === "auto" ? "green" : "blue"}>{m.method === "auto" ? "Matched by itself" : "Matched by hand"}</Badge>}{" "}
                    <Button size="sm" variant={view === "waiting" ? "secondary" : "ghost"} onClick={() => setOpen(r)}>
                      <Link2 className="h-4 w-4" /> {view === "waiting" ? "Find in Tally" : "Details"}
                    </Button>
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>

      {open && (
        <MatchModal
          row={open}
          canMatch={canMatch}
          onClose={() => setOpen(null)}
          onDone={(text) => {
            setFlash({ kind: "success", text });
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MatchModal({ row, canMatch, onClose, onDone }: { row: MatchRow; canMatch: boolean; onClose: () => void; onDone: (t: string) => void }) {
  const [state, setState] = useState<{ candidates?: Candidate[]; matched?: MatchedTo | null; error?: string } | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let live = true;
    void getCandidates(row.id).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [row.id]);

  return (
    <Modal open onClose={onClose} title={`${row.customer?.name} · ${formatINR(row.amount)}`} description={`${row.receipt_no} · collected ${formatDate(row.collected_on)}`} wide>
      {!state && <p className="text-sm text-slate-500">Looking in Tally…</p>}
      {state?.error && <Alert kind="error">{state.error}</Alert>}
      {state?.matched && (
        <div className="space-y-3">
          <p className="text-sm">
            Matched to Tally receipt <b>{state.matched.voucher_no ?? "—"}</b> of {formatDate(state.matched.voucher_date)} ({formatINR(state.matched.amount)}),{" "}
            {state.matched.method === "auto" ? "matched by itself" : "matched by hand"}.
          </p>
          {canMatch && (
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await unmatchReceipt(row.id);
                  if (r.error) setState({ ...state, error: r.error });
                  else onDone(r.ok ?? "Unmatched");
                })
              }
            >
              Unmatch
            </Button>
          )}
        </div>
      )}
      {state?.candidates && !state.matched && (
        <>
          {state.candidates.length === 0 ? (
            <p className="text-sm text-slate-500">
              No Tally receipt for this customer or amount within 20 days. Accounts still has to key it into Tally.
            </p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {state.candidates.map((c) => (
                <li key={`${c.voucher_id}-${c.ledger_name}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <div>
                    <div className="font-medium">
                      {c.voucher_no ?? "—"} · {formatDate(c.voucher_date)}
                    </div>
                    <div className="text-xs text-slate-500">
                      {c.ledger_name}
                      {c.same_party && c.same_amount && " · same customer and amount"}
                      {c.same_party && !c.same_amount && " · same customer"}
                      {!c.same_party && " · same amount, other ledger"}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={cn("num font-semibold", c.same_amount ? "text-slate-900" : "text-amber-700")}>{formatINR(c.amount)}</span>
                    {canMatch && (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          start(async () => {
                            const r = await matchReceipt(row.id, c.voucher_id);
                            if (r.error) setState({ ...state, error: r.error });
                            else onDone(r.ok ?? "Matched");
                          })
                        }
                      >
                        Match
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
