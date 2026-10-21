"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Camera, Landmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { bounceCheque, clearCheque, depositCheques, returnCheque, setBounceCharge } from "./actions";

type Status = "in_hand" | "deposited" | "cleared" | "bounced" | "returned";
type Bounce = { id: string; charge_amount: string; charge_status: "pending" | "raised" | "waived"; debit_note_ref: string | null };
export type ChequeRow = {
  id: string;
  status: Status;
  deposited_on: string | null;
  cleared_on: string | null;
  bounced_on: string | null;
  bounce_reason: string | null;
  note: string | null;
  bank: { bank: string; account_last4: string | null } | null;
  receipt: {
    id: string;
    receipt_no: string;
    firm_id: string;
    amount: string;
    collected_on: string;
    cheque_no: string | null;
    cheque_date: string | null;
    cheque_bank: string | null;
    cheque_photo_path: string | null;
    customer: { name: string } | null;
    collector: { full_name: string } | null;
  } | null;
  bounce: Bounce | Bounce[] | null;
};
type Bank = { id: string; firm_id: string; bank: string; account_last4: string | null };
type Firm = { id: string; code: string; name: string };
type Dialog =
  | { kind: "deposit" }
  | { kind: "clear"; cheque: ChequeRow }
  | { kind: "bounce"; cheque: ChequeRow }
  | { kind: "return"; cheque: ChequeRow }
  | { kind: "charge"; cheque: ChequeRow; bounce: Bounce };

const TABS: { key: Status; label: string }[] = [
  { key: "in_hand", label: "In hand" },
  { key: "deposited", label: "Deposited" },
  { key: "bounced", label: "Bounced" },
  { key: "cleared", label: "Cleared" },
  { key: "returned", label: "Returned" },
];
const bounceOf = (c: ChequeRow): Bounce | null => (Array.isArray(c.bounce) ? (c.bounce[0] ?? null) : c.bounce);

