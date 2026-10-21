import { NextResponse, type NextRequest } from "next/server";
import { can, getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

// Cheque photo from the phone. Stored privately; the path goes into the receipt.
export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Signed out. Log in again." }, { status: 401 });
  if (!can(me, "receipt.record")) return NextResponse.json({ error: "Not allowed" }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const op = String(form?.get("client_op_id") ?? "");
  if (!(file instanceof Blob) || !/^[0-9a-f-]{36}$/.test(op)) {
    return NextResponse.json({ error: "Photo missing" }, { status: 422 });
  }
  const ext = TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "Photo must be JPEG, PNG or WebP" }, { status: 422 });
  if (file.size > 3 * 1024 * 1024) return NextResponse.json({ error: "Photo is too large" }, { status: 422 });

  // Same op id → same path, so a resend overwrites instead of piling up.
  const path = `${new Date().toISOString().slice(0, 7)}/${me.appUserId}/${op}.${ext}`;
  const { error } = await createAdminClient()
    .storage.from("cheques")
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ path });
}
