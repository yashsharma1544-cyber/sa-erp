"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { saveSupplier, type SupplierInput } from "./actions";

type Terms = {
  id: string;
  firm_id: string;
  tally_ledger_name: string | null;
  credit_days: number;
  cash_discount_pct: string;
  cash_discount_days: number | null;
  active: boolean;
};
export type SupplierRow = {
  id: string;
  name: string;
  kind: "tea" | "oil" | "other";
  whatsapp: string | null;
  phone: string | null;
  gstin: string | null;
  address: string | null;
  active: boolean;
  terms: Terms[];
};
type Firm = { id: string; code: string; name: string };

export function SuppliersClient({ suppliers, firms, canEdit }: { suppliers: SupplierRow[]; firms: Firm[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<SupplierInput | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const toInput = (s?: SupplierRow): SupplierInput => ({
    id: s?.id,
    name: s?.name ?? "",
    kind: s?.kind ?? "tea",
    whatsapp: s?.whatsapp ?? "",
    phone: s?.phone ?? "",
    gstin: s?.gstin ?? "",
    address: s?.address ?? "",
    active: s?.active ?? true,
    terms: firms.map((f) => {
      const t = s?.terms.find((x) => x.firm_id === f.id);
      return {
        id: t?.id,
        firmId: f.id,
        enabled: t ? t.active : f.code === "SA",
        tallyLedgerName: t?.tally_ledger_name ?? "",
        creditDays: String(t?.credit_days ?? (s?.kind === "oil" ? 15 : 21)),
        cashDiscountPct: t ? String(Number(t.cash_discount_pct)) : "0",
        cashDiscountDays: t?.cash_discount_days != null ? String(t.cash_discount_days) : "",
      };
    }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppliers"
        description="Credit days and early-payment discount per firm. Vikram: 21 days, 1% if paid within 7 days on the GST-inclusive value."
        actions={
          canEdit && (
            <Button onClick={() => setEditing(toInput())}>
              <Plus className="h-4 w-4" /> Supplier
            </Button>
          )
        }
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Supplier</TH>
              <TH>Kind</TH>
              <TH>Terms by firm</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {suppliers.map((s) => (
              <TR key={s.id} className={cn(!s.active && "opacity-50")}>
                <TD>
                  <div className="font-medium text-slate-900">{s.name}</div>
                  <div className="text-xs text-slate-500">{s.whatsapp ?? s.phone ?? ""}</div>
                </TD>
                <TD className="capitalize">{s.kind}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {s.terms
                      .filter((t) => t.active)
                      .map((t) => (
                        <Badge key={t.id} tone="blue">
                          {firms.find((f) => f.id === t.firm_id)?.code} · {t.credit_days} days
                          {Number(t.cash_discount_pct) > 0 && ` · ${Number(t.cash_discount_pct)}% in ${t.cash_discount_days}d`}
                        </Badge>
                      ))}
                  </div>
                </TD>
                <TD className="text-right">
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(toInput(s))} aria-label={`Edit ${s.name}`}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
            {suppliers.length === 0 && <EmptyRow colSpan={4}>No suppliers yet.</EmptyRow>}
          </tbody>
        </Table>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit supplier" : "New supplier"} wide>
        {editing && (
          <form
            className="space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await saveSupplier(editing);
                setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
                if (!res.error) setEditing(null);
              });
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name">
                <Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
              <Field label="Kind">
                <Select value={editing.kind} onChange={(e) => setEditing({ ...editing, kind: e.target.value as SupplierInput["kind"] })}>
                  <option value="tea">Tea</option>
                  <option value="oil">Oil</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="WhatsApp" hint="Purchase orders are sent here">
                <Input inputMode="tel" value={editing.whatsapp ?? ""} onChange={(e) => setEditing({ ...editing, whatsapp: e.target.value })} />
              </Field>
              <Field label="GSTIN">
                <Input value={editing.gstin ?? ""} onChange={(e) => setEditing({ ...editing, gstin: e.target.value.toUpperCase() })} />
              </Field>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Terms by firm</h3>
              {editing.terms.map((t, i) => {
                const firm = firms.find((f) => f.id === t.firmId)!;
                const setT = (patch: Partial<typeof t>) =>
                  setEditing({ ...editing, terms: editing.terms.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                return (
                  <div key={t.firmId} className="rounded-xl border border-slate-200 p-4">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input type="checkbox" checked={t.enabled} onChange={(e) => setT({ enabled: e.target.checked })} className="h-4 w-4" />
                      Buys in {firm.name}
                    </label>
                    {t.enabled && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <Field label="Tally ledger" className="sm:col-span-4">
                          <Input value={t.tallyLedgerName ?? ""} onChange={(e) => setT({ tallyLedgerName: e.target.value })} />
                        </Field>
                        <Field label="Credit days">
                          <Input inputMode="numeric" value={t.creditDays} onChange={(e) => setT({ creditDays: e.target.value })} />
                        </Field>
                        <Field label="Cash discount %">
                          <Input inputMode="decimal" value={t.cashDiscountPct} onChange={(e) => setT({ cashDiscountPct: e.target.value })} />
                        </Field>
                        <Field label="If paid within (days)">
                          <Input inputMode="numeric" value={t.cashDiscountDays ?? ""} onChange={(e) => setT({ cashDiscountDays: e.target.value })} />
                        </Field>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="h-4 w-4" />
              Active
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={pending}>{pending ? "Saving…" : "Save supplier"}</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
