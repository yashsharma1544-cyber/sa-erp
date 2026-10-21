import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toLocale } from "@/lib/i18n";
import { CollectApp } from "./collect-app";

const OFFICE_ROLES = ["owner", "sales_admin", "accounts", "stores", "dispatch"];

export default async function CollectPage() {
  const me = await requireUser();
  if (!can(me, "receipt.record")) redirect("/f");
  const locale = toLocale((await cookies()).get("lang")?.value, me.locale);
  const supabase = await createClient();
  const office = me.roles.some((r) => OFFICE_ROLES.includes(r));

  // Field staff: their collection beats. Office users: every beat.
  const beatQuery = office
    ? supabase.from("v_beats").select("id, name, territory_name").eq("active", true).order("territory_name").order("name")
    : supabase
        .from("user_beats")
        .select("beat:beats(id, name, territory:territories(name))")
        .eq("user_id", me.appUserId)
        .eq("purpose", "collection")
        .is("deleted_at", null);

  const [{ data: beatRows }, { data: firms }] = await Promise.all([
    beatQuery,
    supabase.from("firms").select("id, code, name").is("deleted_at", null).order("code"),
  ]);

  type Joined = { beat: { id: string; name: string; territory: { name: string } | null } | null };
  const beats = office
    ? ((beatRows ?? []) as { id: string; name: string; territory_name: string | null }[]).map((b) => ({
        id: b.id, name: b.name, territory: b.territory_name,
      }))
    : ((beatRows ?? []) as unknown as Joined[])
        .filter((r) => r.beat)
        .map((r) => ({ id: r.beat!.id, name: r.beat!.name, territory: r.beat!.territory?.name ?? null }))
        .sort((a, b) => a.name.localeCompare(b.name));

  return <CollectApp locale={locale} beats={beats} firms={firms ?? []} />;
}
