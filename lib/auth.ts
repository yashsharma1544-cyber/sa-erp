import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AppRole =
  | "owner"
  | "sales_admin"
  | "accounts"
  | "stores"
  | "dispatch"
  | "driver"
  | "salesman"
  | "collector";

export type CurrentUser = {
  authUserId: string;
  appUserId: string;
  fullName: string;
  email: string | null;
  locale: "en" | "mr";
  loginKind: "email" | "pin";
  roles: AppRole[];
  permissions: string[];
};

/** Signed-in user with their ERP profile and roles, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("app_users")
    .select("id, full_name, email, locale, login_kind, active")
    .eq("auth_user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!profile || !profile.active) return null;

  const [{ data: roles }, { data: permissions }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", profile.id).is("deleted_at", null),
    supabase.rpc("my_permissions"),
  ]);

  return {
    authUserId: user.id,
    appUserId: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    locale: profile.locale,
    loginKind: profile.login_kind,
    roles: (roles ?? []).map((r) => r.role as AppRole),
    permissions: (permissions as string[] | null) ?? [],
  };
});

export async function requireUser(): Promise<CurrentUser> {
  const me = await getCurrentUser();
  if (!me) redirect("/no-access");
  return me;
}

export async function requireRole(...allowed: AppRole[]): Promise<CurrentUser> {
  const me = await requireUser();
  if (!me.roles.includes("owner") && !me.roles.some((r) => allowed.includes(r))) {
    redirect("/no-access");
  }
  return me;
}

export function can(me: CurrentUser, permission: string): boolean {
  return me.roles.includes("owner") || me.permissions.includes(permission);
}

export async function requirePermission(permission: string): Promise<CurrentUser> {
  const me = await requireUser();
  if (!can(me, permission)) redirect("/no-access");
  return me;
}
