"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Lock } from "lucide-react";
import { formatDate, formatINR } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { CustomerForm } from "../customer-form";
import { statusBadge } from "../customers-client";
import { saveCustomer, saveFirmAccount, setCustomerStatus, type CustomerInput, type FirmAccountInput } from "../actions";

export type Customer = {
  id: string;
  name: string;
  display_name_mr: string | null;
  customer_type: CustomerInput["customerType"];
  beat_id: string | null;
  whatsapp: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  town: string | null;
  status: "active" | "bad_debt" | "ignore";
  status_note: string | null;
  created_at: string;
};
export type Account = {
  id: string;
  firm_id: string;
  tally_ledger_name: string | null;
  credit_limit: string;
  credit_days: number;
  active: boolean;
};
type Beat = { id: string; name: string; territory_name: string };
type Firm = { id: string; code: string; name: string };
type Flash = { kind: "error" | "success"; text: string } | null;

export function CustomerDetail({
  customer: c,
  accounts,
  beats,
  firms,
  canEdit,
  canCredit,
  isOwner,
}: {
  customer: Customer;
  accounts: Account[];
  beats: Beat[];
  firms: Firm[];
  canEdit: boolean;
  canCredit: boolean;
  isOwner: boolean;
}) {
  const [form, setForm] = useState<CustomerInput>({
    id: c.id,
    name: c.name,
    displayNameMr: c.display_name_mr ?? "",
    customerType: c.customer_type,
    beatId: c.beat_id,
    whatsapp: c.whatsapp ?? "",
    phone: c.phone ?? "",
    gstin: c.gstin ?? "",
    address: c.address ?? "",
    town: c.town ?? "",
  });
  const [flash, setFlash] = useState<Flash>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string; ok?: string }>) {
    start(async () => {
      const res = await fn();
      setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
    });
  }

  const beat = beats.find((b) => b.id === c.beat_id);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/customers" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft className="h-4 w-4" /> Customers
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          {statusBadge[c.status]}
          {c.gstin && <Badge tone="blue">GST: {c.gstin}</Badge>}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {beat ? `${beat.name} · ${beat.territory_name}` : "No beat"} · added {formatDate(c.created_at)}
        </p>
      </div>

      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              {canEdit ? (
                <CustomerForm value={form} onChange={setForm} beats={beats} pending={pending} onSubmit={() => run(() => saveCustomer(form))} submitLabel="Save changes" />
              ) : (
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <dt className="text-slate-500">WhatsApp</dt>
                  <dd>{c.whatsapp ?? "—"}</dd>
                  <dt className="text-slate-500">Town</dt>
                  <dd>{c.town ?? "—"}</dd>
                  <dt className="text-slate-500">Address</dt>
                  <dd>{c.address ?? "—"}</dd>
                </dl>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {firms.map((f) => (
            <FirmAccountCard
              key={f.id}
              firm={f}
              customerId={c.id}
              account={accounts.find((a) => a.firm_id === f.id)}
              canEdit={canEdit}
              canCredit={canCredit}
              pending={pending}
              run={run}
            />
          ))}
          {isOwner && <StatusCard customer={c} pending={pending} run={run} />}
        </div>
      </div>
    </div>
  );
}

function FirmAccountCard({
  firm,
  customerId,
  account,
  canEdit,
  canCredit,
  pending,
  run,
}: {
  firm: Firm;
  customerId: string;
  account: Account | undefined;
  canEdit: boolean;
  canCredit: boolean;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>) => void;
}) {
  const [open, setOpen] = useState(!!account);
  const [v, setV] = useState<FirmAccountInput>({
    id: account?.id,
    customerId,
    firmId: firm.id,
    tallyLedgerName: account?.tally_ledger_name ?? "",
    creditLimit: account ? String(Number(account.credit_limit)) : "0",
    creditDays: account ? String(account.credit_days) : "0",
    active: account?.active ?? true,
  });

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-brand-700" /> {firm.name}
          </span>
        }
        description={account ? (account.active ? "Account open" : "Account closed") : "No account in this firm"}
      />
      <CardBody>
        {!open ? (
          canEdit || canCredit ? (
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
              Open account in {firm.code}
            </Button>
          ) : (
            <p className="text-sm text-slate-500">Not a customer of {firm.code}.</p>
          )
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveFirmAccount(v));
            }}
          >
            <Field label="Tally ledger name">
              <Input value={v.tallyLedgerName ?? ""} onChange={(e) => setV({ ...v, tallyLedgerName: e.target.value })} disabled={!canEdit} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Credit limit (₹)">
                <Input
                  inputMode="decimal"
                  value={v.creditLimit}
                  onChange={(e) => setV({ ...v, creditLimit: e.target.value })}
                  disabled={!canCredit}
                  className="num"
                />
              </Field>
              <Field label="Credit days">
                <Input
                  inputMode="numeric"
                  value={v.creditDays}
                  onChange={(e) => setV({ ...v, creditDays: e.target.value })}
                  disabled={!canCredit}
                  className="num"
                />
              </Field>
            </div>
            {!canCredit && (
              <p className="flex items-center gap-1.5 text-xs text-slate-500">
                <Lock className="h-3.5 w-3.5" /> Only the owner can change credit terms.
              </p>
            )}
            {account && Number(account.credit_limit) > 0 && (
              <p className="text-xs text-slate-500">
                Current: {formatINR(account.credit_limit)} for {account.credit_days} days
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} className="h-4 w-4" />
              Account active
            </label>
            <Button size="sm" disabled={pending} className="w-full">
              Save {firm.code} account
            </Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}

function StatusCard({
  customer: c,
  pending,
  run,
}: {
  customer: Customer;
  pending: boolean;
  run: (fn: () => Promise<{ error?: string; ok?: string }>) => void;
}) {
  const [status, setStatus] = useState(c.status);
  const [note, setNote] = useState(c.status_note ?? "");
  return (
    <Card>
      <CardHeader title="Collection status" description="Bad debt and ignore customers stay out of working totals." />
      <CardBody className="space-y-3">
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as Customer["status"])}>
            <option value="active">Active</option>
            <option value="bad_debt">Bad debt</option>
            <option value="ignore">Ignore</option>
          </Select>
        </Field>
        <Field label="Note">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why?" />
        </Field>
        <Button size="sm" variant="secondary" className="w-full" disabled={pending} onClick={() => run(() => setCustomerStatus(c.id, status, note))}>
          Update status
        </Button>
      </CardBody>
    </Card>
  );
}
