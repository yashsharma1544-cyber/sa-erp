import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayIST } from "@/lib/format";
import { fyStartYearFor } from "@/lib/jc";
import { GenerateFyButton } from "./generate-fy-button";

type Props = { searchParams: Promise<{ fy?: string }> };

export default async function CalendarPage({ searchParams }: Props) {
  const me = await requireUser();
  const supabase = await createClient();
  const today = todayIST();
  const { fy } = await searchParams;

  const { data: years } = await supabase
    .from("fiscal_years")
    .select("start_year, label")
    .is("deleted_at", null)
    .order("start_year");

  const selected = fy ? Number(fy) : fyStartYearFor(today);
  const { data: jcs } = await supabase
    .from("v_journey_cycles")
    .select("id, jc_number, jc_label, start_date, end_date, days")
    .eq("start_year", selected)
    .order("jc_number");

  const lastYear = years?.at(-1)?.start_year;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">JC calendar</h1>
        <div className="flex flex-wrap gap-2">
          {(years ?? []).map((y) => (
            <Link
              key={y.start_year}
              href={`/calendar?fy=${y.start_year}`}
              className={
                "rounded-md px-3 py-1 text-sm " +
                (y.start_year === selected ? "bg-brand text-white" : "border border-slate-300 bg-white")
              }
            >
              FY {y.label}
            </Link>
          ))}
          {me.roles.includes("owner") && lastYear !== undefined && <GenerateFyButton startYear={lastYear + 1} />}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">JC</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2 text-right">Days</th>
            </tr>
          </thead>
          <tbody>
            {(jcs ?? []).map((jc) => {
              const current = jc.start_date <= today && today <= jc.end_date;
              return (
                <tr key={jc.id} className={current ? "bg-green-50 font-medium" : "border-t border-slate-100"}>
                  <td className="px-3 py-2">
                    {jc.jc_label}
                    {current && <span className="ml-2 rounded bg-brand px-1.5 text-xs text-white">today</span>}
                  </td>
                  <td className="px-3 py-2">{formatDate(jc.start_date)}</td>
                  <td className="px-3 py-2">{formatDate(jc.end_date)}</td>
                  <td className="num px-3 py-2 text-right">{jc.days}</td>
                </tr>
              );
            })}
            {(!jcs || jcs.length === 0) && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  No journey cycles for this year yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
