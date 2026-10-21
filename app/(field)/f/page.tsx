import { cookies } from "next/headers";
import Link from "next/link";
import { CalendarDays, ChevronRight, IndianRupee, LogOut } from "lucide-react";
import { can, requireUser } from "@/lib/auth";
import { roleLabels, t, toLocale } from "@/lib/i18n";
import { formatDate, todayIST } from "@/lib/format";
import { journeyCycleFor, jcDay } from "@/lib/jc";

export default async function FieldHome() {
  const me = await requireUser();
  const locale = toLocale((await cookies()).get("lang")?.value, me.locale);
  const today = todayIST();
  const jc = journeyCycleFor(today);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-white">SA</span>
          <div className="leading-tight">
            <div className="font-semibold">{t(locale, "hello", { name: me.fullName })}</div>
            <div className="text-xs text-slate-500">{me.roles.map((r) => roleLabels[r]?.[locale] ?? r).join(", ")}</div>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <button className="rounded-lg border border-slate-300 bg-white p-2 text-slate-600 shadow-sm" aria-label={t(locale, "signOut")}>
            <LogOut className="h-5 w-5" />
          </button>
        </form>
      </header>

      <div className="rounded-2xl bg-brand-800 p-5 text-white shadow-card">
        <div className="flex items-center gap-2 text-sm text-brand-100">
          <CalendarDays className="h-4 w-4" /> {formatDate(today)}
        </div>
        <div className="mt-2 text-3xl font-semibold">JC{jc.jcNumber}</div>
        <div className="text-brand-100">
          Day {jcDay(today)} / {jc.days}
        </div>
      </div>

      {can(me, "receipt.record") ? (
        <Link href="/f/collect" className="flex items-center gap-4 rounded-2xl bg-white p-5 shadow-card ring-1 ring-slate-100">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <IndianRupee className="h-6 w-6" />
          </span>
          <span className="flex-1">
            <span className="block text-lg font-semibold text-slate-900">{t(locale, "collect")}</span>
            <span className="block text-sm text-slate-500">{t(locale, "collectHint")}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </Link>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-slate-600">{t(locale, "comingSoon")}</div>
      )}
    </div>
  );
}
