"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { optionalDecimal, optionalText } from "@/lib/validators";

const Vehicle = z.object({
  id: z.string().uuid().optional(),
  regNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 -]{4,15}$/, "Registration number looks wrong, e.g. MH21 AB 1234"),
  ownership: z.enum(["own", "borrowed_vikram", "hired"]),
  description: optionalText(80),
  capacityKg: optionalDecimal("Capacity"),
  active: z.boolean(),
});
export type VehicleInput = z.input<typeof Vehicle>;

export async function saveVehicle(input: VehicleInput): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Vehicle.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const row = { reg_no: v.regNo, ownership: v.ownership, description: v.description, capacity_kg: v.capacityKg, active: v.active };
  const supabase = await createClient();
  const { error } = v.id ? await supabase.from("vehicles").update(row).eq("id", v.id) : await supabase.from("vehicles").insert(row);
  if (error) return { error: error.code === "23505" ? "This vehicle is already added." : friendlyError(error) };
  revalidatePath("/vehicles");
  return { ok: v.id ? "Vehicle updated" : "Vehicle added" };
}
