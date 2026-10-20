import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, todayIST } from "@/lib/format";
import { fyStartYearFor } from "@/lib/jc";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
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
    <div>
      <PageHeader
        title="JC calendar"
        description="13 journey cycles per year: 28 days each from 1 April, with JC13 running to 31 March."
        actions={me.roles.includes("owner") && lastYear !== undefined && <GenerateFyButton startYear={lastYear + 1} />}
      />

      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
        {(years ?? []).map((y) => (
          <Link
            key={y.start_year}
            href={`/calendar?fy=${y.start_year}`}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm font-medium",
              y.start_year === selected ? "bg-brand-700 text-white" : "text-slate-600 hover:bg-slate-100",
            )}
          >
            FY {y.label}
          </Link>
        ))}
      </div>

      <Card>
        <Table>
          <THead>
            <tr>
              <TH>Cycle</TH>
              <TH>From</TH>
              <TH>To</TH>
              <TH className="text-right">Days</TH>
            </tr>
          </THead>
          <tbody>
            {(jcs ?? []).map((jc) => {
              const current = jc.start_date <= today && today <= jc.end_date;
              const past = jc.end_date < today;
              return (
                <TR key={jc.id} className={cn(current && "bg-brand-50/70")}>
                  <TD className={cn("font-medium", past ? "text-slate-400" : "text-slate-900")}>
                    {jc.jc_label}
                    {current && (
                      <Badge tone="green" className="ml-2">
                        Current
                      </Badge>
                    )}
                  </TD>
                  <TD className={cn(past && "text-slate-400")}>{formatDate(jc.start_date)}</TD>
                  <TD className={cn(past && "text-slate-400")}>{formatDate(jc.end_date)}</TD>
                  <TD className={cn("num text-right", past && "text-slate-400")}>{jc.days}</TD>
                </TR>
              );
            })}
            {(!jcs || jcs.length === 0) && <EmptyRow colSpan={4}>No journey cycles for this year yet.</EmptyRow>}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
