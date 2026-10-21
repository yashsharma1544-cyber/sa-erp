"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Landmark, Pencil, Plus } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { saveBankAccount } from "./actions";

export type BankAccountRow = {
  id: string;
  firm_id: string;
  bank: string;
  branch: string | null;
  account_last4: string | null;
  tally_ledger_name: string | null;
  active: boolean;
};
type Firm = { id: string; code: string; name: string };
type Ledger = { firm_id: string; ledger_name: string; tally_group: string };
type Form = { id?: string; firmId: string; bank: string; branch: string; last4: string; tallyLedgerName: string; active: boolean };

/** Bank accounts cash is deposited into, per firm. */
export function BankAccountsCard({
  accounts, firms, ledgers, canEdit,
}: {
  accounts: BankAccountRow[];
  firms: Firm[];
  ledgers: Ledger[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const open = (a?: BankAccountRow) =>
    setForm({
      id: a?.id,
      firmId: a?.firm_id ?? firms[0]?.id ?? "",
      bank: a?.bank ?? "",
      branch: a?.branch ?? "",
      last4: a?.account_last4 ?? "",
      tallyLedgerName: a?.tally_ledger_name ?? "",
      active: a?.active ?? true,
    });

  return (
    <Card>
      <CardHeader
        title="Bank accounts for cash deposits"
        description="Only these appear when accounts records a deposit."
        action={
          canEdit && (
            <Button size="sm" variant="secondary" onClick={() => open()}>
              <Plus className="h-4 w-4" /> Bank account
            </Button>
          )
        }
      />
      <ul className="divide-y divide-slate-100">
        {accounts.length === 0 && <li className="px-5 py-4 text-sm text-amber-700">None yet. Add each firm&apos;s deposit account.</li>}
        {accounts.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
            <Landmark className="h-4 w-4 text-slate-400" />
            <span className="w-10 font-medium text-slate-500">{firms.find((f) => f.id === a.firm_id)?.code}</span>
            <span className="flex-1">
              <span className="font-medium">{a.bank}</span>
              {a.account_last4 && <span className="text-slate-500"> ••{a.account_last4}</span>}
              {a.branch && <span className="text-slate-500"> · {a.branch}</span>}
              {a.tally_ledger_name && <span className="block text-xs text-slate-500">Tally: {a.tally_ledger_name}</span>}
            </span>
            {!a.active && <Badge>Not in use</Badge>}
            {canEdit && (
              <button onClick={() => open(a)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label="Edit">
                <Pencil className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? "Edit bank account" : "Add bank account"}>
        {form && (
          <div className="space-y-3">
            {error && <Alert kind="error">{error}</Alert>}
            <Field label="Firm">
              <Select value={form.firmId} onChange={(e) => setForm({ ...form, firmId: e.target.value, tallyLedgerName: "" })} disabled={!!form.id}>
                {firms.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tally ledger">
              <Select
                value={form.tallyLedgerName}
                onChange={(e) => setForm({ ...form, tallyLedgerName: e.target.value, bank: form.bank || e.target.value })}
              >
                <option value="">—</option>
                {ledgers
                  .filter((l) => l.firm_id === form.firmId)
                  .map((l) => (
                    <option key={l.ledger_name} value={l.ledger_name}>
                      {l.ledger_name} ({l.tally_group})
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Bank name">
              <Input value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Branch">
                <Input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} />
              </Field>
              <Field label="Account last 4 digits">
                <Input inputMode="numeric" value={form.last4} onChange={(e) => setForm({ ...form, last4: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> In use
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setForm(null)}>
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await saveBankAccount(form);
                    if (r.error) setError(r.error);
                    else {
                      setError(null);
                      setForm(null);
                      router.refresh();
                    }
                  })
                }
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Card>
  );
}
