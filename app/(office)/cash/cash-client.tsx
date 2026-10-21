"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { acceptHandover, cancelHandover, recordDeposit, takeHandover } from "./actions";

export type CollectorRow = {
  collector_id: string;
  collector_name: string;
  in_hand: string;
  in_hand_receipts: number;
  oldest_in_hand: string | null;
  waiting_handovers: number;
  waiting_amount: string;
  short_excess: string;
  handovers_counted: number;
};
type ReceiptLite = { id: string; receipt_no: string; amount: string; collected_on: string; firm_id: string; customer: { name: string } | null };
export type HandoverRow = {
  id: string;
  handover_no: string;
  collector_id: string;
  handed_at: string;
  expected_cash: string;
  declared: Notes | null;
  declared_total: string | null;
  counted: Notes | null;
  counted_total: string | null;
  variance: string | null;
  status: "submitted" | "accepted";
  note: string | null;
  counted_at: string | null;
  collector: { full_name: string } | null;
  counter: { full_name: string } | null;
  items: { deleted_at: string | null; receipt: ReceiptLite | null }[];
};
export type PoolReceipt = ReceiptLite & { collector: { full_name: string } | null };
export type DepositRow = {
  id: string;
  firm_id: string;
  deposited_on: string;
  slip_no: string | null;
  amount: string;
  expected_amount: string;
  variance: string;
  note: string | null;
  bank: { bank: string; account_last4: string | null } | null;
  by: { full_name: string } | null;
};
type Bank = { id: string; firm_id: string; bank: string; branch: string | null; account_last4: string | null };
type Firm = { id: string; code: string; name: string };
type Notes = Partial<Record<Denom, number>>;
type Denom = "500" | "200" | "100" | "50" | "20" | "10" | "coins";

const DENOMS: { key: Denom; label: string; value: number }[] = [
  { key: "500", label: "₹500", value: 500 },
  { key: "200", label: "₹200", value: 200 },
  { key: "100", label: "₹100", value: 100 },
  { key: "50", label: "₹50", value: 50 },
  { key: "20", label: "₹20", value: 20 },
  { key: "10", label: "₹10", value: 10 },
];
const n = (v: string | number | null | undefined) => Number(v ?? 0);
export const notesTotal = (x: Notes | null | undefined) =>
  DENOMS.reduce((s, d) => s + (x?.[d.key] ?? 0) * d.value, 0) + (x?.coins ?? 0);

function Variance({ value }: { value: number }) {
  if (value === 0) return <span className="text-slate-500">—</span>;
  return <span className={value < 0 ? "font-medium text-red-700" : "font-medium text-amber-700"}>{value < 0 ? "Short " : "Excess "}{formatINR(Math.abs(value))}</span>;
}

type Tab = "collectors" | "deposit" | "history";

