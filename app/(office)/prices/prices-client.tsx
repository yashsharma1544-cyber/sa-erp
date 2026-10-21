"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { formatDate, formatINR } from "@/lib/format";
import { roundHalfUp } from "@/lib/orders/math";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input, Select } from "@/components/ui/field";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { savePrices } from "./actions";

type Firm = { id: string; code: string; name: string; gst_registered: boolean };
export type PriceRow = {
  item_id: string;
  name: string;
  brand: string | null;
  category: string;
  unit: string;
  kg_per_unit: number;
  gst_rate: number;
  active: boolean;
  rate: string | null;
  effective_from: string | null;
  source: "manual" | "tally" | null;
};

export function PricesClient({ firms, firm, rows, canEdit }: { firms: Firm[]; firm: Firm; rows: PriceRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) => (!onlyActive || r.active) && (!category || r.category === category) && (!q || r.name.toLowerCase().includes(q) || (r.brand ?? "").toLowerCase().includes(q)),
    );
  }, [rows, query, category, onlyActive]);
  const changed = Object.entries(edits).filter(([id, v]) => {
    const r = rows.find((x) => x.item_id === id);
    return v.trim() !== "" && Number(v) !== Number(r?.rate ?? NaN);
  });
  const missing = rows.filter((r) => r.active && !r.rate).length;

  const save = () =>
    start(async () => {
      const res = await savePrices({ firmId: firm.id, rates: changed.map(([itemId, rate]) => ({ itemId, rate: rate.trim() })) });
      setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
      if (!res.error) {
        setEdits({});
        router.refresh();
      }
    });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Price list"
        description={
          <>
            One rate per item for {firm.name}, per Tally billing unit and before GST, the same as the rate on the Tally bill.
            Orders use today&apos;s rate; a lower rate on an order needs a discount approval. A change applies from today and the
            old rate stays in the history.
          </>
        }
        actions={
          canEdit && (
            <Button disabled={pending || changed.length === 0} onClick={save}>
              Save {changed.length > 0 ? `${changed.length} change${changed.length > 1 ? "s" : ""}` : "changes"}
            </Button>
          )
        }
      />
      <div className="flex flex-wrap gap-2">
        {firms.map((f) => (
          <button
            key={f.id}
            onClick={() => {
              setEdits({});
              router.push(`/prices?firm=${f.code}`);
            }}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              f.id === firm.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50",
            )}
          >
            {f.name}
          </button>
        ))}
      </div>
      {missing > 0 && <Alert kind="info">{missing} active items have no rate for {firm.code} yet. Orders for them need a rate typed in.</Alert>}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <Card className="p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <SearchInput placeholder="Search item or brand" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            <option value="tea">Tea</option>
            <option value="oil">Oil</option>
            <option value="other">Other</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> Active items only
          </label>
        </div>
      </Card>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Item</TH>
              <TH>Unit</TH>
              <TH className="text-right">Rate (before GST)</TH>
              {firm.gst_registered && <TH className="text-right">With GST</TH>}
              <TH>Since</TH>
            </tr>
          </THead>
          <tbody>
            {shown.length === 0 && <EmptyRow colSpan={5}>No items match.</EmptyRow>}
            {shown.map((r) => {
              const v = edits[r.item_id] ?? (r.rate ? String(Number(r.rate)) : "");
              const dirty = edits[r.item_id] !== undefined && edits[r.item_id]!.trim() !== "" && Number(edits[r.item_id]) !== Number(r.rate ?? NaN);
              const effective = Number(v) || 0;
              return (
                <TR key={r.item_id} className={dirty ? "bg-amber-50/60" : undefined}>
                  <TD>
                    <div className="font-medium text-slate-900">{r.name}</div>
                    <div className="text-xs text-slate-500">
                      {r.brand ?? r.category}
                      {r.kg_per_unit > 0 && r.unit !== "kg" && <> · {r.kg_per_unit} kg per {r.unit}</>}
                    </div>
                  </TD>
                  <TD className="text-sm">per {r.unit}</TD>
                  <TD className="text-right">
                    {canEdit ? (
                      <Input
                        className="num ml-auto w-32 text-right"
                        inputMode="decimal"
                        value={v}
                        placeholder="—"
                        onChange={(e) => setEdits({ ...edits, [r.item_id]: e.target.value.replace(/[^\d.]/g, "") })}
                      />
                    ) : (
                      <span className="num">{r.rate ? formatINR(Number(r.rate)) : "—"}</span>
                    )}
                  </TD>
                  {firm.gst_registered && (
                    <TD className="num text-right text-slate-500">
                      {effective > 0 ? formatINR(roundHalfUp(effective * (1 + r.gst_rate / 100), 2)) : "—"}
                      <div className="text-xs">{r.gst_rate}% GST</div>
                    </TD>
                  )}
                  <TD className="text-sm text-slate-500">
                    {r.effective_from ? formatDate(r.effective_from) : "—"}
                    {r.source === "tally" && <Badge className="ml-2">from Tally</Badge>}
                  </TD>
                </TR>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
