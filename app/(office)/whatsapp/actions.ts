"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { friendlyError, type ActionResult } from "@/lib/action-result";
import { dispatchQueued } from "@/lib/whatsapp/dispatch";

async function requireEditor() {
  const me = await requireUser();
  if (!me.roles.includes("owner") && !can(me, "settings.manage")) throw new Error("Not allowed");
}

const Template = z.object({
  id: z.string().uuid(),
  watiTemplateName: z.string().trim().max(120),
  approved: z.boolean(),
  active: z.boolean(),
});

export async function saveTemplate(input: z.input<typeof Template>): Promise<ActionResult> {
  await requireEditor();
  const p = Template.safeParse(input);
  if (!p.success) return { error: p.error.issues[0]?.message };
  if (p.data.active && (!p.data.approved || !p.data.watiTemplateName)) {
    return { error: "A template can only be switched on once it is approved in WATi and its WATi name is filled in." };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("wa_templates")
    .update({ wati_template_name: p.data.watiTemplateName || null, approved: p.data.approved, active: p.data.active })
    .eq("id", p.data.id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/whatsapp");
  return { ok: "Template saved" };
}

const Rule = z.object({
  id: z.string().uuid(),
  minOverdueDays: z.number().int().min(0).max(365),
  repeatEveryDays: z.number().int().min(1).max(60),
  active: z.boolean(),
});

export async function saveRule(input: z.input<typeof Rule>): Promise<ActionResult> {
  await requireEditor();
  const p = Rule.safeParse(input);
  if (!p.success) return { error: "Days must be whole numbers (overdue 0–365, repeat 1–60)" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("reminder_rules")
    .update({ min_overdue_days: p.data.minOverdueDays, repeat_every_days: p.data.repeatEveryDays, active: p.data.active })
    .eq("id", p.data.id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/whatsapp");
  return { ok: "Reminder step saved" };
}

export async function retryMessage(id: string): Promise<ActionResult> {
  await requireUser();
  if (!z.string().uuid().safeParse(id).success) return { error: "Unknown message" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("wa_retry", { p_id: id });
  if (error) return { error: friendlyError(error) };
  const r = await dispatchQueued({ ids: [id] });
  revalidatePath("/whatsapp");
  if (!r.configured) return { ok: "Queued again. It will go once WATi is set up." };
  return r.sent ? { ok: "Sent" } : { error: "Still failing. See the error on the message." };
}
