import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ApprovalsClient, type ApprovalRow } from "./approvals-client";

export default async function ApprovalsPage() {
  const me = await requireUser();
  const supabase = await createClient();

  const { data } = await supabase
    .from("approval_requests")
    .select(
      "id, kind, permission_key, subject_label, amount, is_bad_debt, reason, status, created_at, decided_at, decision_note, requested_by, details, subject_table, " +
        "firm:firms(code), requester:app_users!approval_requests_requested_by_fkey(full_name), decider:app_users!approval_requests_decided_by_fkey(full_name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);

  const rows = ((data ?? []) as unknown as Array<
    Omit<ApprovalRow, "firm_code" | "requester_name" | "decider_name"> & {
      firm: { code: string } | null;
      requester: { full_name: string } | null;
      decider: { full_name: string } | null;
    }
  >).map(({ firm, requester, decider, ...r }) => ({
    ...r,
    firm_code: firm?.code ?? "",
    requester_name:
      requester?.full_name ??
      (r.subject_table === "rupyz_orders" ? `Rupyz${r.details?.salesman ? ` (${r.details.salesman})` : ""}` : ""),
    decider_name: decider?.full_name ?? null,
  }));

  return (
    <ApprovalsClient
      rows={rows}
      myUserId={me.appUserId}
      isOwner={me.roles.includes("owner")}
      myPermissions={me.permissions}
    />
  );
}
