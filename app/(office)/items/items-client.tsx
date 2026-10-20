"use client";

import { useMemo, useState, useTransition } from "react";
import { Pencil, Plus } from "lucide-react";
import { formatINR, formatKg, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { saveBrand, saveItem, setItemGroup, type BrandInput, type ItemInput } from "./actions";

export type ItemRow = {
  id: string;
  name: string;
  brand_id: string | null;
  sku_group_id: string | null;
  category: "tea" | "oil" | "other";
  unit: string;
  units_per_case: string | null;
  pack_size_g: string | null;
  kg_per_unit: string;
  hsn: string | null;
  gst_rate: string;
  mrp: string | null;
  shelf_life_days: number | null;
  active: boolean;
};
export type Brand = { id: string; name: string; category: "tea" | "oil" | "other"; active: boolean };
export type SkuGroup = { id: string; code: string; name: string; description: string | null };

const s = (v: string | number | null) => (v === null || v === undefined ? "" : String(v));

export function ItemsClient({
  items,
  brands,
  groups,
  canEdit,
}: {
  items: ItemRow[];
  brands: Brand[];
  groups: SkuGroup[];
  canEdit: boolean;
}) {
  const [tab, setTab] = useState<"items" | "brands" | "groups">("items");
  const [q, setQ] = useState("");
  const [category, setCategory] = useState<"all" | "tea" | "oil" | "other">("all");
  const [item, setItem] = useState<ItemInput | null>(null);
  const [brand, setBrand] = useState<BrandInput | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const brandName = (id: string | null) => brands.find((b) => b.id === id)?.name ?? "—";
  const groupCode = (id: string | null) => groups.find((g) => g.id === id)?.code ?? null;

  const shown = useMemo(
    () =>
      items.filter(
        (i) =>
          (category === "all" || i.category === category) &&
          (q === "" || `${i.name} ${brandName(i.brand_id)}`.toLowerCase().includes(q.toLowerCase())),
      ),
    // brandName depends only on brands
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, q, category, brands],
  );

  function run(fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) {
    start(async () => {
      const res = await fn();
      setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
      if (!res.error) after?.();
    });
  }

  const blankItem: ItemInput = {
    name: "",
    brandId: null,
    skuGroupId: null,
    category: "tea",
    unit: "pkt",
    unitsPerCase: "",
    packSizeG: "",
    kgPerUnit: "",
    hsn: "0902",
    gstRate: "5",
    mrp: "",
    shelfLifeDays: "",
    active: true,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Items"
        description="Tea is tracked in units and kg. SKU group membership drives schemes and targets and can be changed here."
        actions={
          canEdit &&
          (tab === "brands" ? (
            <Button onClick={() => setBrand({ name: "", category: "tea", active: true })}>
              <Plus className="h-4 w-4" /> Brand
            </Button>
          ) : (
            <Button onClick={() => setItem(blankItem)}>
              <Plus className="h-4 w-4" /> Item
            </Button>
          ))
        }
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {(
          [
            ["items", `Items (${items.length})`],
            ["brands", `Brands (${brands.length})`],
            ["groups", "SKU groups"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium",
              tab === key ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "items" && (
        <Card>
          <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
            <div className="min-w-[220px] flex-1">
              <SearchInput placeholder="Search item or brand" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="w-40">
              <option value="all">All categories</option>
              <option value="tea">Tea</option>
              <option value="oil">Oil</option>
              <option value="other">Other</option>
            </Select>
          </div>
          <Table>
            <THead>
              <tr>
                <TH>Item</TH>
                <TH>Brand</TH>
                <TH>Group</TH>
                <TH>Unit</TH>
                <TH className="text-right">Kg / unit</TH>
                <TH className="text-right">GST</TH>
                <TH className="text-right">MRP</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {shown.map((i) => (
                <TR key={i.id} className={cn(!i.active && "opacity-50")}>
                  <TD className="font-medium text-slate-900">
                    {i.name}
                    {!i.active && <Badge className="ml-2">Inactive</Badge>}
                  </TD>
                  <TD>{brandName(i.brand_id)}</TD>
                  <TD>
                    {canEdit ? (
                      <Select
                        value={i.sku_group_id ?? ""}
                        onChange={(e) => run(() => setItemGroup(i.id, e.target.value || null))}
                        className="h-8 w-28 text-xs"
                        aria-label="SKU group"
                      >
                        <option value="">None</option>
                        {groups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </Select>
                    ) : groupCode(i.sku_group_id) ? (
                      <Badge tone="green">{groupCode(i.sku_group_id)}</Badge>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD>
                    {i.unit}
                    {i.units_per_case && <span className="text-xs text-slate-500"> · {formatNumber(i.units_per_case, 0)}/case</span>}
                  </TD>
                  <TD className="num text-right">{Number(i.kg_per_unit) > 0 ? formatKg(i.kg_per_unit) : "—"}</TD>
                  <TD className="num text-right">{Number(i.gst_rate)}%</TD>
                  <TD className="num text-right">{i.mrp ? formatINR(i.mrp) : "—"}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Edit ${i.name}`}
                        onClick={() =>
                          setItem({
                            id: i.id,
                            name: i.name,
                            brandId: i.brand_id,
                            skuGroupId: i.sku_group_id,
                            category: i.category,
                            unit: i.unit,
                            unitsPerCase: s(i.units_per_case),
                            packSizeG: s(i.pack_size_g),
                            kgPerUnit: s(i.kg_per_unit),
                            hsn: s(i.hsn),
                            gstRate: s(i.gst_rate),
                            mrp: s(i.mrp),
                            shelfLifeDays: s(i.shelf_life_days),
                            active: i.active,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
              {shown.length === 0 && (
                <EmptyRow colSpan={8}>
                  {items.length === 0 ? "No items yet. They are imported from Tally in the next step, or add one now." : "No items match."}
                </EmptyRow>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "brands" && (
        <Card>
          <Table>
            <THead>
              <tr>
                <TH>Brand</TH>
                <TH>Category</TH>
                <TH className="text-right">Items</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {brands.map((b) => (
                <TR key={b.id} className={cn(!b.active && "opacity-50")}>
                  <TD className="font-medium text-slate-900">{b.name}</TD>
                  <TD className="capitalize">{b.category}</TD>
                  <TD className="num text-right">{items.filter((i) => i.brand_id === b.id).length}</TD>
                  <TD className="text-right">
                    {canEdit && (
                      <Button size="sm" variant="ghost" onClick={() => setBrand({ id: b.id, name: b.name, category: b.category, active: b.active })}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "groups" && (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const members = items.filter((i) => i.sku_group_id === g.id);
            return (
              <Card key={g.id}>
                <CardHeader title={`${g.name} (${g.code})`} description={g.description ?? undefined} />
                <ul className="divide-y divide-slate-100 text-sm">
                  {members.map((m) => (
                    <li key={m.id} className="px-5 py-2.5">
                      {m.name}
                    </li>
                  ))}
                  {members.length === 0 && (
                    <li className="px-5 py-6 text-center text-slate-500">
                      No items yet. Set the group on the Items tab after items are imported.
                    </li>
                  )}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      <Modal open={!!item} onClose={() => setItem(null)} title={item?.id ? "Edit item" : "New item"} wide>
        {item && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveItem(item), () => setItem(null));
            }}
          >
            <Field label="Item name">
              <Input required value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Brand">
                <Select value={item.brandId ?? ""} onChange={(e) => setItem({ ...item, brandId: e.target.value || null })}>
                  <option value="">—</option>
                  {brands.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="SKU group">
                <Select value={item.skuGroupId ?? ""} onChange={(e) => setItem({ ...item, skuGroupId: e.target.value || null })}>
                  <option value="">None</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Category">
                <Select value={item.category} onChange={(e) => setItem({ ...item, category: e.target.value as ItemInput["category"] })}>
                  <option value="tea">Tea</option>
                  <option value="oil">Oil</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field label="Unit" hint="pkt, jar, tin, box, ltr…">
                <Input required value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} />
              </Field>
              <Field label="Units per case">
                <Input inputMode="decimal" value={item.unitsPerCase} onChange={(e) => setItem({ ...item, unitsPerCase: e.target.value })} />
              </Field>
              <Field label="Pack size (g)">
                <Input inputMode="decimal" value={item.packSizeG} onChange={(e) => setItem({ ...item, packSizeG: e.target.value })} />
              </Field>
              <Field label="Kg per unit" hint="e.g. 0.250 for a 250 g pack">
                <Input required inputMode="decimal" value={item.kgPerUnit} onChange={(e) => setItem({ ...item, kgPerUnit: e.target.value })} />
              </Field>
              <Field label="GST rate % (Sushil)">
                <Input required inputMode="decimal" value={item.gstRate} onChange={(e) => setItem({ ...item, gstRate: e.target.value })} />
              </Field>
              <Field label="HSN">
                <Input value={item.hsn} onChange={(e) => setItem({ ...item, hsn: e.target.value })} />
              </Field>
              <Field label="MRP (₹)">
                <Input inputMode="decimal" value={item.mrp} onChange={(e) => setItem({ ...item, mrp: e.target.value })} />
              </Field>
              <Field label="Shelf life (days)" hint="Used for return checks">
                <Input inputMode="numeric" value={item.shelfLifeDays} onChange={(e) => setItem({ ...item, shelfLifeDays: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={item.active} onChange={(e) => setItem({ ...item, active: e.target.checked })} className="h-4 w-4" />
              Active
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => setItem(null)}>
                Cancel
              </Button>
              <Button disabled={pending}>{pending ? "Saving…" : "Save item"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!brand} onClose={() => setBrand(null)} title={brand?.id ? "Edit brand" : "New brand"}>
        {brand && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveBrand(brand), () => setBrand(null));
            }}
          >
            <Field label="Brand name">
              <Input required value={brand.name} onChange={(e) => setBrand({ ...brand, name: e.target.value })} />
            </Field>
            <Field label="Category">
              <Select value={brand.category} onChange={(e) => setBrand({ ...brand, category: e.target.value as BrandInput["category"] })}>
                <option value="tea">Tea</option>
                <option value="oil">Oil</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={brand.active} onChange={(e) => setBrand({ ...brand, active: e.target.checked })} className="h-4 w-4" />
              Active
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setBrand(null)}>
                Cancel
              </Button>
              <Button disabled={pending}>Save brand</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
