import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { toLocale } from "@/lib/i18n";
import { HandoverApp, type MyHandover, type MyReceipt } from "./handover-app";

export default async function HandoverPage() {
  const me = await requireUser();
  if (!can(me, "receipt.record")) redirect("/f");
  const locale = toLocale((await cookies()).get("lang")?.value, me.locale);
  const supabase = await createClient();
  const [{ data: receipts }, { data: handovers }] = await Promise.all([
    supabase
      .from("receipts")
      .select("id, receipt_no, amount, collected_at, customer:customers(name)")
      .eq("collected_by", me.appUserId)
      .eq("mode", "cash")
      .eq("status", "recorded")
      .is("deleted_at", null)
      .order("collected_at"),
    supabase
      .from("cash_handovers")
      .select("id, handover_no, handed_at, expected_cash, counted_total, variance, status")
      .eq("collector_id", me.appUserId)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .order("handed_at", { ascending: false })
      .limit(10),
  ]);
  return (
    <HandoverApp
      locale={locale}
      receipts={(receipts ?? []) as unknown as MyReceipt[]}
      handovers={(handovers ?? []) as MyHandover[]}
    />
  );
}
