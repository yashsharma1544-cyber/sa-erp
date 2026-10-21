"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

const id = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date");

async function call(fn: string, args: Record<string, unknown>, ok: string): Promise<ActionResult> {
  await requirePermission("cheque.manage");
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/cheques");
  revalidatePath("/");
  return { ok };
}

export async function depositCheques(ids: string[], bankAccountId: string, on: string): Promise<ActionResult> {
  if (!z.array(id).min(1).safeParse(ids).success || !id.safeParse(bankAccountId).success || !date.safeParse(on).success) {
    return { error: "Choose the cheques, the bank account and the date" };
  }
  return call("deposit_cheques", { p_ids: ids, p_bank_account_id: bankAccountId, p_date: on }, `${ids.length} cheque(s) marked deposited`);
}

export async function clearCheque(chequeId: string, on: string): Promise<ActionResult> {
  if (!id.safeParse(chequeId).success || !date.safeParse(on).success) return { error: "Enter the clearing date" };
  return call("clear_cheque", { p_id: chequeId, p_date: on }, "Cheque cleared");
}

export async function bounceCheque(chequeId: string, on: string, reason: string): Promise<ActionResult> {
  if (!id.safeParse(chequeId).success || !date.safeParse(on).success) return { error: "Enter the bounce date" };
  return call("bounce_cheque", { p_id: chequeId, p_date: on, p_reason: reason }, "Cheque marked bounced. The owner has been alerted.");
}

export async function returnCheque(chequeId: string, note: string): Promise<ActionResult> {
  if (!id.safeParse(chequeId).success) return { error: "Unknown cheque" };
  return call("return_cheque", { p_id: chequeId, p_note: note }, "Cheque returned and the receipt cancelled");
}

export async function setBounceCharge(bounceId: string, status: "raised" | "waived", ref: string): Promise<ActionResult> {
  if (!id.safeParse(bounceId).success) return { error: "Unknown bounce" };
  return call("set_bounce_charge", { p_id: bounceId, p_status: status, p_ref: ref || null }, status === "raised" ? "Charge marked raised in Tally" : "Charge waived");
}
