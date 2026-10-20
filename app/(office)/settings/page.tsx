import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  await requireUser();
  const supabase = await createClient();

  const [{ data: firms }, { data: godowns }, { data: settings }] = await Promise.all([
    supabase.from("firms").select("id, code, name, gst_registered, gstin, invoice_prefix").is("deleted_at", null).order("code"),
    supabase.from("godowns").select("id, name, is_counter, address").is("deleted_at", null).order("name"),
    supabase.from("app_settings").select("key, value, description").is("deleted_at", null).order("key"),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Firms &amp; settings</h1>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-medium">Firms</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {(firms ?? []).map((f) => (
            <li key={f.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span>
                <b>{f.code}</b> · {f.name}
              </span>
              <span className="text-slate-500">
                {f.gst_registered ? `GST registered${f.gstin ? " · " + f.gstin : " · GSTIN not set"}` : "Not GST registered"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-medium">Godowns (shared by both firms)</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {(godowns ?? []).map((g) => (
            <li key={g.id} className="py-2">
              {g.name}
              {g.is_counter && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs">sales counter</span>}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-sm">
        <h2 className="mb-2 font-medium">Settings</h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {(settings ?? []).map((s) => (
            <li key={s.key} className="flex justify-between gap-4 py-2">
              <span>{s.description}</span>
              <span className="num font-medium">{JSON.stringify(s.value)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
