"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const Beat = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(2, "Beat name is too short").max(80),
    territoryId: z.string().uuid("Choose a territory"),
    routeKind: z.enum(["city", "outstation", "counter"]),
    routeWeekday: z.number().int().min(0).max(6).nullable(),
    active: z.boolean(),
  })
  .refine((v) => v.routeKind !== "outstation" || v.routeWeekday !== null, { message: "Pick the route day for an outstation beat" });

export type BeatInput = z.input<typeof Beat>;

export async function saveBeat(input: BeatInput): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = Beat.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const row = {
    name: v.name,
    territory_id: v.territoryId,
    route_kind: v.routeKind,
    route_weekday: v.routeKind === "outstation" ? v.routeWeekday : null,
    active: v.active,
  };
  const supabase = await createClient();
  const { error } = v.id
    ? await supabase.from("beats").update(row).eq("id", v.id)
    : await supabase.from("beats").insert(row);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/beats");
  return { ok: v.id ? "Beat updated" : "Beat added" };
}

export async function saveTerritory(name: string): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = z.string().trim().min(2).max(60).safeParse(name);
  if (!parsed.success) return { error: "Territory name is too short" };
  const supabase = await createClient();
  const { error } = await supabase.from("territories").insert({ name: parsed.data, sort_order: 50 });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/beats");
  return { ok: "Territory added" };
}
