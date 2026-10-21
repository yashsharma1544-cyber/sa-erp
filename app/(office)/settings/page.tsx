import { Building2, Warehouse } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TallySyncCard, type TallySyncStatus } from "./tally-sync-card";

export default async function SettingsPage() {
  const me = await requireUser();
  const supabase = await createClient();

  const [{ data: firms }, { data: godowns }, { data: settings }, { data: sync }] = await Promise.all([
    supabase.from("firms").select("id, code, name, gst_registered, gstin, invoice_prefix").is("deleted_at", null).order("code"),
    supabase.from("godowns").select("id, name, is_counter, address").is("deleted_at", null).order("name"),
    supabase.from("app_settings").select("key, value, description").is("deleted_at", null).order("key"),
    supabase.rpc("tally_sync_status").maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Firms & settings" description="Both firms share the godowns, staff and vehicles. Their books are never mixed." />

      <div className="grid gap-4 md:grid-cols-2">
        {(firms ?? []).map((f) => (
          <Card key={f.id} className="p-5">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
                <Building2 className="h-5 w-5" />
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{f.name}</h2>
                  <Badge tone={f.gst_registered ? "green" : "neutral"}>{f.gst_registered ? "GST registered" : "Not GST registered"}</Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
                  <dt className="text-slate-500">Code</dt>
                  <dd className="font-medium">{f.code}</dd>
                  <dt className="text-slate-500">Invoice prefix</dt>
                  <dd className="font-medium">{f.invoice_prefix}</dd>
                  <dt className="text-slate-500">Bills as</dt>
                  <dd className="font-medium">{f.gst_registered ? "Tax invoice" : "Non-GST bill"}</dd>
                  {f.gst_registered && (
                    <>
                      <dt className="text-slate-500">GSTIN</dt>
                      <dd className={f.gstin ? "font-medium" : "text-amber-700"}>{f.gstin ?? "Not set yet"}</dd>
                    </>
                  )}
                </dl>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <TallySyncCard sync={(sync as TallySyncStatus | null) ?? null} isOwner={me.roles.includes("owner")} />

      <Card>
        <CardHeader title="Godowns" description="Shared by both firms." />
        <ul className="divide-y divide-slate-100">
          {(godowns ?? []).map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <Warehouse className="h-4 w-4 text-slate-400" />
              <span className="flex-1 font-medium">{g.name}</span>
              {g.is_counter && <Badge tone="blue">Sales counter</Badge>}
              <span className="text-slate-500">{g.address}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Rules" description="Values the ERP uses in its checks." />
        <ul className="divide-y divide-slate-100">
          {(settings ?? []).map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
              <span className="text-slate-700">{s.description}</span>
              <span className="num rounded-md bg-slate-100 px-2.5 py-1 font-semibold text-slate-900">
                {typeof s.value === "number" || typeof s.value === "string" ? String(s.value) : JSON.stringify(s.value)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
