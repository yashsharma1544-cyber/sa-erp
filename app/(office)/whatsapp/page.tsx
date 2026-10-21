import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { watiConfigured } from "@/lib/whatsapp/wati";
import { WhatsAppClient, type MessageRow, type RuleRow, type TemplateRow } from "./whatsapp-client";

export default async function WhatsAppPage() {
  const me = await requireUser();
  if (!can(me, "reports.view_all")) redirect("/no-access");
  const supabase = await createClient();
  const [{ data: templates }, { data: rules }, { data: messages }] = await Promise.all([
    supabase.from("wa_templates").select("id, key, wati_template_name, params, body_mr, approved, active").is("deleted_at", null).order("key"),
    supabase.from("reminder_rules").select("id, min_overdue_days, template_key, repeat_every_days, active").is("deleted_at", null).order("min_overdue_days"),
    supabase
      .from("wa_messages")
      .select("id, template_key, to_number, status, error, attempts, created_at, sent_at, customer:customers(name), firm_id")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(300),
  ]);
  return (
    <WhatsAppClient
      templates={(templates ?? []) as TemplateRow[]}
      rules={(rules ?? []) as RuleRow[]}
      messages={(messages ?? []) as unknown as MessageRow[]}
      configured={watiConfigured()}
      canEdit={me.roles.includes("owner") || can(me, "settings.manage")}
    />
  );
}