export function ChequesClient({
  cheques, banks, firms, canManage, isOwner, today,
}: {
  cheques: ChequeRow[];
  banks: Bank[];
  firms: Firm[];
  canManage: boolean;
  isOwner: boolean;
  today: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Status>("in_hand");
  const [firmId, setFirmId] = useState(firms[0]?.id ?? "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const counts = useMemo(() => {
    const c: Record<Status, number> = { in_hand: 0, deposited: 0, cleared: 0, bounced: 0, returned: 0 };
    for (const x of cheques) if (x.receipt?.firm_id === firmId) c[x.status]++;
    return c;
  }, [cheques, firmId]);
  const shown = cheques.filter((c) => c.status === tab && c.receipt?.firm_id === firmId);
  const total = shown.reduce((s, c) => s + Number(c.receipt?.amount ?? 0), 0);
  const pendingCharges = cheques.filter((c) => c.receipt?.firm_id === firmId && bounceOf(c)?.charge_status === "pending").length;

  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) {
        setDialog(null);
        setSelected(new Set());
        router.refresh();
      }
    });

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Cheques"
        description="From the collector to the bank. A bounce takes the payment off the customer, books the bounce charge and alerts the owner."
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}
      {pendingCharges > 0 && (
        <Alert kind="info">
          {formatNumber(pendingCharges)} bounce charge(s) still to be raised as a debit note in Tally. See the Bounced tab.
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setFirmId(f.id);
              setSelected(new Set());
            }}
            className={cn("rounded-lg px-3 py-1.5 text-sm font-medium", f.id === firmId ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200")}
          >
            {f.name}
          </button>
        ))}
        <span className="mx-2 h-5 w-px bg-slate-200" />
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setSelected(new Set());
            }}
            className={cn("rounded-full px-3 py-1 text-sm", t.key === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t.label} <span className="opacity-70">{formatNumber(counts[t.key])}</span>
          </button>
        ))}
      </div>

      <Card>
        {tab === "in_hand" && canManage && selected.size > 0 && (
          <div className="flex items-center gap-3 border-b border-slate-100 bg-brand-50/60 px-4 py-3 text-sm">
            <span className="font-medium">
              {formatNumber(selected.size)} selected ·{" "}
              {formatINR(shown.filter((c) => selected.has(c.id)).reduce((s, c) => s + Number(c.receipt?.amount ?? 0), 0))}
            </span>
            <Button size="sm" onClick={() => setDialog({ kind: "deposit" })}>
              <Landmark className="h-4 w-4" /> Deposit
            </Button>
          </div>
        )}
        <Table>
          <THead>
            <tr>
              {tab === "in_hand" && canManage && <TH className="w-10" />}
              <TH>Customer</TH>
              <TH>Cheque</TH>
              <TH className="text-right">Amount</TH>
              <TH>{tab === "in_hand" ? "Collected" : tab === "deposited" ? "Deposited" : tab === "cleared" ? "Cleared" : tab === "bounced" ? "Bounced" : "Note"}</TH>
              <TH className="text-right" />
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={6}>No cheques here.</EmptyRow>}
            {shown.map((c) => {
              const r = c.receipt;
              const b = bounceOf(c);
              const postDated = !!r?.cheque_date && r.cheque_date > today;
              return (
                <TR key={c.id}>
                  {tab === "in_hand" && canManage && (
                    <TD>
                      <input type="checkbox" disabled={postDated} checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={r?.cheque_no ?? ""} />
                    </TD>
                  )}
                  <TD>
                    <div className="font-medium text-slate-900">{r?.customer?.name}</div>
                    <div className="text-xs text-slate-500">
                      {r?.receipt_no} · {r?.collector?.full_name}
                    </div>
                  </TD>
                  <TD>
                    <div>
                      {r?.cheque_bank} · {r?.cheque_no}
                    </div>
                    <div className={cn("text-xs", postDated ? "font-medium text-amber-700" : "text-slate-500")}>
                      Dated {r?.cheque_date ? formatDate(r.cheque_date) : "—"}
                      {postDated && " · post-dated"}
                    </div>
                  </TD>
                  <TD className="num whitespace-nowrap text-right font-semibold">{formatINR(r?.amount ?? 0)}</TD>
                  <TD className="text-sm">
                    {tab === "in_hand" && r && formatDate(r.collected_on)}
                    {tab === "deposited" && c.deposited_on && (
                      <>
                        {formatDate(c.deposited_on)}
                        <div className="text-xs text-slate-500">
                          {c.bank?.bank}
                          {c.bank?.account_last4 ? ` ••${c.bank.account_last4}` : ""}
                        </div>
                      </>
                    )}
                    {tab === "cleared" && c.cleared_on && formatDate(c.cleared_on)}
                    {tab === "bounced" && (
                      <>
                        {c.bounced_on && formatDate(c.bounced_on)} · {c.bounce_reason}
                        {b && (
                          <div className="mt-1">
                            {b.charge_status === "pending" && <Badge tone="amber">Charge {formatINR(b.charge_amount)} to raise</Badge>}
                            {b.charge_status === "raised" && <Badge tone="green">Charge raised · {b.debit_note_ref}</Badge>}
                            {b.charge_status === "waived" && <Badge>Charge waived</Badge>}
                          </div>
                        )}
                      </>
                    )}
                    {tab === "returned" && c.note}
                  </TD>
                  <TD className="text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {r?.cheque_photo_path && (
                        <a href={`/api/cheque-photo/${r.id}`} target="_blank" rel="noreferrer">
                          <Button size="sm" variant="ghost">
                            <Camera className="h-4 w-4" />
                          </Button>
                        </a>
                      )}
                      {canManage && tab === "in_hand" && (
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: "return", cheque: c })}>
                          Return
                        </Button>
                      )}
                      {canManage && tab === "deposited" && (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "clear", cheque: c })}>
                            Cleared
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "bounce", cheque: c })}>
                            Bounced
                          </Button>
                        </>
                      )}
                      {canManage && tab === "cleared" && (
                        <Button size="sm" variant="danger" onClick={() => setDialog({ kind: "bounce", cheque: c })}>
                          Bounced
                        </Button>
                      )}
                      {canManage && tab === "bounced" && b?.charge_status === "pending" && (
                        <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "charge", cheque: c, bounce: b })}>
                          Charge…
                        </Button>
                      )}
                    </div>
                  </TD>
                </TR>
              );
            })}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="border-t border-slate-200 bg-slate-50 text-sm font-semibold">
                <td colSpan={tab === "in_hand" && canManage ? 3 : 2} className="px-4 py-2.5">
                  {formatNumber(shown.length)} cheques
                </td>
                <td className="num px-4 py-2.5 text-right">{formatINR(total)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </Table>
      </Card>

      {dialog && (
        <ChequeDialog
          dialog={dialog}
          banks={banks.filter((b) => b.firm_id === firmId)}
          today={today}
          isOwner={isOwner}
          pending={pending}
          onClose={() => setDialog(null)}
          onDeposit={(bankId, on) => run(() => depositCheques([...selected], bankId, on))}
          onClear={(c, on) => run(() => clearCheque(c.id, on))}
          onBounce={(c, on, reason) => run(() => bounceCheque(c.id, on, reason))}
          onReturn={(c, note) => run(() => returnCheque(c.id, note))}
          onCharge={(b, status, ref) => run(() => setBounceCharge(b.id, status, ref))}
        />
      )}
    </div>
  );
}

