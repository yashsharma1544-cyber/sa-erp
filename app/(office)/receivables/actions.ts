"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/action-result";
import { loadArBills } from "./data";
import type { ArBill } from "./types";

export async function getBills(firmId: string, ledgerKey: string): Promise<{ bills?: ArBill[]; error?: string }> {
  await requirePermission("reports.view_all");
  if (!z.string().uuid().safeParse(firmId).success) return { error: "Unknown firm" };
  try {
    return { bills: await loadArBills(firmId, ledgerKey) };
  } catch (e) {
    return { error: friendlyError(e as { message: string }) };
  }
}

export type Dso = { outstanding: string; credit_sales: string; days: number; dso: string | null };

const Period = z.object({
  firmId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function getDso(input: z.input<typeof Period>): Promise<{ dso?: Dso; error?: string }> {
  await requirePermission("reports.view_all");
  const parsed = Period.safeParse(input);
  if (!parsed.success) return { error: "Pick a valid period" };
  if (parsed.data.to < parsed.data.from) return { error: "The end date is before the start date" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("ar_dso", { p_firm_id: parsed.data.firmId, p_from: parsed.data.from, p_to: parsed.data.to })
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!data) return { error: "Not allowed" };
  return { dso: data as Dso };
}
