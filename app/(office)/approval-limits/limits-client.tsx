"use client";

import { useState, useTransition } from "react";
import { formatDate, formatINR, todayIST } from "@/lib/format";
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

export function LimitsClient({
  rows,
  users,
  permissions,
}: {
  rows: DelegationRow[];
  users: User[];
  permissions: Permission[];
}) {
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

  function status(r: DelegationRow) {
    if (!r.active) return { text: "Ended", cls: "text-slate-500" };
    if (r.valid_from && r.valid_from > today) return { text: "Starts later", cls: "text-amber-700" };
    if (r.valid_to && r.valid_to < today) return { text: "Expired", cls: "text-slate-500" };
    return { text: "In force", cls: "text-green-700" };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Approval limits &amp; delegation</h1>
        <p className="text-sm text-slate-600">
          Give someone an approval power (for example while you are away) or cap how much they can approve. A blank
          limit means no rupee cap. Only you can ever approve for a bad-debt customer.
        </p>
      </div>

      {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}

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
        className="grid gap-3 rounded-xl bg-white p-4 shadow-sm md:grid-cols-3"
      >
        <label className="text-sm">
          Person
          <select required value={userId} onChange={(e) => setUserId(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            <option value="">Choose…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Power
          <select value={permissionKey} onChange={(e) => setPermissionKey(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5">
            {permissions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.category}: {p.description}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Limit ₹ (blank = no cap)
          <input inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          From (optional)
          <input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          To (optional)
          <input type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <label className="text-sm">
          Note
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>
        <div className="md:col-span-3">
          <button disabled={pending} className="rounded-md bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">
            Add
          </button>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Power</th>
              <th className="px-3 py-2 text-right">Limit</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const s = status(r);
              return (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2">{name(r.delegate_user_id)}</td>
                  <td className="px-3 py-2">{describe(r.permission_key)}</td>
                  <td className="num px-3 py-2 text-right">{r.max_amount ? formatINR(r.max_amount) : "No cap"}</td>
                  <td className="px-3 py-2">
                    {r.valid_from ? formatDate(r.valid_from) : "Always"} – {r.valid_to ? formatDate(r.valid_to) : "open"}
                  </td>
                  <td className={"px-3 py-2 " + s.cls}>{s.text}</td>
                  <td className="px-3 py-2 text-right">
                    {r.active && (
                      <button
                        disabled={pending}
                        onClick={() => start(async () => {
                          const res = await endDelegation(r.id);
                          if (res.error) setError(res.error);
                        })}
                        className="text-sm text-red-700 underline"
                      >
                        End
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-slate-500">
                  No limits or delegations yet. The sales admin currently has no rupee cap.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
