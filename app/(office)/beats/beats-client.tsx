"use client";

import { useState, useTransition } from "react";
import { MapPin, Pencil, Plus } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { WEEKDAYS, routeLabel } from "@/lib/weekdays";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { saveBeat, saveTerritory, type BeatInput } from "./actions";

export type Territory = { id: string; name: string; sort_order: number };
export type BeatRow = {
  id: string;
  name: string;
  route_kind: "city" | "outstation" | "counter";
  route_weekday: number | null;
  active: boolean;
  territory_id: string;
  territory_name: string;
  customer_count: number;
};

const kindTone = { city: "blue", outstation: "amber", counter: "neutral" } as const;

export function BeatsClient({ territories, beats, canEdit }: { territories: Territory[]; beats: BeatRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<BeatInput | null>(null);
  const [addingTerritory, setAddingTerritory] = useState(false);
  const [territoryName, setTerritoryName] = useState("");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ error?: string; ok?: string }>, after?: () => void) {
    start(async () => {
      const res = await fn();
      setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
      if (!res.error) after?.();
    });
  }

  const newBeat = (territoryId: string): BeatInput => ({
    name: "",
    territoryId,
    routeKind: "city",
    routeWeekday: null,
    active: true,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Beats & territories"
        description={`${beats.length} beats in ${territories.length} territories. Outstation beats go out on their fixed weekday; Jalna city beats go the same or next day.`}
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => setAddingTerritory(true)}>
                <Plus className="h-4 w-4" /> Territory
              </Button>
              <Button onClick={() => setEditing(newBeat(territories[0]?.id ?? ""))}>
                <Plus className="h-4 w-4" /> Beat
              </Button>
            </>
          )
        }
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="grid gap-4 xl:grid-cols-2">
        {territories.map((t) => {
          const rows = beats.filter((b) => b.territory_id === t.id);
          const customers = rows.reduce((a, b) => a + Number(b.customer_count), 0);
          return (
            <Card key={t.id}>
              <CardHeader
                title={
                  <span className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-brand-700" /> {t.name}
                  </span>
                }
                description={`${rows.length} beats · ${formatNumber(customers)} customers`}
                action={
                  canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(newBeat(t.id))}>
                      <Plus className="h-4 w-4" /> Add beat
                    </Button>
                  )
                }
              />
              <Table>
                <THead>
                  <tr>
                    <TH>Beat</TH>
                    <TH>Route</TH>
                    <TH className="text-right">Customers</TH>
                    <TH />
                  </tr>
                </THead>
                <tbody>
                  {rows.map((b) => (
                    <TR key={b.id} className={cn(!b.active && "opacity-50")}>
                      <TD className="font-medium text-slate-900">
                        {b.name}
                        {!b.active && <Badge className="ml-2">Inactive</Badge>}
                      </TD>
                      <TD>
                        <Badge tone={kindTone[b.route_kind]}>{routeLabel(b.route_kind, b.route_weekday)}</Badge>
                      </TD>
                      <TD className="num text-right">{formatNumber(b.customer_count)}</TD>
                      <TD className="text-right">
                        {canEdit && (
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${b.name}`}
                            onClick={() =>
                              setEditing({
                                id: b.id,
                                name: b.name,
                                territoryId: b.territory_id,
                                routeKind: b.route_kind,
                                routeWeekday: b.route_weekday,
                                active: b.active,
                              })
                            }
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-500">
                        No beats yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </Table>
            </Card>
          );
        })}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit beat" : "New beat"}>
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => saveBeat(editing), () => setEditing(null));
            }}
          >
            <Field label="Beat name">
              <Input required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Territory">
              <Select value={editing.territoryId} onChange={(e) => setEditing({ ...editing, territoryId: e.target.value })}>
                {territories.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Route">
                <Select
                  value={editing.routeKind}
                  onChange={(e) => {
                    const routeKind = e.target.value as BeatInput["routeKind"];
                    setEditing({ ...editing, routeKind, routeWeekday: routeKind === "outstation" ? (editing.routeWeekday ?? 1) : null });
                  }}
                >
                  <option value="city">City (same / next day)</option>
                  <option value="outstation">Outstation (fixed day)</option>
                  <option value="counter">Counter (walk-in)</option>
                </Select>
              </Field>
              {editing.routeKind === "outstation" && (
                <Field label="Route day">
                  <Select
                    value={editing.routeWeekday ?? 1}
                    onChange={(e) => setEditing({ ...editing, routeWeekday: Number(e.target.value) })}
                  >
                    {WEEKDAYS.map((d, i) => (
                      <option key={d} value={i}>
                        {d}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300 text-brand-700"
              />
              Active
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={pending}>{pending ? "Saving…" : "Save beat"}</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={addingTerritory} onClose={() => setAddingTerritory(false)} title="New territory">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveTerritory(territoryName), () => {
              setAddingTerritory(false);
              setTerritoryName("");
            });
          }}
        >
          <Field label="Territory name">
            <Input required value={territoryName} onChange={(e) => setTerritoryName(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setAddingTerritory(false)}>
              Cancel
            </Button>
            <Button disabled={pending}>Add territory</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
