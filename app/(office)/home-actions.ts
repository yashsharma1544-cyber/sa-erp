"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function markAlertRead(id: string) {
  await requireRole("owner");
  if (!z.string().uuid().safeParse(id).success) return;
  const supabase = await createClient();
  await supabase.rpc("mark_alert_read", { p_id: id });
  revalidatePath("/");
}
