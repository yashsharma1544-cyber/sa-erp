"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) return setMessage({ kind: "error", text: error.message });
    router.replace(next);
    router.refresh();
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
    <form onSubmit={signInWithPassword} className="w-full max-w-sm space-y-4 rounded-xl bg-white p-6 shadow">
      <div>
        <h1 className="text-xl font-semibold">SA ERP</h1>
        <p className="text-sm text-slate-500">Sushil Agencies · Anjali Agency</p>
      </div>
      <label className="block text-sm">
        Email
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        Password
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
        />
      </label>
      {message && (
        <p className={message.kind === "error" ? "text-sm text-red-600" : "text-sm text-green-700"}>{message.text}</p>
      )}
      <button
        type="submit"
        disabled={busy || !password}
        className="w-full rounded-md bg-brand px-3 py-2 font-medium text-white disabled:opacity-50"
      >
        Sign in
      </button>
      <button
        type="button"
        onClick={sendMagicLink}
        disabled={busy}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50"
      >
        Email me a sign-in link
      </button>
      <a href="/pin-login" className="block text-center text-sm text-slate-500 underline">
        Field staff: sign in with PIN / फील्ड स्टाफ: पिन लॉगिन
      </a>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
