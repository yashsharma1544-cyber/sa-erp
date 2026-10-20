import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { LimitsClient, type DelegationRow } from "./limits-client";

export default async function ApprovalLimitsPage() {
  await requireRole("owner");
  const supabase = await createClient();

  const [{ data: delegations }, { data: users }, { data: permissions }] = await Promise.all([
    supabase
      .from("approval_delegations")
      .select("id, delegate_user_id, permission_key, max_amount, valid_from, valid_to, active, note, created_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: false }),
    supabase.from("app_users").select("id, full_name, login_kind").is("deleted_at", null).eq("active", true).order("full_name"),
    supabase.from("permissions").select("key, category, description").is("deleted_at", null).order("category"),
  ]);

  return (
    <LimitsClient
      rows={(delegations ?? []) as DelegationRow[]}
      users={(users ?? []).filter((u) => u.login_kind === "email")}
      permissions={permissions ?? []}
    />
  );
}
