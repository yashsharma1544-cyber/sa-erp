"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireRole } from "@/lib/auth";
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

const BankAccount = z.object({
  id: z.string().uuid().optional(),
  firmId: z.string().uuid(),
  bank: z.string().trim().min(2, "Enter the bank name").max(80),
  branch: z.string().trim().max(80).optional(),
  last4: z.string().trim().regex(/^(\d{4})?$/, "Last 4 digits of the account number").optional(),
  tallyLedgerName: z.string().trim().max(160).optional(),
  active: z.boolean(),
});

export async function saveBankAccount(input: z.input<typeof BankAccount>): Promise<ActionResult> {
  await requirePermission("masters.manage");
  const parsed = BankAccount.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const row = {
    firm_id: v.firmId,
    bank: v.bank,
    branch: v.branch || null,
    account_last4: v.last4 || null,
    tally_ledger_name: v.tallyLedgerName || null,
    active: v.active,
  };
  const supabase = await createClient();
  const { error } = v.id
    ? await supabase.from("bank_accounts").update(row).eq("id", v.id)
    : await supabase.from("bank_accounts").insert(row);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/settings");
  return { ok: v.id ? "Bank account updated" : "Bank account added" };
}
