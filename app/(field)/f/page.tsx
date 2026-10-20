import { cookies } from "next/headers";
import { CalendarDays, LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth";
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

      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-slate-600">{t(locale, "comingSoon")}</div>
    </div>
  );
}
