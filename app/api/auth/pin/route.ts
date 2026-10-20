import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { fieldAuthEmail, fieldAuthPassword } from "@/lib/field-auth";

const Body = z.object({
  userId: z.string().uuid(),
  pin: z.string().regex(/^\d{4}$/),
});

type VerifyResult =
  | { ok: true; auth_user_id: string }
  | { ok: false; reason: "unknown" | "locked" | "wrong_pin"; locked_until?: string; attempts_left?: number };

export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, reason: "wrong_pin", attempts_left: null }, { status: 400 });
  const { userId, pin } = parsed.data;

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("verify_pin", { p_user_id: userId, p_pin: pin });
  if (error) return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });

  const result = data as VerifyResult;
  if (!result.ok) return NextResponse.json(result, { status: 401 });

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: fieldAuthEmail(userId),
    password: fieldAuthPassword(userId),
  });
  if (signInError) return NextResponse.json({ ok: false, reason: "error" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
