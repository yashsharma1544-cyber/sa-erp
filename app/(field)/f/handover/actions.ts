"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError } from "@/lib/action-result";

const Notes = z.record(z.enum(["500", "200", "100", "50", "20", "10", "coins"]), z.number().min(0).max(99999));

export async function handOver(clientOpId: string, declared: Record<string, number>, note: string) {
  await requirePermission("receipt.record");
  const parsed = Notes.safeParse(declared);
  if (!z.string().uuid().safeParse(clientOpId).success || !parsed.success) return { error: "Check the note counts" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_handover", {
    p: { client_op_id: clientOpId, declared: parsed.data, note: note || null },
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/f/handover");
  return { handoverNo: (data as { handover_no: string }).handover_no };
}
