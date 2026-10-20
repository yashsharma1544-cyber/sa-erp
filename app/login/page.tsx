"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthLayout } from "@/components/shell/auth-layout";
import { Button } from "@/components/ui/button";
import { Alert, Field, Input } from "@/components/ui/field";

function LoginForm() {
  const params = useSearchParams();
  const rawNext = params.get("next") || "/";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) {
      setBusy(false);
      return setMessage({ kind: "error", text: error.message });
    }
    // Full page load so the server sees the new session cookie straight away.
    window.location.assign(next);
  }

  async function sendMagicLink() {
    if (!email) return setMessage({ kind: "error", text: "Enter your email first." });
    setBusy(true);
    setMessage(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await createClient().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });
    setBusy(false);
    setMessage(error ? { kind: "error", text: error.message } : { kind: "info", text: "Check your email for a sign-in link." });
  }

  return (
    <div className="space-y-8">
      <div className="lg:hidden">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-700 text-base font-bold text-white">SA</span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Office and owner login</p>
      </div>

      <form onSubmit={signInWithPassword} className="space-y-4">
        <Field label="Email">
          <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {message && <Alert kind={message.kind === "error" ? "error" : "success"}>{message.text}</Alert>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
        <Button type="button" variant="secondary" className="w-full" onClick={sendMagicLink} disabled={busy}>
          Email me a sign-in link
        </Button>
      </form>

      <a
        href="/pin-login"
        className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600 hover:bg-white"
      >
        <Smartphone className="h-4 w-4" />
        Field staff: PIN login · फील्ड स्टाफ: पिन लॉगिन
      </a>
    </div>
  );
}

export default function LoginPage() {
  return (
    <AuthLayout>
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthLayout>
  );
}
