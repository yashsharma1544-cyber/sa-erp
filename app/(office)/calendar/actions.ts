"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function generateFiscalYear(startYear: number): Promise<{ error?: string }> {
  await requireRole("owner");
  if (!Number.isInteger(startYear) || startYear < 2020 || startYear > 2100) return { error: "Invalid year" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("generate_journey_cycles", { p_start_year: startYear });
  if (error) return { error: error.message };
  revalidatePath("/calendar");
  return {};
}
