"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function decide(id: string, approve: boolean, note: string): Promise<{ error?: string }> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { error: "Invalid request" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("decide_approval", {
    p_id: id,
    p_approve: approve,
    p_note: note.trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/approvals");
  return {};
}

export async function cancelRequest(id: string): Promise<{ error?: string }> {
  await requireUser();
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_approval_request", { p_id: id });
  if (error) return { error: error.message };
  revalidatePath("/approvals");
  return {};
}
