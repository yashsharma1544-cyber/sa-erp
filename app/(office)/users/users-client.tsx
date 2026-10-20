"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/format";
import { roleLabels } from "@/lib/i18n";
import type { AppRole } from "@/lib/auth";
import { createUser, retryLogin, setActive, setPin, updateAccess } from "./actions";

export type UserRow = {
  id: string;
  full_name: string;
  email: string | null;
  login_kind: "email" | "pin";
  phone: string | null;
  whatsapp: string | null;
  locale: "en" | "mr";
  active: boolean;
  auth_user_id: string | null;
  locked_until: string | null;
  roles: string[];
  firmIds: string[];
};

type Firm = { id: string; code: string; name: string };

const ALL_ROLES: AppRole[] = ["owner", "sales_admin", "accounts", "stores", "dispatch", "driver", "salesman", "collector"];
const FIELD_ROLES: AppRole[] = ["driver", "salesman", "collector"];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Checkboxes<T extends string>({
  options,
  selected,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (v: T[]) => void;
  label: string;
}) {
  return (
    <fieldset>
      <legend className="mb-1 text-sm text-slate-600">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-sm">
            <input type="checkbox" checked={selected.includes(o.value)} onChange={() => onChange(toggle(selected, o.value))} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function UsersClient({
  users,
  firms,
  canGrantOwner,
  myUserId,
}: {
  users: UserRow[];
  firms: Firm[];
  canGrantOwner: boolean;
  myUserId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const roleOptions = ALL_ROLES.filter((r) => r !== "owner" || canGrantOwner).map((r) => ({
    value: r,
    label: roleLabels[r]!.en,
  }));
  const firmOptions = firms.map((f) => ({ value: f.id, label: `${f.code} · ${f.name}` }));

  function run(fn: () => Promise<{ error?: string; warning?: string }>, ok: string, after?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.error) setFlash({ kind: "error", text: res.error });
      else {
        setFlash({ kind: "ok", text: res.warning ?? ok });
        after?.();
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users</h1>
        <button onClick={() => setAdding((a) => !a)} className="rounded-md bg-brand px-3 py-2 text-sm text-white">
          {adding ? "Close" : "+ Add user"}
        </button>
      </div>

      {flash && (
        <p className={flash.kind === "error" ? "rounded bg-red-50 p-2 text-sm text-red-700" : "rounded bg-green-50 p-2 text-sm text-green-800"}>
          {flash.text}
        </p>
      )}

      {adding && (
        <AddUserForm
          roleOptions={roleOptions}
          firmOptions={firmOptions}
          pending={pending}
          onSubmit={(input) => run(() => createUser(input), `${input.fullName} added`, () => setAdding(false))}
        />
      )}

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Login</th>
              <th className="px-3 py-2">Roles</th>
              <th className="px-3 py-2">Firms</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <UserRowView
                key={u.id}
                user={u}
                firms={firms}
                editing={editing === u.id}
                isMe={u.id === myUserId}
                pending={pending}
                roleOptions={roleOptions}
                firmOptions={firmOptions}
                onEdit={() => setEditing(editing === u.id ? null : u.id)}
                run={run}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AddUserForm({
  roleOptions,
  firmOptions,
  pending,
  onSubmit,
}: {
  roleOptions: { value: AppRole; label: string }[];
  firmOptions: { value: string; label: string }[];
  pending: boolean;
  onSubmit: (input: Parameters<typeof createUser>[0]) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [loginKind, setLoginKind] = useState<"email" | "pin">("pin");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [pin, setPinValue] = useState("");
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [firmIds, setFirmIds] = useState<string[]>([]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          fullName,
          loginKind,
          email,
          phone,
          whatsapp,
          pin,
          roles,
          firmIds,
          locale: loginKind === "pin" ? "mr" : "en",
        });
      }}
      className="grid gap-3 rounded-xl bg-white p-4 shadow-sm md:grid-cols-2"
    >
      <label className="text-sm">
        Full name
        <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      </label>
      <fieldset className="text-sm">
        <legend className="mb-1">Login type</legend>
        <label className="mr-4">
          <input type="radio" checked={loginKind === "pin"} onChange={() => setLoginKind("pin")} /> Field (name + PIN)
        </label>
        <label>
          <input type="radio" checked={loginKind === "email"} onChange={() => setLoginKind("email")} /> Office (email)
        </label>
      </fieldset>
      {loginKind === "email" ? (
        <label className="text-sm">
          Email (an invite is sent here)
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
        </label>
      ) : (
        <label className="text-sm">
          4-digit PIN
          <input
            required
            inputMode="numeric"
            pattern="\d{4}"
            maxLength={4}
            value={pin}
            onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
            className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5"
          />
        </label>
      )}
      <label className="text-sm">
        Phone
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      </label>
      <label className="text-sm">
        WhatsApp
        <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5" />
      </label>
      <div className="md:col-span-2">
        <Checkboxes
          label="Roles"
          options={loginKind === "pin" ? roleOptions.filter((o) => FIELD_ROLES.includes(o.value)) : roleOptions}
          selected={roles}
          onChange={setRoles}
        />
      </div>
      {loginKind === "email" && (
        <div className="md:col-span-2">
          <Checkboxes label="Firms this person can see" options={firmOptions} selected={firmIds} onChange={setFirmIds} />
        </div>
      )}
      <div className="md:col-span-2">
        <button disabled={pending} className="rounded-md bg-brand px-4 py-2 text-sm text-white disabled:opacity-50">
          {pending ? "Saving…" : "Save user"}
        </button>
        <p className="mt-2 text-xs text-slate-500">Field users get their beats when beats are set up (slice 0.3).</p>
      </div>
    </form>
  );
}

function UserRowView({
  user: u,
  firms,
  editing,
  isMe,
  pending,
  roleOptions,
  firmOptions,
  onEdit,
  run,
}: {
  user: UserRow;
  firms: Firm[];
  editing: boolean;
  isMe: boolean;
  pending: boolean;
  roleOptions: { value: AppRole; label: string }[];
  firmOptions: { value: string; label: string }[];
  onEdit: () => void;
  run: (fn: () => Promise<{ error?: string; warning?: string }>, ok: string, after?: () => void) => void;
}) {
  const [roles, setRoles] = useState<AppRole[]>(u.roles as AppRole[]);
  const [firmIds, setFirmIds] = useState<string[]>(u.firmIds);
  const [newPin, setNewPin] = useState("");
  const locked = u.locked_until && new Date(u.locked_until) > new Date();

  return (
    <>
      <tr className="border-t border-slate-100 align-top">
        <td className="px-3 py-2 font-medium">
          {u.full_name}
          {isMe && <span className="ml-1 text-xs text-slate-500">(you)</span>}
        </td>
        <td className="px-3 py-2">{u.login_kind === "pin" ? "PIN" : u.email}</td>
        <td className="px-3 py-2">{u.roles.map((r) => roleLabels[r]?.en ?? r).join(", ")}</td>
        <td className="px-3 py-2">
          {u.firmIds.map((id) => firms.find((f) => f.id === id)?.code).filter(Boolean).join(", ") || "—"}
        </td>
        <td className="px-3 py-2">
          {!u.active ? (
            <span className="text-slate-500">Inactive</span>
          ) : !u.auth_user_id ? (
            <span className="text-amber-700">{u.login_kind === "email" ? "Invite pending" : "Login not set up"}</span>
          ) : locked ? (
            <span className="text-red-700">Locked until {formatDateTime(u.locked_until!)}</span>
          ) : (
            <span className="text-green-700">Active</span>
          )}
        </td>
        <td className="px-3 py-2 text-right">
          <button onClick={onEdit} className="text-sm underline">
            {editing ? "Close" : "Edit"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr className="bg-slate-50">
          <td colSpan={6} className="space-y-3 px-3 py-3">
            <Checkboxes
              label="Roles"
              options={u.login_kind === "pin" ? roleOptions.filter((o) => FIELD_ROLES.includes(o.value)) : roleOptions}
              selected={roles}
              onChange={setRoles}
            />
            {u.login_kind === "email" && (
              <Checkboxes label="Firms" options={firmOptions} selected={firmIds} onChange={setFirmIds} />
            )}
            <div className="flex flex-wrap items-end gap-2">
              <button
                disabled={pending}
                onClick={() => run(() => updateAccess(u.id, roles, firmIds), "Access updated")}
                className="rounded-md bg-brand px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Save access
              </button>
              {u.login_kind === "pin" && (
                <>
                  <input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="New PIN"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="w-24 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                  <button
                    disabled={pending || newPin.length !== 4}
                    onClick={() => run(() => setPin(u.id, newPin), "PIN changed and lock cleared", () => setNewPin(""))}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Reset PIN
                  </button>
                </>
              )}
              {!u.auth_user_id && (
                <button
                  disabled={pending}
                  onClick={() => run(() => retryLogin(u.id), "Login set up")}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                >
                  {u.login_kind === "email" ? "Send invite again" : "Set up login"}
                </button>
              )}
              {!isMe && (
                <button
                  disabled={pending}
                  onClick={() => run(() => setActive(u.id, !u.active), u.active ? "Deactivated" : "Reactivated")}
                  className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700"
                >
                  {u.active ? "Deactivate" : "Reactivate"}
                </button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
