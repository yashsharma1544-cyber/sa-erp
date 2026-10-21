"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const Rates = z.object({
  firmId: z.string().uuid(),
  rates: z
    .array(z.object({ itemId: z.string().uuid(), rate: z.string().trim().regex(/^\d{1,10}(\.\d{1,4})?$/, "Rates must be numbers with up to 4 decimals") }))
    .min(1, "Change at least one rate"),
  note: z.string().trim().max(200).optional(),
});

/** Today's rates for the changed items; earlier rates stay in the history. */
export async function savePrices(input: z.input<typeof Rates>): Promise<ActionResult> {
  await requirePermission("price.manage");
  const parsed = Rates.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  if (v.rates.some((r) => Number(r.rate) <= 0)) return { error: "Rates must be more than 0" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_prices", {
    p_firm_id: v.firmId,
    p_rates: v.rates.map((r) => ({ item_id: r.itemId, rate: r.rate })),
    p_note: v.note || null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/prices");
  return { ok: `${Number(data ?? 0)} rate(s) updated from today` };
}
