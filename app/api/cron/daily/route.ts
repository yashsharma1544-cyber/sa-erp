import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dispatchQueued } from "@/lib/whatsapp/dispatch";

export const maxDuration = 300;

// Vercel Cron, every morning at 09:00 IST (vercel.json). Vercel sends
// "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }
  const admin = createAdminClient();
  const { data: closed, error: e1 } = await admin.rpc("close_due_promises");
  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  const { data: queued, error: e2 } = await admin.rpc("wa_queue_reminders");
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  const sent = await dispatchQueued({ limit: 500 });
  return NextResponse.json({ promisesClosed: closed, queued, sent });
}
