"use client";

import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import type { CustomerInput } from "./actions";

type Beat = { id: string; name: string; territory_name: string };

export function blankCustomer(): CustomerInput {
  return {
    name: "",
    displayNameMr: "",
    customerType: "kirana",
    beatId: null,
    whatsapp: "",
    phone: "",
    gstin: "",
    address: "",
    town: "",
  };
}

export function CustomerForm({
  value: v,
  onChange,
  beats,
  pending,
  onSubmit,
  onCancel,
  submitLabel = "Save customer",
}: {
  value: CustomerInput;
  onChange: (v: CustomerInput) => void;
  beats: Beat[];
  pending: boolean;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const set = (patch: Partial<CustomerInput>) => onChange({ ...v, ...patch });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name (as in Tally)">
          <Input required value={v.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Name in Marathi" hint="Used in WhatsApp messages">
          <Input value={v.displayNameMr ?? ""} onChange={(e) => set({ displayNameMr: e.target.value })} />
        </Field>
        <Field label="Type">
          <Select value={v.customerType} onChange={(e) => set({ customerType: e.target.value as CustomerInput["customerType"] })}>
            <option value="kirana">Kirana</option>
            <option value="retailer">Retailer</option>
            <option value="wholesaler">Wholesaler</option>
            <option value="hotel">Hotel</option>
            <option value="counter">Counter (walk-in)</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Beat">
          <Select value={v.beatId ?? ""} onChange={(e) => set({ beatId: e.target.value || null })}>
            <option value="">No beat</option>
            {beats.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.territory_name})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="WhatsApp" hint="10-digit mobile; 91 prefix optional">
          <Input inputMode="tel" value={v.whatsapp ?? ""} onChange={(e) => set({ whatsapp: e.target.value })} />
          <label className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={!!v.waOptOut} onChange={(e) => set({ waOptOut: e.target.checked })} />
            Don&apos;t send WhatsApp receipts or reminders
          </label>
        </Field>
        <Field label="Phone">
          <Input inputMode="tel" value={v.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} />
        </Field>
        <Field label="GSTIN" hint="Only if they need a tax invoice">
          <Input value={v.gstin ?? ""} onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} className="uppercase" />
        </Field>
        <Field label="Town / village">
          <Input value={v.town ?? ""} onChange={(e) => set({ town: e.target.value })} />
        </Field>
      </div>
      <Field label="Address">
        <Input value={v.address ?? ""} onChange={(e) => set({ address: e.target.value })} />
      </Field>
      <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={pending}>{pending ? "Saving…" : submitLabel}</Button>
      </div>
    </form>
  );
}
