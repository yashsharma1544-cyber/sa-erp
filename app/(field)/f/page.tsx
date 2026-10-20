import { cookies } from "next/headers";
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
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold">{t(locale, "hello", { name: me.fullName })}</h1>
        <p className="text-slate-500">
          {formatDate(today)} · JC{jc.jcNumber} · Day {jcDay(today)}
        </p>
      </header>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-500">{t(locale, "roles")}</div>
        <div>{me.roles.map((r) => roleLabels[r]?.[locale] ?? r).join(", ")}</div>
      </div>
      <p className="text-slate-600">{t(locale, "comingSoon")}</p>
      <form action="/auth/signout" method="post">
        <button className="rounded-md border border-slate-300 px-4 py-2">{t(locale, "signOut")}</button>
      </form>
    </div>
  );
}
