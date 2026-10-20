import Link from "next/link";
import { ArrowRight, CalendarDays, CheckCircle2, IndianRupee, Target, Users, Wallet } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatNumber, todayIST } from "@/lib/format";
import { jcDay } from "@/lib/jc";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default async function HomePage() {
  const me = await requireUser();
  const supabase = await createClient();
  const today = todayIST();

  const [{ data: jc }, { count: pending }, { count: activeUsers }, { data: firms }] = await Promise.all([
    supabase
      .from("v_journey_cycles")
      .select("jc_label, jc_number, start_date, end_date, days")
      .lte("start_date", today)
      .gte("end_date", today)
      .maybeSingle(),
    supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("app_users").select("id", { count: "exact", head: true }).is("deleted_at", null).eq("active", true),
    supabase.from("firms").select("code, name, gst_registered").is("deleted_at", null).order("code"),
  ]);

  const day = jc ? jcDay(today) : 0;
  const pct = jc ? Math.round((day / jc.days) * 100) : 0;
  const firstName = me.fullName.split(" ")[0];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-brand-700">{formatDate(today)}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {greeting()}, {firstName}
          </h1>
        </div>
        <div className="flex gap-2">
          {(firms ?? []).map((f) => (
            <Badge key={f.code} tone={f.gst_registered ? "green" : "neutral"}>
              {f.name} · {f.gst_registered ? "GST" : "Non-GST"}
            </Badge>
          ))}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          tone="brand"
          label="Journey cycle"
          icon={<CalendarDays className="h-4 w-4" />}
          value={jc ? jc.jc_label : "—"}
          sub={
            jc
              ? `Day ${day} of ${jc.days} · ends ${formatDate(jc.end_date)}`
              : "No JC for today. Generate this FY in JC calendar."
          }
          footer={
            jc && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white" style={{ width: `${pct}%` }} />
              </div>
            )
          }
        />
        <Link href="/approvals" className="block transition hover:-translate-y-0.5">
          <StatCard
            label="Waiting for approval"
            icon={<CheckCircle2 className="h-4 w-4" />}
            value={formatNumber(pending ?? 0)}
            sub={pending ? "Open the queue →" : "Nothing waiting"}
          />
        </Link>
        <StatCard
          label="Active team members"
          icon={<Users className="h-4 w-4" />}
          value={formatNumber(activeUsers ?? 0)}
          sub="Office and field logins"
        />
        <StatCard
          tone="muted"
          label="Collected today"
          icon={<Wallet className="h-4 w-4" />}
          value="—"
          sub="Arrives with Phase 1 collections"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Your daily numbers" description="These fill in as each phase goes live." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {[
              { icon: Wallet, label: "Collected today / this JC", phase: "Phase 1" },
              { icon: IndianRupee, label: "Receivables & to collect", phase: "Phase 1" },
              { icon: Target, label: "Primary target achievement", phase: "Phase 4" },
              { icon: IndianRupee, label: "Payables & Vikram 1% discount", phase: "Phase 3" },
            ].map(({ icon: Icon, label, phase }) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50/60 px-4 py-3">
                <Icon className="h-5 w-5 text-slate-400" />
                <span className="flex-1 text-sm text-slate-700">{label}</span>
                <Badge>{phase}</Badge>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Quick actions" />
          <CardBody className="space-y-1">
            {[
              { href: "/users", label: "Add a staff member" },
              { href: "/approval-limits", label: "Set approval limits" },
              { href: "/calendar", label: "View JC calendar" },
            ].map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className="flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {a.label}
                <ArrowRight className="h-4 w-4 text-slate-400" />
              </Link>
            ))}
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
