import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { toLocale } from "@/lib/i18n";
import { PinLoginForm } from "./pin-login-form";

export const dynamic = "force-dynamic";

export default async function PinLoginPage() {
  const locale = toLocale((await cookies()).get("lang")?.value);
  let users: { id: string; full_name: string }[] = [];
  try {
    const { data } = await createAdminClient().rpc("pin_login_users");
    users = (data as typeof users | null) ?? [];
  } catch {
    users = [];
  }
  return (
    <main className="flex min-h-screen justify-center bg-slate-50 p-4">
      <PinLoginForm users={users} initialLocale={locale} />
    </main>
  );
}
