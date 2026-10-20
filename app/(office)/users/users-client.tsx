"use client";

import { useState, useTransition } from "react";
import { KeyRound, Mail, Plus, Smartphone, X } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { roleLabels } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/lib/auth";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Field, Input } from "@/components/ui/field";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
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
type Run = (fn: () => Promise<{ error?: string; warning?: string }>, ok: string, after?: () => void) => void;

const ALL_ROLES: AppRole[] = ["owner", "sales_admin", "accounts", "stores", "dispatch", "driver", "salesman", "collector"];
const FIELD_ROLES: AppRole[] = ["driver", "salesman", "collector"];

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chips<T extends string>({
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
      <legend className="mb-1.5 text-sm font-medium text-slate-700">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              onClick={() => onChange(toggle(selected, o.value))}
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              {o.label}
            </button>
          );
        })}
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
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const roleOptions = ALL_ROLES.filter((r) => r !== "owner" || canGrantOwner).map((r) => ({ value: r, label: roleLabels[r]!.en }));
  const firmOptions = firms.map((f) => ({ value: f.id, label: f.name }));

  const run: Run = (fn, ok, after) => {
    start(async () => {
      const res = await fn();
      if (res.error) setFlash({ kind: "error", text: res.error });
      else {
        setFlash({ kind: "success", text: res.warning ?? ok });
        after?.();
      }
    });
  };

  const field = users.filter((u) => u.login_kind === "pin").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description={`${users.length} people · ${users.length - field} office · ${field} field`}
        actions={
          <Button onClick={() => setAdding((a) => !a)} variant={adding ? "secondary" : "primary"}>
            {adding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {adding ? "Close" : "Add user"}
          </Button>
        }
      />

      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      {adding && (
        <AddUserForm
          roleOptions={roleOptions}
          firmOptions={firmOptions}
          pending={pending}
          onSubmit={(input) => run(() => createUser(input), `${input.fullName} added`, () => setAdding(false))}
        />
      )}

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>Login</TH>
              <TH>Roles</TH>
              <TH>Firms</TH>
              <TH>Status</TH>
              <TH />
            </tr>
          </THead>
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
        </Table>
      </Card>
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
    <Card>
      <CardHeader title="New user" description="Field staff sign in with name + PIN on their phone. Office staff get an email invite." />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit({ fullName, loginKind, email, phone, whatsapp, pin, roles, firmIds, locale: loginKind === "pin" ? "mr" : "en" });
          }}
          className="space-y-5"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                { kind: "pin", icon: Smartphone, title: "Field staff", text: "Salesman, collector, driver. Name + 4-digit PIN." },
                { kind: "email", icon: Mail, title: "Office staff", text: "Accounts, stores, dispatch, sales admin. Email login." },
              ] as const
            ).map(({ kind, icon: Icon, title, text }) => (
              <button
                type="button"
                key={kind}
                onClick={() => {
                  setLoginKind(kind);
                  setRoles([]);
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-4 text-left transition-colors",
                  loginKind === kind ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 hover:bg-slate-50",
                )}
              >
                <Icon className={cn("mt-0.5 h-5 w-5", loginKind === kind ? "text-brand-700" : "text-slate-400")} />
                <span>
                  <span className="block text-sm font-semibold">{title}</span>
                  <span className="block text-sm text-slate-500">{text}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Full name">
              <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            {loginKind === "email" ? (
              <Field label="Email" hint="An invite is sent here.">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            ) : (
              <Field label="4-digit PIN" hint="Easy PINs like 1234 or 0000 are refused.">
                <Input
                  required
                  inputMode="numeric"
                  pattern="\d{4}"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
                  className="num tracking-[0.5em]"
                />
              </Field>
            )}
            <Field label="Phone">
              <Input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field label="WhatsApp">
              <Input inputMode="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
            </Field>
          </div>

          <Chips
            label="Roles"
            options={loginKind === "pin" ? roleOptions.filter((o) => FIELD_ROLES.includes(o.value)) : roleOptions.filter((o) => !FIELD_ROLES.includes(o.value))}
            selected={roles}
            onChange={setRoles}
          />
          {loginKind === "email" && (
            <Chips label="Firms this person can see" options={firmOptions} selected={firmIds} onChange={setFirmIds} />
          )}

          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">Field users get their beats once beats are set up.</p>
            <Button disabled={pending}>{pending ? "Saving…" : "Save user"}</Button>
          </div>
        </form>
      </CardBody>
    </Card>
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
  run: Run;
}) {
  const [roles, setRoles] = useState<AppRole[]>(u.roles as AppRole[]);
  const [firmIds, setFirmIds] = useState<string[]>(u.firmIds);
  const [newPin, setNewPin] = useState("");
  const locked = u.locked_until && new Date(u.locked_until) > new Date();

  const status = !u.active ? (
    <Badge>Inactive</Badge>
  ) : !u.auth_user_id ? (
    <Badge tone="amber">{u.login_kind === "email" ? "Invite pending" : "Login not set up"}</Badge>
  ) : locked ? (
    <Badge tone="red">Locked until {formatDateTime(u.locked_until!)}</Badge>
  ) : (
    <Badge tone="green">Active</Badge>
  );

  return (
    <>
      <TR className={cn(editing && "bg-slate-50", !u.active && "opacity-60")}>
        <TD>
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
              {u.full_name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <div className="font-medium text-slate-900">
                {u.full_name}
                {isMe && <span className="ml-1 text-xs font-normal text-slate-500">(you)</span>}
              </div>
              <div className="text-xs text-slate-500">{u.phone ?? u.whatsapp ?? ""}</div>
            </div>
          </div>
        </TD>
        <TD>
          {u.login_kind === "pin" ? (
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <Smartphone className="h-4 w-4 text-slate-400" /> PIN
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <Mail className="h-4 w-4 text-slate-400" /> {u.email}
            </span>
          )}
        </TD>
        <TD>
          <div className="flex flex-wrap gap-1">
            {u.roles.map((r) => (
              <Badge key={r} tone={r === "owner" ? "green" : "neutral"}>
                {roleLabels[r]?.en ?? r}
              </Badge>
            ))}
          </div>
        </TD>
        <TD className="text-slate-600">
          {u.firmIds.map((id) => firms.find((f) => f.id === id)?.code).filter(Boolean).join(", ") || "—"}
        </TD>
        <TD>{status}</TD>
        <TD className="text-right">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            {editing ? "Close" : "Edit"}
          </Button>
        </TD>
      </TR>
      {editing && (
        <tr className="border-b border-slate-100 bg-slate-50">
          <td colSpan={6} className="space-y-4 px-4 pb-5 pt-1">
            <Chips
              label="Roles"
              options={u.login_kind === "pin" ? roleOptions.filter((o) => FIELD_ROLES.includes(o.value)) : roleOptions}
              selected={roles}
              onChange={setRoles}
            />
            {u.login_kind === "email" && <Chips label="Firms" options={firmOptions} selected={firmIds} onChange={setFirmIds} />}
            <div className="flex flex-wrap items-end gap-2">
              <Button size="sm" disabled={pending} onClick={() => run(() => updateAccess(u.id, roles, firmIds), "Access updated")}>
                Save access
              </Button>
              {u.login_kind === "pin" && (
                <div className="flex items-center gap-2">
                  <Input
                    inputMode="numeric"
                    maxLength={4}
                    placeholder="New PIN"
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))}
                    className="num h-8 w-28"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending || newPin.length !== 4}
                    onClick={() => run(() => setPin(u.id, newPin), "PIN changed and lock cleared", () => setNewPin(""))}
                  >
                    <KeyRound className="h-4 w-4" /> Reset PIN
                  </Button>
                </div>
              )}
              {!u.auth_user_id && (
                <Button size="sm" variant="secondary" disabled={pending} onClick={() => run(() => retryLogin(u.id), "Login set up")}>
                  {u.login_kind === "email" ? "Send invite again" : "Set up login"}
                </Button>
              )}
              {!isMe && (
                <Button
                  size="sm"
                  variant="danger"
                  className="ml-auto"
                  disabled={pending}
                  onClick={() => run(() => setActive(u.id, !u.active), u.active ? "Deactivated" : "Reactivated")}
                >
                  {u.active ? "Deactivate" : "Reactivate"}
                </Button>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
