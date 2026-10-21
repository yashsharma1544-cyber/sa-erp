"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const Notes = z.record(z.enum(["500", "200", "100", "50", "20", "10", "coins"]), z.number().min(0).max(99999));

const done = (msg: string): ActionResult => {
  revalidatePath("/cash");
  return { ok: msg };
};

/** Take a handover on behalf of a collector who is at the office. */
export async function takeHandover(collectorId: string): Promise<ActionResult> {
  await requirePermission("handover.count");
  if (!z.string().uuid().safeParse(collectorId).success) return { error: "Unknown collector" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_handover", { p: { collector_id: collectorId } });
  if (error) return { error: friendlyError(error) };
  return done(`Handover ${(data as { handover_no: string }).handover_no} opened. Count the notes.`);
}

export async function acceptHandover(id: string, counted: Record<string, number>, note: string): Promise<ActionResult> {
  await requirePermission("handover.count");
  const parsed = Notes.safeParse(counted);
  if (!z.string().uuid().safeParse(id).success || !parsed.success) return { error: "Check the note counts" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("accept_handover", { p_id: id, p_counted: parsed.data, p_note: note || null });
  if (error) return { error: friendlyError(error) };
  const v = Number((data as { variance: number }).variance);
  return done(v === 0 ? "Counted and accepted. No difference." : `Accepted with a difference of ₹${v.toFixed(2)}.`);
}

export async function cancelHandover(id: string, note: string): Promise<ActionResult> {
  await requirePermission("handover.count");
  if (!z.string().uuid().safeParse(id).success) return { error: "Unknown handover" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_handover", { p_id: id, p_note: note });
  if (error) return { error: friendlyError(error) };
  return done("Handover cancelled. The cash is back with the collector.");
}

const Deposit = z.object({
  firmId: z.string().uuid(),
  bankAccountId: z.string().uuid({ message: "Choose the bank account" }),
  depositedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the deposit date"),
  slipNo: z.string().trim().max(40).optional(),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/, "Enter the slip amount"),
  receiptIds: z.array(z.string().uuid()).min(1, "Choose the cash to deposit"),
  note: z.string().trim().max(300).optional(),
});

export async function recordDeposit(input: z.input<typeof Deposit>): Promise<ActionResult> {
  await requirePermission("deposit.record");
  const parsed = Deposit.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const v = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_deposit", {
    p: {
      firm_id: v.firmId, bank_account_id: v.bankAccountId, deposited_on: v.depositedOn, slip_no: v.slipNo,
      amount: v.amount, receipt_ids: v.receiptIds, note: v.note,
    },
  });
  if (error) return { error: friendlyError(error) };
  const variance = Number((data as { variance: number }).variance);
  return done(variance === 0 ? "Deposit recorded." : `Deposit recorded with a difference of ₹${variance.toFixed(2)}.`);
}
