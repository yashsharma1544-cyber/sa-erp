import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { roleLabels } from "@/lib/i18n";
import { AppShell, type NavSection } from "@/components/shell/app-shell";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  if (me.loginKind === "pin") redirect("/f");
  const isOwner = me.roles.includes("owner");

  const supabase = await createClient();
  const { count: pendingApprovals } = await supabase
    .from("approval_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const sections: NavSection[] = [
    {
      items: [
        { href: "/", label: "Home", icon: "home" },
        { href: "/approvals", label: "Approvals", icon: "approvals", badge: pendingApprovals ?? 0 },
      ],
    },
    {
      title: "Collections",
      items: can(me, "reports.view_all") ? [{ href: "/receivables", label: "Receivables", icon: "receivables" as const }] : [],
    },
    {
      title: "Masters",
      items: [
        { href: "/customers", label: "Customers", icon: "customers" },
        { href: "/beats", label: "Beats & territories", icon: "beats" },
        { href: "/items", label: "Items", icon: "items" },
        ...(me.roles.some((r) => r !== "salesman" && r !== "collector" && r !== "driver")
          ? [
              { href: "/suppliers", label: "Suppliers", icon: "suppliers" as const },
              { href: "/vehicles", label: "Vehicles", icon: "vehicles" as const },
            ]
          : []),
      ],
    },
    {
      title: "Admin",
      items: [
        ...(can(me, "users.manage") ? [{ href: "/users", label: "Users", icon: "users" as const }] : []),
        ...(isOwner ? [{ href: "/approval-limits", label: "Approval limits", icon: "limits" as const }] : []),
        ...(isOwner ? [{ href: "/audit", label: "Audit log", icon: "audit" as const }] : []),
        ...(can(me, "masters.manage") ? [{ href: "/import", label: "Import from Tally", icon: "import" as const }] : []),
      ],
    },
    {
      title: "Setup",
      items: [
        { href: "/calendar", label: "JC calendar", icon: "calendar" },
        { href: "/settings", label: "Firms & settings", icon: "settings" },
      ],
    },
  ].filter((s) => s.items.length > 0) as NavSection[];

  return (
    <AppShell
      sections={sections}
      userName={me.fullName}
      userRoles={me.roles.map((r) => roleLabels[r]?.en ?? r).join(", ") || "No role"}
    >
      {children}
    </AppShell>
  );
}
