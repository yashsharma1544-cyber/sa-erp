"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

export async function syncTallyNow(): Promise<ActionResult> {
  await requireRole("owner");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tally_sync_now");
  if (error) return { error: friendlyError(error) };
  const r = data as { status: string; reason?: string; counts?: Record<string, number> & { error?: string } };
  revalidatePath("/settings");
  if (r.status === "skipped") return { error: r.reason ?? "Skipped" };
  if (r.status !== "ok") return { error: `Sync failed: ${r.counts?.error ?? "unknown error"}` };
  const changed = (r.counts?.vouchers ?? 0) + (r.counts?.voucher_lines ?? 0) + (r.counts?.voucher_allocations ?? 0);
  return { ok: `Synced. ${changed} voucher rows read.` };
}
