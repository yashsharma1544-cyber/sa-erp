import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/field";

type Props = { searchParams: Promise<{ table?: string }> };

type AuditRow = {
  id: number;
  table_name: string;
  row_id: string | null;
  action: string;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  changed_by_name: string | null;
  changed_at: string;
};

const actionTone = { INSERT: "green", UPDATE: "blue", SOFT_DELETE: "red", RESTORE: "amber" } as const;
const actionLabel: Record<string, string> = { INSERT: "Added", UPDATE: "Changed", SOFT_DELETE: "Removed", RESTORE: "Restored" };

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

function title(r: AuditRow): string {
  const d = r.new_data ?? {};
  return String(d.full_name ?? d.name ?? d.subject_label ?? d.key ?? d.code ?? d.description ?? r.row_id ?? "");
}

export default async function AuditPage({ searchParams }: Props) {
  await requireRole("owner");
  const { table } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("audit_log", { p_table: table ?? null, p_limit: 200 });
  const rows = (data ?? []) as AuditRow[];

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Every change, by whom and when, with the old and new values. Nothing is ever hard-deleted."
        actions={
          table && (
            <Link href="/audit" className="text-sm font-medium text-brand-700 hover:underline">
              Clear filter ({table})
            </Link>
          )
        }
      />
      {error && <Alert kind="error">{error.message}</Alert>}
      <Card>
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={actionTone[r.action as keyof typeof actionTone] ?? "neutral"}>{actionLabel[r.action] ?? r.action}</Badge>
                <Link href={`/audit?table=${r.table_name}`} className="font-mono text-xs text-slate-500 hover:text-brand-700">
                  {r.table_name}
                </Link>
                <span className="font-medium text-slate-900">{title(r)}</span>
                <span className="ml-auto text-xs text-slate-500">
                  {r.changed_by_name ?? "System"} · {formatDateTime(r.changed_at)}
                </span>
              </div>
              {r.action !== "INSERT" && r.changed_fields && (
                <ul className="mt-2 space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-slate-700">
                  {r.changed_fields.map((f) => (
                    <li key={f} className="flex flex-wrap gap-2">
                      <span className="font-mono text-xs text-slate-500">{f}</span>
                      <span className="text-red-700 line-through">{show(r.old_data?.[f])}</span>
                      <span className="text-slate-400">→</span>
                      <span className="text-brand-800">{show(r.new_data?.[f])}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
          {rows.length === 0 && !error && <li className="px-5 py-10 text-center text-sm text-slate-500">No changes yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
