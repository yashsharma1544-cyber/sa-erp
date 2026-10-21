"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";

export type Candidate = {
  voucher_id: string;
  voucher_no: string | null;
  voucher_date: string;
  ledger_name: string;
  amount: string;
  same_party: boolean;
  same_amount: boolean;
};
export type MatchedTo = { voucher_no: string | null; voucher_date: string; ledger_name: string; amount: string; method: string };

const id = z.string().uuid();

export async function getCandidates(receiptId: string): Promise<{ candidates?: Candidate[]; matched?: MatchedTo | null; error?: string }> {
  await requirePermission("reports.view_all");
  if (!id.safeParse(receiptId).success) return { error: "Unknown receipt" };
  const supabase = await createClient();
  const [{ data: candidates, error }, { data: matched }] = await Promise.all([
    supabase.rpc("receipt_match_candidates", { p_receipt_id: receiptId }),
    supabase.rpc("receipt_tally_voucher", { p_receipt_id: receiptId }).maybeSingle(),
  ]);
  if (error) return { error: friendlyError(error) };
  return { candidates: (candidates ?? []) as Candidate[], matched: (matched as MatchedTo | null) ?? null };
}

export async function matchReceipt(receiptId: string, voucherId: string): Promise<ActionResult> {
  await requirePermission("receipt.reallocate");
  if (!id.safeParse(receiptId).success || !id.safeParse(voucherId).success) return { error: "Unknown receipt" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("match_receipt", { p_receipt_id: receiptId, p_voucher_id: voucherId });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/tally-match");
  return { ok: "Matched to the Tally receipt" };
}

export async function unmatchReceipt(receiptId: string): Promise<ActionResult> {
  await requirePermission("receipt.reallocate");
  if (!id.safeParse(receiptId).success) return { error: "Unknown receipt" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("unmatch_receipt", { p_receipt_id: receiptId });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/tally-match");
  return { ok: "Unmatched" };
}
