"use client";

import { useState, useTransition } from "react";
import { Pencil, Plus, Truck } from "lucide-react";
import { formatKg } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { saveVehicle, type VehicleInput } from "./actions";

export type VehicleRow = {
  id: string;
  reg_no: string;
  ownership: "own" | "borrowed_vikram" | "hired";
  description: string | null;
  capacity_kg: string | null;
  active: boolean;
};

const ownershipLabel = { own: "Own", borrowed_vikram: "Borrowed (Vikram)", hired: "Hired" };
const ownershipTone = { own: "green", borrowed_vikram: "amber", hired: "neutral" } as const;

export function VehiclesClient({ vehicles, canEdit }: { vehicles: VehicleRow[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<VehicleInput | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vehicles"
        description="Our own vehicles plus any lent by Vikram tea for a day's dispatch."
        actions={
          canEdit && (
            <Button onClick={() => setEditing({ regNo: "", ownership: "own", description: "", capacityKg: "", active: true })}>
              <Plus className="h-4 w-4" /> Vehicle
            </Button>
          )
        }
      />
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}
      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Vehicle</TH>
              <TH>Ownership</TH>
              <TH className="text-right">Capacity</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {vehicles.map((v) => (
              <TR key={v.id} className={cn(!v.active && "opacity-50")}>
                <TD>
                  <div className="flex items-center gap-3">
                    <Truck className="h-4 w-4 text-slate-400" />
                    <div>
                      <div className="font-mono font-medium text-slate-900">{v.reg_no}</div>
                      <div className="text-xs text-slate-500">{v.description}</div>
                    </div>
                  </div>
                </TD>
                <TD>
                  <Badge tone={ownershipTone[v.ownership]}>{ownershipLabel[v.ownership]}</Badge>
                </TD>
                <TD className="num text-right">{v.capacity_kg ? formatKg(v.capacity_kg) : "—"}</TD>
                <TD className="text-right">
                  {canEdit && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({
                          id: v.id,
                          regNo: v.reg_no,
                          ownership: v.ownership,
                          description: v.description ?? "",
                          capacityKg: v.capacity_kg ? String(Number(v.capacity_kg)) : "",
                          active: v.active,
                        })
                      }
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
            {vehicles.length === 0 && <EmptyRow colSpan={4}>No vehicles yet. Add your 2 own vehicles.</EmptyRow>}
          </tbody>
        </Table>
      </Card>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? "Edit vehicle" : "New vehicle"}>
        {editing && (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await saveVehicle(editing);
                setFlash(res.error ? { kind: "error", text: res.error } : { kind: "success", text: res.ok ?? "Saved" });
                if (!res.error) setEditing(null);
              });
            }}
          >
            <Field label="Registration number">
              <Input required value={editing.regNo} onChange={(e) => setEditing({ ...editing, regNo: e.target.value.toUpperCase() })} placeholder="MH21 AB 1234" />
            </Field>
            <Field label="Ownership">
              <Select value={editing.ownership} onChange={(e) => setEditing({ ...editing, ownership: e.target.value as VehicleInput["ownership"] })}>
                <option value="own">Own</option>
                <option value="borrowed_vikram">Borrowed from Vikram</option>
                <option value="hired">Hired</option>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Description">
                <Input value={editing.description ?? ""} onChange={(e) => setEditing({ ...editing, description: e.target.value })} placeholder="Tata Ace" />
              </Field>
              <Field label="Capacity (kg)">
                <Input inputMode="decimal" value={editing.capacityKg} onChange={(e) => setEditing({ ...editing, capacityKg: e.target.value })} />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={editing.active} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} className="h-4 w-4" />
              Active
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button disabled={pending}>Save vehicle</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
