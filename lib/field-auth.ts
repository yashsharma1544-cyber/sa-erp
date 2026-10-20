import "server-only";
import { createHmac } from "crypto";

// Each field (PIN) user has a hidden Supabase Auth account. Its password is
// derived from a server secret, so it is never stored and never leaves the
// server. The PIN itself is checked in the database (public.verify_pin).

function secret(): string {
  const s = process.env.FIELD_AUTH_SECRET;
  if (!s || s.length < 32) throw new Error("FIELD_AUTH_SECRET must be set (32+ characters)");
  return s;
}

export function fieldAuthEmail(appUserId: string): string {
  return `pin-${appUserId}@field.sa-erp.invalid`;
}

export function fieldAuthPassword(appUserId: string): string {
  return createHmac("sha256", secret()).update(`field-login:${appUserId}`).digest("base64url");
}
