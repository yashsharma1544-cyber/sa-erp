"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, type AppRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fieldAuthEmail, fieldAuthPassword } from "@/lib/field-auth";

type Result = { error?: string; warning?: string };

const ROLES = ["owner", "sales_admin", "accounts", "stores", "dispatch", "driver", "salesman", "collector"] as const;

const NewUser = z
  .object({
    fullName: z.string().trim().min(2).max(80),
    loginKind: z.enum(["email", "pin"]),
    email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
    phone: z.string().trim().max(15).optional(),
    whatsapp: z.string().trim().max(15).optional(),
    locale: z.enum(["en", "mr"]),
    roles: z.array(z.enum(ROLES)).min(1, "Pick at least one role"),
    firmIds: z.array(z.string().uuid()),
    pin: z.string().optional(),
  })
  .refine((v) => v.loginKind !== "email" || !!v.email, { message: "Email is required for office logins" })
  .refine((v) => v.loginKind !== "pin" || /^\d{4}$/.test(v.pin ?? ""), { message: "PIN must be 4 digits" });

export type NewUserInput = z.input<typeof NewUser>;

/** Public address of the app. NEXT_PUBLIC_APP_URL if set, else Vercel's own production URL. */
function appUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return "http://localhost:3000";
}

function done(): Result {
  revalidatePath("/users");
  return {};
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const admin = createAdminClient();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) return null;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Create (or re-link) the Supabase Auth login for an app user. */
async function provisionLogin(userId: string): Promise<Result> {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: u, error } = await supabase
    .from("app_users")
    .select("id, email, login_kind, auth_user_id")
    .eq("id", userId)
    .single();
  if (error || !u) return { error: error?.message ?? "User not found" };
  if (u.auth_user_id) return {};

  if (u.login_kind === "pin") {
    const email = fieldAuthEmail(u.id);
    const created = await admin.auth.admin.createUser({
      email,
      password: fieldAuthPassword(u.id),
      email_confirm: true,
      app_metadata: { field_user: true },
    });
    const authId = created.data.user?.id ?? (await findAuthUserIdByEmail(email));
    if (!authId) return { error: created.error?.message ?? "Could not create field login" };
    const { error: linkError } = await admin.rpc("link_pin_auth_user", { p_user_id: u.id, p_auth_user_id: authId });
    return linkError ? { error: linkError.message } : {};
  }

  const redirectTo = `${appUrl()}/auth/callback?next=/`;
  const invited = await admin.auth.admin.inviteUserByEmail(u.email!, { redirectTo });
  // The on-insert trigger links a brand-new auth user by email. If the email
  // already had an auth account, link it here.
  if (invited.error) {
    const authId = await findAuthUserIdByEmail(u.email!);
    if (!authId) return { error: invited.error.message };
    const { error: linkError } = await admin
      .from("app_users")
      .update({ auth_user_id: authId })
      .eq("id", u.id)
      .is("auth_user_id", null);
    if (linkError) return { error: linkError.message };
    return { warning: "This email already had a login, so no invite was sent. They can sign in with it now." };
  }
  return {};
}

export async function createUser(input: NewUserInput): Promise<Result> {
  await requirePermission("users.manage");
  const parsed = NewUser.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;
  const supabase = await createClient();

  const { data: created, error } = await supabase
    .from("app_users")
    .insert({
      full_name: v.fullName,
      login_kind: v.loginKind,
      email: v.loginKind === "email" ? v.email : null,
      phone: v.phone || null,
      whatsapp: v.whatsapp || null,
      locale: v.locale,
    })
    .select("id")
    .single();
  if (error || !created) {
    return { error: error?.code === "23505" ? "A user with this email or name already exists" : error?.message };
  }

  const roleRows = v.roles.map((role) => ({ user_id: created.id, role }));
  const { error: roleError } = await supabase.from("user_roles").insert(roleRows);
  if (roleError) return { error: `User saved, but roles failed: ${roleError.message}` };

  if (v.firmIds.length) {
    const { error: firmError } = await supabase
      .from("user_firms")
      .insert(v.firmIds.map((firm_id) => ({ user_id: created.id, firm_id })));
    if (firmError) return { error: `User saved, but firms failed: ${firmError.message}` };
  }

  const login = await provisionLogin(created.id);
  if (login.error) return { error: `User saved, but login setup failed: ${login.error}. Use "Set up login" to retry.` };

  if (v.loginKind === "pin") {
    const { error: pinError } = await supabase.rpc("set_user_pin", { p_user_id: created.id, p_pin: v.pin });
    if (pinError) return { error: `User saved, but PIN failed: ${pinError.message}` };
  }

  revalidatePath("/users");
  return { warning: login.warning };
}

export async function retryLogin(userId: string): Promise<Result> {
  await requirePermission("users.manage");
  const res = await provisionLogin(userId);
  revalidatePath("/users");
  return res;
}

/** Make the user's rows in a link table match `wanted`, soft-deleting the rest. */
async function syncLinks(
  table: "user_roles" | "user_firms",
  column: "role" | "firm_id",
  userId: string,
  wanted: string[],
): Promise<Result> {
  const supabase = await createClient();
  const { data: current, error } = await supabase
    .from(table)
    .select(`id, ${column}`)
    .eq("user_id", userId)
    .is("deleted_at", null);
  if (error) return { error: error.message };

  const rows = (current ?? []) as unknown as Array<{ id: string } & Record<string, string>>;
  const have = new Set(rows.map((r) => r[column]));
  const toRemove = rows.filter((r) => !wanted.includes(r[column]!)).map((r) => r.id);
  const toAdd = wanted.filter((w) => !have.has(w));

  if (toRemove.length) {
    const { error: e } = await supabase.from(table).update({ deleted_at: new Date().toISOString() }).in("id", toRemove);
    if (e) return { error: e.message };
  }
  if (toAdd.length) {
    const { error: e } = await supabase.from(table).insert(toAdd.map((value) => ({ user_id: userId, [column]: value })));
    if (e) return { error: e.message };
  }
  return {};
}

export async function updateAccess(userId: string, roles: AppRole[], firmIds: string[]): Promise<Result> {
  const me = await requirePermission("users.manage");
  const parsedRoles = z.array(z.enum(ROLES)).min(1, "Keep at least one role").safeParse(roles);
  if (!parsedRoles.success) return { error: parsedRoles.error.issues[0]?.message };
  if (!z.array(z.string().uuid()).safeParse(firmIds).success) return { error: "Invalid firms" };
  if (userId === me.appUserId && me.roles.includes("owner") && !roles.includes("owner")) {
    return { error: "You cannot remove your own owner role" };
  }
  const r1 = await syncLinks("user_roles", "role", userId, parsedRoles.data);
  if (r1.error) return r1;
  const r2 = await syncLinks("user_firms", "firm_id", userId, firmIds);
  if (r2.error) return r2;
  return done();
}

export async function setActive(userId: string, active: boolean): Promise<Result> {
  const me = await requirePermission("users.manage");
  if (userId === me.appUserId && !active) return { error: "You cannot deactivate yourself" };
  const supabase = await createClient();
  const { error } = await supabase.from("app_users").update({ active }).eq("id", userId);
  return error ? { error: error.message } : done();
}

export async function setPin(userId: string, pin: string): Promise<Result> {
  await requirePermission("users.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_user_pin", { p_user_id: userId, p_pin: pin });
  return error ? { error: error.message } : done();
}