export function CashClient({
  collectors, handovers, pool, deposits, banks, firms, canCount, canDeposit, today,
}: {
  collectors: CollectorRow[];
  handovers: HandoverRow[];
  pool: PoolReceipt[];
  deposits: DepositRow[];
  banks: Bank[];
  firms: Firm[];
  canCount: boolean;
  canDeposit: boolean;
  today: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(canCount ? "collectors" : "deposit");
  const [counting, setCounting] = useState<HandoverRow | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const waiting = handovers.filter((h) => h.status === "submitted");
  const accepted = handovers.filter((h) => h.status === "accepted");
  const inHand = collectors.reduce((s, c) => s + n(c.in_hand), 0);
  const waitingAmt = waiting.reduce((s, h) => s + n(h.expected_cash), 0);
  const poolAmt = pool.reduce((s, r) => s + n(r.amount), 0);
  const monthVariance = collectors.reduce((s, c) => s + n(c.short_excess), 0);

  const run = (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) {
        after?.();
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cash & deposits"
        description="Each collector's cash is counted and accepted on its own, so any shortage stays with that person. Counted cash is then deposited per firm."
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="With collectors" value={formatINR(inHand)} sub="Not handed over yet" />
        <Stat label="Waiting to be counted" value={formatINR(waitingAmt)} sub={`${formatNumber(waiting.length)} handovers`} />
        <Stat label="Counted, not deposited" value={formatINR(poolAmt)} sub={`${formatNumber(pool.length)} receipts`} />
        <Stat label="Short / excess this month" value={<Variance value={monthVariance} />} sub="All collectors" />
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ...(canCount ? [["collectors", "Collectors & handovers"]] : []),
            ...(canDeposit ? [["deposit", "Deposit"]] : []),
            ["history", "History"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn("rounded-full px-3 py-1 text-sm", k === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "collectors" && (
        <>
          <Card>
            <CardHeader title="Waiting to be counted" description="Count the notes in front of the collector, then accept." />
            <Table>
              <THead>
                <tr>
                  <TH>Handover</TH>
                  <TH>Collector</TH>
                  <TH className="text-right">Receipts say</TH>
                  <TH className="text-right">Collector says</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {waiting.length === 0 && <EmptyRow colSpan={5}>Nothing waiting.</EmptyRow>}
                {waiting.map((h) => (
                  <TR key={h.id}>
                    <TD>
                      <div className="font-medium">{h.handover_no}</div>
                      <div className="text-xs text-slate-500">{formatDateTime(h.handed_at)}</div>
                    </TD>
                    <TD>{h.collector?.full_name}</TD>
                    <TD className="num text-right font-semibold">{formatINR(h.expected_cash)}</TD>
                    <TD className="num text-right">{h.declared_total ? formatINR(h.declared_total) : <span className="text-slate-400">not given</span>}</TD>
                    <TD className="text-right">
                      <Button size="sm" onClick={() => setCounting(h)}>
                        <Banknote className="h-4 w-4" /> Count
                      </Button>
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <CardHeader title="Collectors" description="Cash they hold that hasn't been handed over, and their short / excess this month." />
            <Table>
              <THead>
                <tr>
                  <TH>Collector</TH>
                  <TH className="text-right">Cash in hand</TH>
                  <TH className="hidden md:table-cell">Oldest</TH>
                  <TH className="text-right">Short / excess</TH>
                  <TH />
                </tr>
              </THead>
              <tbody>
                {collectors.length === 0 && <EmptyRow colSpan={5}>No cash collected yet.</EmptyRow>}
                {collectors.map((c) => (
                  <TR key={c.collector_id}>
                    <TD className="font-medium">{c.collector_name}</TD>
                    <TD className="num text-right">
                      {formatINR(c.in_hand)}
                      <div className="text-xs text-slate-500">{formatNumber(c.in_hand_receipts)} receipts</div>
                    </TD>
                    <TD className="hidden md:table-cell">{c.oldest_in_hand ? formatDate(c.oldest_in_hand) : "—"}</TD>
                    <TD className="text-right">
                      <Variance value={n(c.short_excess)} />
                      <div className="text-xs text-slate-500">{formatNumber(c.handovers_counted)} counted</div>
                    </TD>
                    <TD className="text-right">
                      {n(c.in_hand) > 0 && (
                        <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => takeHandover(c.collector_id))}>
                          Take handover
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {tab === "deposit" && <DepositPanel firms={firms} banks={banks} pool={pool} today={today} pending={pending} run={run} />}

      {tab === "history" && (
        <>
          <Card>
            <CardHeader title="Counted handovers" />
            <Table>
              <THead>
                <tr>
                  <TH>Handover</TH>
                  <TH>Collector</TH>
                  <TH className="text-right">Receipts</TH>
                  <TH className="text-right">Counted</TH>
                  <TH className="text-right">Difference</TH>
                  <TH className="hidden lg:table-cell">Note</TH>
                </tr>
              </THead>
              <tbody>
                {accepted.length === 0 && <EmptyRow colSpan={6}>None yet.</EmptyRow>}
                {accepted.map((h) => (
                  <TR key={h.id}>
                    <TD>
                      <div className="font-medium">{h.handover_no}</div>
                      <div className="text-xs text-slate-500">
                        {h.counted_at ? formatDateTime(h.counted_at) : ""} · {h.counter?.full_name}
                      </div>
                    </TD>
                    <TD>{h.collector?.full_name}</TD>
                    <TD className="num text-right">{formatINR(h.expected_cash)}</TD>
                    <TD className="num text-right">{formatINR(h.counted_total)}</TD>
                    <TD className="text-right">
                      <Variance value={n(h.variance)} />
                    </TD>
                    <TD className="hidden max-w-xs truncate text-sm text-slate-500 lg:table-cell">{h.note}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Deposits" />
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Firm · bank</TH>
                  <TH>Slip</TH>
                  <TH className="text-right">Cash receipts</TH>
                  <TH className="text-right">Slip amount</TH>
                  <TH className="text-right">Difference</TH>
                </tr>
              </THead>
              <tbody>
                {deposits.length === 0 && <EmptyRow colSpan={6}>None yet.</EmptyRow>}
                {deposits.map((d) => (
                  <TR key={d.id}>
                    <TD>{formatDate(d.deposited_on)}</TD>
                    <TD>
                      {firms.find((f) => f.id === d.firm_id)?.code} · {d.bank?.bank}
                      {d.bank?.account_last4 ? ` ••${d.bank.account_last4}` : ""}
                    </TD>
                    <TD>{d.slip_no ?? "—"}</TD>
                    <TD className="num text-right">{formatINR(d.expected_amount)}</TD>
                    <TD className="num text-right">{formatINR(d.amount)}</TD>
                    <TD className="text-right">
                      <Variance value={n(d.variance)} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}

      {counting && (
        <CountModal
          handover={counting}
          firms={firms}
          pending={pending}
          onClose={() => setCounting(null)}
          onAccept={(counted, note) => run(() => acceptHandover(counting.id, counted, note), () => setCounting(null))}
          onCancel={(note) => run(() => cancelHandover(counting.id, note), () => setCounting(null))}
        />
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="text-sm font-medium text-slate-500">{label}</div>
      <div className="num mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      {sub && <div className="mt-1 text-sm text-slate-500">{sub}</div>}
    </div>
  );
}

function CountModal({
  handover: h, firms, pending, onClose, onAccept, onCancel,
}: {
  handover: HandoverRow;
  firms: Firm[];
  pending: boolean;
  onClose: () => void;
  onAccept: (counted: Notes, note: string) => void;
  onCancel: (note: string) => void;
}) {
  const [counts, setCounts] = useState<Record<Denom, string>>({ "500": "", "200": "", "100": "", "50": "", "20": "", "10": "", coins: "" });
  const [note, setNote] = useState("");
  const notes: Notes = Object.fromEntries(
    Object.entries(counts).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)]),
  ) as Notes;
  const total = notesTotal(notes);
  const diff = total - n(h.expected_cash);
  const receipts = h.items.filter((i) => !i.deleted_at && i.receipt).map((i) => i.receipt!);

  return (
    <Modal open onClose={onClose} title={`Count ${h.handover_no}`} description={`${h.collector?.full_name} · receipts say ${formatINR(h.expected_cash)}`} wide>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          {DENOMS.map((d) => (
            <div key={d.key} className="flex items-center gap-3">
              <span className="w-14 text-sm font-medium text-slate-700">{d.label}</span>
              <span className="text-slate-400">×</span>
              <Input
                inputMode="numeric"
                className="w-24"
                value={counts[d.key]}
                onChange={(e) => setCounts({ ...counts, [d.key]: e.target.value.replace(/\D/g, "").slice(0, 5) })}
              />
              <span className="num flex-1 text-right text-sm text-slate-600">{formatINR((Number(counts[d.key]) || 0) * d.value)}</span>
              {h.declared?.[d.key] != null && <span className="w-16 text-right text-xs text-slate-400">said {h.declared[d.key]}</span>}
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="w-14 text-sm font-medium text-slate-700">Coins</span>
            <span className="text-slate-400">₹</span>
            <Input
              inputMode="decimal"
              className="w-24"
              value={counts.coins}
              onChange={(e) => setCounts({ ...counts, coins: e.target.value.replace(/[^\d.]/g, "").slice(0, 9) })}
            />
            <span className="flex-1" />
            {h.declared?.coins != null && <span className="w-16 text-right text-xs text-slate-400">said ₹{h.declared.coins}</span>}
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <span>Counted</span>
              <span className="num font-semibold">{formatINR(total)}</span>
            </div>
            <div className="flex justify-between">
              <span>Receipts</span>
              <span className="num">{formatINR(h.expected_cash)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1">
              <span>Difference</span>
              <Variance value={Math.round(diff * 100) / 100} />
            </div>
          </div>
          <Field label={diff !== 0 ? "Note (required for a difference)" : "Note"}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-2 text-sm font-medium text-slate-600">{formatNumber(receipts.length)} receipts in this handover</div>
          <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex justify-between gap-2 px-3 py-2">
                <span>
                  <span className="font-medium">{r.customer?.name}</span>
                  <span className="block text-xs text-slate-500">
                    {r.receipt_no} · {formatDate(r.collected_on)} · {firms.find((f) => f.id === r.firm_id)?.code}
                  </span>
                </span>
                <span className="num">{formatINR(r.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <Button variant="danger" disabled={pending} onClick={() => onCancel(note)}>
          Cancel handover
        </Button>
        <Button disabled={pending || (diff !== 0 && !note.trim())} onClick={() => onAccept(notes, note)}>
          Accept {formatINR(total)}
        </Button>
      </div>
    </Modal>
  );
}

function DepositPanel({
  firms, banks, pool, today, pending, run,
}: {
  firms: Firm[];
  banks: Bank[];
  pool: PoolReceipt[];
  today: string;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) => void;
}) {
  const [firmId, setFirmId] = useState(firms[0]?.id ?? "");
  const firmPool = useMemo(() => pool.filter((r) => r.firm_id === firmId), [pool, firmId]);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const chosen = picked ?? new Set(firmPool.map((r) => r.id));
  const expected = firmPool.filter((r) => chosen.has(r.id)).reduce((s, r) => s + n(r.amount), 0);
  const firmBanks = banks.filter((b) => b.firm_id === firmId);
  const [bankId, setBankId] = useState("");
  const [date, setDate] = useState(today);
  const [slip, setSlip] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const diff = amount ? Number(amount) - expected : 0;

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-5">
      <Card className="lg:col-span-3">
        <CardHeader
          title="Counted cash to deposit"
          action={
            <Select
              value={firmId}
              onChange={(e) => {
                setFirmId(e.target.value);
                setPicked(null);
                setBankId("");
              }}
              className="w-48"
            >
              {firms.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </Select>
          }
        />
        <Table>
          <THead>
            <tr>
              <TH className="w-10" />
              <TH>Receipt</TH>
              <TH>Collector</TH>
              <TH className="text-right">Amount</TH>
            </tr>
          </THead>
          <tbody>
            {firmPool.length === 0 && <EmptyRow colSpan={4}>No counted cash waiting for this firm.</EmptyRow>}
            {firmPool.map((r) => (
              <TR key={r.id}>
                <TD>
                  <input type="checkbox" checked={chosen.has(r.id)} onChange={() => toggle(r.id)} aria-label={r.receipt_no} />
                </TD>
                <TD>
                  <div className="font-medium">{r.customer?.name}</div>
                  <div className="text-xs text-slate-500">
                    {r.receipt_no} · {formatDate(r.collected_on)}
                  </div>
                </TD>
                <TD>{r.collector?.full_name}</TD>
                <TD className="num text-right">{formatINR(r.amount)}</TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card className="h-fit lg:col-span-2">
        <CardHeader title="Deposit slip" description={`${formatNumber(chosen.size)} receipts · ${formatINR(expected)}`} />
        <div className="space-y-3 px-5 py-4">
          {firmBanks.length === 0 ? (
            <Alert kind="info">
              No bank account set up for this firm. Add one on Setup → Firms &amp; settings.
            </Alert>
          ) : (
            <Field label="Bank account">
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                <option value="">Choose…</option>
                {firmBanks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank}
                    {b.account_last4 ? ` ••${b.account_last4}` : ""}
                    {b.branch ? ` · ${b.branch}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Deposit date">
            <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Slip number">
            <Input value={slip} onChange={(e) => setSlip(e.target.value)} />
          </Field>
          <Field label="Amount on the slip (₹)">
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          {amount && (
            <div className="flex justify-between rounded-lg bg-slate-50 p-3 text-sm">
              <span>Difference</span>
              <Variance value={Math.round(diff * 100) / 100} />
            </div>
          )}
          <Field label="Note">
            <Input value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <Button
            className="w-full"
            disabled={pending || !bankId || !amount || chosen.size === 0}
            onClick={() =>
              run(
                () =>
                  recordDeposit({
                    firmId, bankAccountId: bankId, depositedOn: date, slipNo: slip || undefined, amount,
                    receiptIds: [...chosen], note: note || undefined,
                  }),
                () => {
                  setPicked(null);
                  setAmount("");
                  setSlip("");
                  setNote("");
                },
              )
            }
          >
            <Landmark className="h-4 w-4" /> Record deposit
          </Button>
        </div>
      </Card>
    </div>
  );
}

