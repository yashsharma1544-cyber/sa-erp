import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayIST } from "@/lib/format";
import { jcDay } from "@/lib/jc";

export default async function HomePage() {
  const me = await requireUser();
  const supabase = await createClient();
  const today = todayIST();

  const { data: jc } = await supabase
    .from("v_journey_cycles")
    .select("jc_label, start_date, end_date, days")
    .lte("start_date", today)
    .gte("end_date", today)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Good day, {me.fullName}</h1>
        <p className="text-slate-500">{formatDate(today)}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="text-sm text-slate-500">Journey cycle</div>
          {jc ? (
            <>
              <div className="text-2xl font-semibold">{jc.jc_label}</div>
              <div className="text-sm text-slate-600">
                Day {jcDay(today)} of {jc.days} · {formatDate(jc.start_date)} – {formatDate(jc.end_date)}
              </div>
            </>
          ) : (
            <div className="text-sm text-red-600">No JC for today. Generate the calendar for this FY.</div>
          )}
        </div>
      </section>

      <p className="text-sm text-slate-500">
        The owner cockpit (collected today, to collect, target %, receivables, payables) fills in as Phase 1 lands.
      </p>
    </div>
  );
}
