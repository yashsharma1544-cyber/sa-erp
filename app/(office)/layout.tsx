import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { OfficeNav, type NavItem } from "@/components/office-nav";

export default async function OfficeLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  if (me.loginKind === "pin") redirect("/f");
  const isOwner = me.roles.includes("owner");

  const items: NavItem[] = [
    { href: "/", label: "Home" },
    { href: "/approvals", label: "Approvals" },
    ...(can(me, "users.manage") ? [{ href: "/users", label: "Users" }] : []),
    ...(isOwner ? [{ href: "/approval-limits", label: "Approval limits" }] : []),
    { href: "/calendar", label: "JC calendar" },
    { href: "/settings", label: "Firms & settings" },
    ...(isOwner ? [{ href: "/audit", label: "Audit log" }] : []),
  ];

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-slate-200 bg-white p-3 md:min-h-screen md:w-56 md:border-b-0 md:border-r">
        <div className="mb-3 px-3">
          <div className="font-semibold">SA ERP</div>
          <div className="text-xs text-slate-500">
            {me.fullName} · {me.roles.join(", ") || "no role"}
          </div>
        </div>
        <OfficeNav items={items} />
        <form action="/auth/signout" method="post" className="mt-3 px-3">
          <button className="text-sm text-slate-500 hover:text-slate-900">Sign out</button>
        </form>
      </aside>
      <main className="flex-1 p-4 md:p-6">{children}</main>
    </div>
  );
}
