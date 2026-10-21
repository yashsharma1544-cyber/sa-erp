import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { appUrl } from "@/lib/app-url";
import { sendTemplate, watiConfigured } from "./wati";
import { templateValues } from "./format";

type Queued = {
  id: string;
  template_key: string;
  to_number: string;
  data: Record<string, unknown>;
  created_at: string;
  attempts: number;
  template: { wati_template_name: string | null; params: string[]; active: boolean } | null;
};

export type DispatchResult = { sent: number; failed: number; skipped: number; waiting: number; configured: boolean };

/**
 * Send queued WhatsApp messages (optionally only some). Old ones are dropped:
 * a receipt after 3 days, a reminder after the day it was meant for.
 */
export async function dispatchQueued(opts: { ids?: string[]; limit?: number } = {}): Promise<DispatchResult> {
  const out: DispatchResult = { sent: 0, failed: 0, skipped: 0, waiting: 0, configured: watiConfigured() };
  const admin = createAdminClient();
  let q = admin
    .from("wa_messages")
    .select("id, template_key, to_number, data, created_at, attempts, template:wa_templates(wati_template_name, params, active)")
    .eq("status", "queued")
    .is("deleted_at", null)
    .order("created_at")
    .limit(opts.limit ?? 200);
  if (opts.ids?.length) q = q.in("id", opts.ids);
  const { data, error } = await q;
  if (error) throw error;

  const base = appUrl();
  for (const m of (data ?? []) as unknown as Queued[]) {
    const ageH = (Date.now() - new Date(m.created_at).getTime()) / 3_600_000;
    const maxAgeH = m.template_key === "receipt" ? 72 : 20;
    if (ageH > maxAgeH) {
      await admin.rpc("wa_mark", { p_id: m.id, p_status: "skipped", p_error: "Too old to send" });
      out.skipped++;
      continue;
    }
    if (!m.template?.active || !m.template.wati_template_name) {
      await admin.rpc("wa_mark", { p_id: m.id, p_status: "skipped", p_error: "Template not active" });
      out.skipped++;
      continue;
    }
    if (!out.configured) {
      out.waiting++;
      continue;
    }
    const values = templateValues(m.template.params, m.data, base);
    const r = await sendTemplate(m.to_number, m.template.wati_template_name, values, `erp_${m.template_key}`);
    if (r.ok) {
      await admin.rpc("wa_mark", { p_id: m.id, p_status: "sent", p_wati_id: r.id ?? null });
      out.sent++;
    } else {
      // Network trouble stays queued for the next run (up to 3 tries).
      const giveUp = !r.retry || m.attempts >= 2;
      await admin.rpc("wa_mark", { p_id: m.id, p_status: giveUp ? "failed" : "queued", p_error: r.error });
      out.failed++;
    }
  }
  return out;
}

/** Send the receipt message for one receipt right away (best effort). */
export async function sendReceiptMessage(receiptId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("wa_messages")
    .select("id")
    .eq("related_table", "receipts")
    .eq("related_id", receiptId)
    .eq("status", "queued")
    .maybeSingle();
  if (data) await dispatchQueued({ ids: [data.id] });
}
