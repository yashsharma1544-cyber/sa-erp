import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const Op = z.object({
  client_op_id: z.string().uuid(),
  kind: z.enum(["receipt", "promise", "visit"]),
  firm_id: z.string().uuid().optional(),
  customer_id: z.string().uuid(),
  amount: z.string().regex(/^\d{1,9}(\.\d{1,2})?$/).optional(),
  mode: z.enum(["cash", "upi", "cheque"]).optional(),
  upi_ref: z.string().max(60).optional(),
  cheque_no: z.string().max(20).optional(),
  cheque_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cheque_bank: z.string().max(80).optional(),
  cheque_photo_path: z.string().max(200).optional(),
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outcome: z.enum(["not_available", "refused", "closed"]).optional(),
  note: z.string().max(500).optional(),
  happened_at: z.string().datetime(),
  lat: z.string().max(20).optional(),
  lng: z.string().max(20).optional(),
});

// One entry from the phone's outbox. Safe to resend: the database returns the
// original row for a client_op_id it has already seen.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Signed out. Log in again." }, { status: 401 });
  const parsed = Op.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 422 });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_collection", { p: parsed.data });
  if (error) {
    const permanent = ["22", "23", "42", "P0", "02"].some((c) => (error.code ?? "").startsWith(c));
    return NextResponse.json({ error: error.message }, { status: permanent ? 422 : 500 });
  }
  return NextResponse.json(data);
}
