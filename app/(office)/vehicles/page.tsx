import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VehiclesClient, type VehicleRow } from "./vehicles-client";

export default async function VehiclesPage() {
  const me = await requireUser();
  const supabase = await createClient();
  const { data } = await supabase
    .from("vehicles")
    .select("id, reg_no, ownership, description, capacity_kg, active")
    .is("deleted_at", null)
    .order("reg_no");
  return <VehiclesClient vehicles={(data ?? []) as VehicleRow[]} canEdit={can(me, "masters.manage")} />;
}
