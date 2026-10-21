import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Opens a cheque photo through a short-lived link. The user must be able to
// read the receipt itself (row-level security decides).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ receiptId: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Signed out" }, { status: 401 });
  const { receiptId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(receiptId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: receipt } = await supabase.from("receipts").select("cheque_photo_path").eq("id", receiptId).maybeSingle();
  if (!receipt?.cheque_photo_path) return NextResponse.json({ error: "No photo" }, { status: 404 });

  const { data, error } = await createAdminClient().storage.from("cheques").createSignedUrl(receipt.cheque_photo_path, 300);
  if (error || !data) return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
