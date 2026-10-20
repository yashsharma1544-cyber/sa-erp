"use client";

import { useMemo, useState, useTransition } from "react";
import { Link2, Plus, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { createAllPending, decideParty } from "./actions";

type Status = "pending" | "created" | "linked" | "non_customer" | "skipped";
export type PartyRow = {
  id: string;
  firm_id: string;
  ledger_name: string;
  tally_group: string | null;
  phone: string | null;
  erp_beat: string | null;
  flag: "bad_debt" | "ignore" | null;
  closing_balance: string | null;
  last_sale: string | null;
  sales_count: number;
  status: Status;
  match_method: string | null;
  customer_id: string | null;
  suggested_customer_id: string | null;
  suggestion_score: string | null;
  decided_at: string | null;
};
export type CustomerOption = { id: string; name: string; beat: string | null; firmIds: string[] };
type Firm = { id: string; code: string; name: string };

const statusLabels: Record<Status, string> = {
  pending: "To match",
  linked: "Linked",
  created: "New customer",
  non_customer: "Not a customer",
  skipped: "Skipped",
};
const statusTone = { pending: "amber", linked: "green", created: "blue", non_customer: "neutral", skipped: "neutral" } as const;
const methodLabels: Record<string, string> = {
  auto_new: "auto",
  auto_exact: "auto · same name",
  manual_link: "by hand",
  manual_new: "by hand",
  manual_skip: "by hand",
  non_customer: "",
};

/** Tally closing balance: negative = customer owes us (Dr). */
function Balance({ value }: { value: string | null }) {
  const n = Number(value ?? 0);
  if (!n) return <span className="text-slate-400">—</span>;
  return (
    <span className={n < 0 ? "text-slate-900" : "text-slate-500"}>
      {formatINR(Math.abs(n))} {n < 0 ? "Dr" : "Cr"}
    </span>
  );
}

export function ImportClient({ parties, customers, firms }: { parties: PartyRow[]; customers: CustomerOption[]; firms: Firm[] }) {
  const defaultFirm = firms.find((f) => f.code !== "SA")?.id ?? firms[0]?.id ?? "";
  const [firmId, setFirmId] = useState(defaultFirm);
  const [status, setStatus] = useState<Status>("pending");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState<PartyRow | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const firm = firms.find((f) => f.id === firmId);

  const counts = useMemo(() => {
    const c: Record<Status, number> = { pending: 0, linked: 0, created: 0, non_customer: 0, skipped: 0 };
    for (const p of parties) if (p.firm_id === firmId) c[p.status]++;
    return c;
  }, [parties, firmId]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parties.filter(
      (p) => p.firm_id === firmId && p.status === status && (!q || p.ledger_name.toLowerCase().includes(q)),
    );
  }, [parties, firmId, status, query]);
  const shown = rows.slice(0, 300);

  const run = (id: string, action: "link" | "new" | "skip" | "non_customer" | "undo", customerId?: string) => {
    setBusyId(id);
    start(async () => {
      const r = await decideParty({ id, action, customerId });
      setBusyId(null);
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) setPicking(null);
    });
  };

  const runAll = () =>
    start(async () => {
      const r = await createAllPending(firmId);
      setConfirmAll(false);
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import from Tally"
        description="Every Tally ledger becomes one customer. Sushil ledgers were created automatically; Anjali ledgers with the same name were linked to them. Match the rest by hand."
        actions={
          status === "pending" &&
          counts.pending > 0 &&
          firm?.code !== "SA" && (
            <Button variant="secondary" onClick={() => setConfirmAll(true)}>
              <Plus className="h-4 w-4" /> Create all {formatNumber(counts.pending)} as new
            </Button>
          )
        }
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => setFirmId(f.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              f.id === firmId ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(statusLabels) as Status[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full px-3 py-1 text-sm",
              s === status ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {statusLabels[s]} <span className="opacity-70">{formatNumber(counts[s])}</span>
          </button>
        ))}
        <div className="ml-auto w-full sm:w-72">
          <SearchInput placeholder="Search ledger name" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Tally ledger</TH>
              <TH>Balance</TH>
              <TH className="hidden md:table-cell">Last sale</TH>
              <TH>{status === "pending" ? "Best match" : "Customer"}</TH>
              <TH className="text-right">Action</TH>
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && (
              <EmptyRow colSpan={5}>{status === "pending" ? "Nothing left to match here." : "No ledgers."}</EmptyRow>
            )}
            {shown.map((p) => {
              const suggestion = p.suggested_customer_id ? customerById.get(p.suggested_customer_id) : undefined;
              const linked = p.customer_id ? customerById.get(p.customer_id) : undefined;
              const busy = pending && busyId === p.id;
              return (
                <TR key={p.id}>
                  <TD>
                    <div className="font-medium text-slate-900">{p.ledger_name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-slate-500">
                      {p.erp_beat && <span>{p.erp_beat}</span>}
                      {p.phone && <span>· {p.phone}</span>}
                      {p.flag === "bad_debt" && <Badge tone="red">Bad debt</Badge>}
                      {p.flag === "ignore" && <Badge>Ignore</Badge>}
                    </div>
                  </TD>
                  <TD className="whitespace-nowrap">
                    <Balance value={p.closing_balance} />
                  </TD>
                  <TD className="hidden whitespace-nowrap md:table-cell">
                    {p.last_sale ? formatDate(p.last_sale) : <span className="text-slate-400">never</span>}
                    {p.sales_count > 0 && <div className="text-xs text-slate-500">{formatNumber(p.sales_count)} bills</div>}
                  </TD>
                  <TD>
                    {status === "pending" ? (
                      suggestion ? (
                        <div>
                          <div className="text-slate-900">{suggestion.name}</div>
                          <div className="text-xs text-slate-500">
                            {Math.round(Number(p.suggestion_score ?? 0) * 100)}% similar
                            {suggestion.beat && ` · ${suggestion.beat}`}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">No close match</span>
                      )
                    ) : linked ? (
                      <div>
                        <a href={`/customers/${linked.id}`} className="text-brand-700 hover:underline">
                          {linked.name}
                        </a>
                        <div className="text-xs text-slate-500">
                          <Badge tone={statusTone[p.status]}>{statusLabels[p.status]}</Badge>{" "}
                          {p.match_method && methodLabels[p.match_method]}
                        </div>
                      </div>
                    ) : (
                      <Badge tone={statusTone[p.status]}>{statusLabels[p.status]}</Badge>
                    )}
                  </TD>
                  <TD className="text-right">
                    {status === "pending" ? (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {suggestion && !suggestion.firmIds.includes(p.firm_id) && (
                          <Button size="sm" disabled={busy} onClick={() => run(p.id, "link", suggestion.id)}>
                            <Link2 className="h-3.5 w-3.5" /> Link
                          </Button>
                        )}
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPicking(p)}>
                          Other…
                        </Button>
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(p.id, "new")}>
                          New
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(p.id, "non_customer")}>
                          Not a customer
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(p.id, "skip")}>
                          Skip
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(p.id, "undo")}>
                        <Undo2 className="h-3.5 w-3.5" /> Undo
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
        {rows.length > shown.length && (
          <p className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">
            Showing {formatNumber(shown.length)} of {formatNumber(rows.length)}. Search to narrow down.
          </p>
        )}
      </Card>

      {picking && (
        <CustomerPicker
          party={picking}
          customers={customers}
          firmName={firm?.name ?? ""}
          busy={pending}
          onClose={() => setPicking(null)}
          onPick={(customerId) => run(picking.id, "link", customerId)}
        />
      )}

      <Modal
        open={confirmAll}
        onClose={() => setConfirmAll(false)}
        title={`Create ${formatNumber(counts.pending)} new customers?`}
        description={`Every ${firm?.name ?? ""} ledger still to match becomes its own customer. You can undo any of them later from the "New customer" tab.`}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmAll(false)}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={runAll}>
            Create all
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function CustomerPicker({
  party,
  customers,
  firmName,
  busy,
  onClose,
  onPick,
}: {
  party: PartyRow;
  customers: CustomerOption[];
  firmName: string;
  busy: boolean;
  onClose: () => void;
  onPick: (customerId: string) => void;
}) {
  const [q, setQ] = useState(party.ledger_name.split(/\s+/)[0] ?? "");
  const matches = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    return customers.filter((c) => words.every((w) => c.name.toLowerCase().includes(w))).slice(0, 50);
  }, [q, customers]);

  return (
    <Modal open onClose={onClose} title={`Link “${party.ledger_name}”`} description="Pick the customer this ledger belongs to." wide>
      <SearchInput autoFocus placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
        {matches.length === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">No customers found.</li>}
        {matches.map((c) => {
          const taken = c.firmIds.includes(party.firm_id);
          return (
            <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div>
                <div className="text-sm text-slate-900">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.beat ?? "No beat"}
                  {taken && ` · already has a ${firmName} ledger`}
                </div>
              </div>
              <Button size="sm" disabled={busy || taken} onClick={() => onPick(c.id)}>
                Link
              </Button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
