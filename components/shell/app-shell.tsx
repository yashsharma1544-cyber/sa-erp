"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Building,
  FileInput,
  IndianRupee,
  CalendarDays,
  KeyRound,
  Map,
  Package,
  Store,
  Truck,
  CheckCircle2,
  ChevronDown,
  Home,
  LogOut,
  Menu,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type NavIcon =
  | "home"
  | "approvals"
  | "users"
  | "limits"
  | "calendar"
  | "settings"
  | "audit"
  | "customers"
  | "beats"
  | "items"
  | "suppliers"
  | "vehicles"
  | "import"
  | "receivables";
export type NavItem = { href: string; label: string; icon: NavIcon; badge?: number };
export type NavSection = { title?: string; items: NavItem[] };

const icons: Record<NavIcon, LucideIcon> = {
  home: Home,
  approvals: CheckCircle2,
  users: Users,
  limits: ShieldCheck,
  calendar: CalendarDays,
  settings: Settings,
  audit: ScrollText,
  customers: Store,
  beats: Map,
  items: Package,
  suppliers: Building,
  vehicles: Truck,
  import: FileInput,
  receivables: IndianRupee,
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">SA</span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-slate-900">SA ERP</span>
        <span className="block text-xs text-slate-500">Sushil · Anjali</span>
      </span>
    </Link>
  );
}

function Nav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav className="space-y-6">
      {sections.map((section, i) => (
        <div key={i}>
          {section.title && (
            <div className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{section.title}</div>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = icons[item.icon];
              const active = item.href === "/" ? path === "/" : path.startsWith(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    className={cn(
                      "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                      active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    <Icon className={cn("h-4 w-4", active ? "text-brand-700" : "text-slate-400 group-hover:text-slate-600")} />
                    <span className="flex-1">{item.label}</span>
                    {!!item.badge && (
                      <span className="num rounded-full bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">{item.badge}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function AppShell({
  sections,
  userName,
  userRoles,
  children,
}: {
  sections: NavSection[];
  userName: string;
  userRoles: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const path = usePathname();

  useEffect(() => {
    setOpen(false);
    setMenu(false);
  }, [path]);

  return (
    <div className="min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex print:!hidden">
        <div className="flex h-16 items-center border-b border-slate-100 px-5">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <Nav sections={sections} />
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-400">Jalna · FY 26-27</div>
      </aside>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl">
            <div className="flex h-16 items-center justify-between border-b border-slate-100 px-5">
              <Brand />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-5">
              <Nav sections={sections} onNavigate={() => setOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      <div className="lg:pl-64 print:!pl-0">
        {/* Top bar */}
        <header className="sticky top-0 z-20 flex h-16 print:!hidden items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="flex-1" />
          <div className="relative">
            <button
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-2.5 rounded-lg py-1.5 pl-1.5 pr-2 hover:bg-slate-100"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
                {initials(userName)}
              </span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium text-slate-900">{userName}</span>
                <span className="block text-xs capitalize text-slate-500">{userRoles}</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
            {menu && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <div className="px-3 py-2 sm:hidden">
                  <div className="text-sm font-medium">{userName}</div>
                  <div className="text-xs capitalize text-slate-500">{userRoles}</div>
                </div>
                <Link href="/account" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                  <KeyRound className="h-4 w-4" /> Change password
                </Link>
                <form action="/auth/signout" method="post">
                  <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                    <LogOut className="h-4 w-4" /> Sign out
                  </button>
                </form>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
