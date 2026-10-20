import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BeatsClient, type BeatRow, type Territory } from "./beats-client";

export default async function BeatsPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const [{ data: territories }, { data: beats }] = await Promise.all([
    supabase.from("territories").select("id, name, sort_order").is("deleted_at", null).order("sort_order"),
    supabase
      .from("v_beats")
      .select("id, name, route_kind, route_weekday, active, territory_id, territory_name, customer_count")
      .order("name"),
  ]);
  return (
    <BeatsClient
      territories={(territories ?? []) as Territory[]}
      beats={(beats ?? []) as BeatRow[]}
      canEdit={can(me, "masters.manage")}
    />
  );
}