function ChequeDialog({
  dialog, banks, today, isOwner, pending, onClose, onDeposit, onClear, onBounce, onReturn, onCharge,
}: {
  dialog: Dialog;
  banks: Bank[];
  today: string;
  isOwner: boolean;
  pending: boolean;
  onClose: () => void;
  onDeposit: (bankId: string, on: string) => void;
  onClear: (c: ChequeRow, on: string) => void;
  onBounce: (c: ChequeRow, on: string, reason: string) => void;
  onReturn: (c: ChequeRow, note: string) => void;
  onCharge: (b: Bounce, status: "raised" | "waived", ref: string) => void;
}) {
  const [on, setOn] = useState(today);
  const [text, setText] = useState("");
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const title =
    dialog.kind === "deposit" ? "Deposit cheques" : dialog.kind === "clear" ? "Cheque cleared" : dialog.kind === "bounce" ? "Cheque bounced" : dialog.kind === "return" ? "Return cheque" : "Bounce charge";
  const sub = dialog.kind !== "deposit" ? `${dialog.cheque.receipt?.customer?.name} · ${formatINR(dialog.cheque.receipt?.amount ?? 0)}` : undefined;

  return (
    <Modal open onClose={onClose} title={title} description={sub}>
      <div className="space-y-3">
        {dialog.kind === "deposit" &&
          (banks.length === 0 ? (
            <Alert kind="info">No bank account set up for this firm. Add one on Setup → Firms &amp; settings.</Alert>
          ) : (
            <Field label="Bank account">
              <Select value={bankId} onChange={(e) => setBankId(e.target.value)}>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank}
                    {b.account_last4 ? ` ••${b.account_last4}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        {dialog.kind !== "return" && dialog.kind !== "charge" && (
          <Field label="Date">
            <Input type="date" max={today} value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
        )}
        {dialog.kind === "bounce" && (
          <>
            <Field label="Reason (as on the bank memo)">
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Funds insufficient" />
            </Field>
            <p className="text-sm text-slate-500">
              The payment comes off the customer, the bounce charge from settings is booked to raise in Tally, and you get an alert.
            </p>
          </>
        )}
        {dialog.kind === "return" && (
          <Field label="Why is it going back?">
            <Input value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        {dialog.kind === "charge" && (
          <Field label="Tally debit note number">
            <Input value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {dialog.kind === "charge" && isOwner && (
            <Button variant="danger" disabled={pending} onClick={() => onCharge(dialog.bounce, "waived", "")}>
              Waive charge
            </Button>
          )}
          <Button
            disabled={pending || (dialog.kind === "deposit" && !bankId) || ((dialog.kind === "bounce" || dialog.kind === "return" || dialog.kind === "charge") && !text.trim())}
            variant={dialog.kind === "bounce" ? "danger" : "primary"}
            onClick={() => {
              if (dialog.kind === "deposit") onDeposit(bankId, on);
              if (dialog.kind === "clear") onClear(dialog.cheque, on);
              if (dialog.kind === "bounce") onBounce(dialog.cheque, on, text);
              if (dialog.kind === "return") onReturn(dialog.cheque, text);
              if (dialog.kind === "charge") onCharge(dialog.bounce, "raised", text);
            }}
          >
            {dialog.kind === "charge" ? "Mark raised" : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
