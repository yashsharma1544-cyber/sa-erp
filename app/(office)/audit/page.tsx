import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime } from "@/lib/format";

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

function show(v: unknown): string {
  if (v === null || v === undefined) return "—";
  return typeof v === "string" ? v : JSON.stringify(v);
}

export default async function AuditPage({ searchParams }: Props) {
  await requireRole("owner");
  const { table } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("audit_log", { p_table: table ?? null, p_limit: 200 });
  const rows = (data ?? []) as AuditRow[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      {table && <p className="text-sm text-slate-500">Table: {table}</p>}
      {error && <p className="text-sm text-red-600">{error.message}</p>}
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-lg bg-white p-3 text-sm shadow-sm">
            <div className="flex flex-wrap justify-between gap-2">
              <span>
                <b>{r.action}</b> · <a href={`/audit?table=${r.table_name}`} className="underline">{r.table_name}</a>
              </span>
              <span className="text-slate-500">
                {r.changed_by_name ?? "system"} · {formatDateTime(r.changed_at)}
              </span>
            </div>
            {r.action !== "INSERT" && r.changed_fields && (
              <ul className="mt-1 text-slate-700">
                {r.changed_fields.map((f) => (
                  <li key={f}>
                    {f}: <span className="text-red-700 line-through">{show(r.old_data?.[f])}</span> →{" "}
                    <span className="text-green-700">{show(r.new_data?.[f])}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {rows.length === 0 && !error && <p className="text-sm text-slate-500">No changes yet.</p>}
      </div>
    </div>
  );
}
