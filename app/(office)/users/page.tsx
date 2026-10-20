import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { UsersClient, type UserRow } from "./users-client";

export default async function UsersPage() {
  const me = await requirePermission("users.manage");
  const supabase = await createClient();

  const [{ data: users }, { data: roles }, { data: userFirms }, { data: firms }] = await Promise.all([
    supabase
      .from("app_users")
      .select("id, full_name, email, login_kind, phone, whatsapp, locale, active, auth_user_id, locked_until")
      .is("deleted_at", null)
      .order("full_name"),
    supabase.from("user_roles").select("user_id, role").is("deleted_at", null),
    supabase.from("user_firms").select("user_id, firm_id").is("deleted_at", null),
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);

  const rows: UserRow[] = (users ?? []).map((u) => ({
    ...u,
    roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
    firmIds: (userFirms ?? []).filter((f) => f.user_id === u.id).map((f) => f.firm_id),
  }));

  return (
    <UsersClient
      users={rows}
      firms={firms ?? []}
      canGrantOwner={me.roles.includes("owner")}
      myUserId={me.appUserId}
    />
  );
}
