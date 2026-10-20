"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { formatDate, formatINR, todayIST } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input, Select } from "@/components/ui/field";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { addDelegation, endDelegation } from "./actions";

export type DelegationRow = {
  id: string;
  delegate_user_id: string;
  permission_key: string;
  max_amount: string | null;
  valid_from: string | null;
  valid_to: string | null;
  active: boolean;
  note: string | null;
  created_at: string;
};

type User = { id: string; full_name: string };
type Permission = { key: string; category: string; description: string };

export function LimitsClient({ rows, users, permissions }: { rows: DelegationRow[]; users: User[]; permissions: Permission[] }) {
  const [userId, setUserId] = useState("");
  const [permissionKey, setPermissionKey] = useState("order.approve");
  const [maxAmount, setMaxAmount] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const today = todayIST();

  const name = (id: string) => users.find((u) => u.id === id)?.full_name ?? "—";
  const describe = (key: string) => permissions.find((p) => p.key === key)?.description ?? key;
  const categories = Array.from(new Set(permissions.map((p) => p.category)));

  function status(r: DelegationRow) {
    if (!r.active) return <Badge>Ended</Badge>;
    if (r.valid_from && r.valid_from > today) return <Badge tone="amber">Starts later</Badge>;
    if (r.valid_to && r.valid_to < today) return <Badge>Expired</Badge>;
    return <Badge tone="green">In force</Badge>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval limits"
        description="Give someone an approval power (for example while you are away) or cap how much they can approve. A blank limit means no rupee cap."
      />
      {error && <Alert kind="error">{error}</Alert>}

      <Card>
        <CardHeader title="Add a limit or delegation" />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              start(async () => {
                const res = await addDelegation({ userId, permissionKey, maxAmount, validFrom, validTo, note });
                if (res.error) setError(res.error);
                else {
                  setMaxAmount("");
                  setValidFrom("");
                  setValidTo("");
                  setNote("");
                }
              });
            }}
            className="grid gap-4 md:grid-cols-3"
          >
            <Field label="Person">
              <Select required value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Power">
              <Select value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)}>
                {categories.map((c) => (
                  <optgroup key={c} label={c}>
                    {permissions
                      .filter((p) => p.category === c)
                      .map((p) => (
                        <option key={p.key} value={p.key}>
                          {p.description}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="Limit (₹)" hint="Leave blank for no cap.">
              <Input inputMode="decimal" placeholder="e.g. 50000" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
            </Field>
            <Field label="From" hint="Optional">
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </Field>
            <Field label="To" hint="Optional">
              <Input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </Field>
            <Field label="Note">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="md:col-span-3 flex justify-end">
              <Button disabled={pending}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Person</TH>
              <TH>Power</TH>
              <TH className="text-right">Limit</TH>
              <TH>Dates</TH>
              <TH>Status</TH>
              <TH />
            </tr>
          </THead>
          <tbody>
            {rows.map((r) => (
              <TR key={r.id}>
                <TD className="font-medium text-slate-900">{name(r.delegate_user_id)}</TD>
                <TD>{describe(r.permission_key)}</TD>
                <TD className="num text-right font-medium">{r.max_amount ? formatINR(r.max_amount) : "No cap"}</TD>
                <TD className="text-slate-600">
                  {r.valid_from ? formatDate(r.valid_from) : "Always"} – {r.valid_to ? formatDate(r.valid_to) : "open"}
                </TD>
                <TD>{status(r)}</TD>
                <TD className="text-right">
                  {r.active && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-700"
                      disabled={pending}
                      onClick={() =>
                        start(async () => {
                          const res = await endDelegation(r.id);
                          if (res.error) setError(res.error);
                        })
                      }
                    >
                      End
                    </Button>
                  )}
                </TD>
              </TR>
            ))}
            {rows.length === 0 && (
              <EmptyRow colSpan={6}>No limits or delegations yet. The sales admin currently has no rupee cap.</EmptyRow>
            )}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
