"use client";

import { useMemo, useState } from "react";
import { t, type Locale } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";

type User = { id: string; full_name: string };

export function PinLoginForm({ users, initialLocale }: { users: User[]; initialLocale: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () => users.filter((u) => u.full_name.toLowerCase().includes(query.trim().toLowerCase())),
    [users, query],
  );

  function switchLocale() {
    const next: Locale = locale === "mr" ? "en" : "mr";
    setLocale(next);
    document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
  }

  async function submit(fullPin: string) {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, pin: fullPin }),
      });
      const body = await res.json();
      if (body.ok) {
        // Full page load so the server sees the new session cookie straight away.
        window.location.assign("/f");
        return;
      }
      setPin("");
      if (body.reason === "locked") setError(t(locale, "locked", { time: formatDateTime(body.locked_until) }));
      else if (body.reason === "wrong_pin") setError(t(locale, "wrongPin", { n: body.attempts_left ?? "" }));
      else setError(t(locale, "unknownUser"));
    } catch {
      setError(t(locale, "networkError"));
    } finally {
      setBusy(false);
    }
  }

  function press(digit: string) {
    if (busy || pin.length >= 4) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === 4) void submit(next);
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-700 text-sm font-bold text-white">SA</span>
          <h1 className="text-lg font-semibold">{t(locale, "appName")}</h1>
        </div>
        <button
          onClick={switchLocale}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm"
        >
          {locale === "mr" ? "English" : "मराठी"}
        </button>
      </div>

      {!user ? (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{t(locale, "chooseName")}</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(locale, "searchName")}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg shadow-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
          <ul className="space-y-2">
            {filtered.map((u) => (
              <li key={u.id}>
                <button
                  onClick={() => {
                    setUser(u);
                    setPin("");
                    setError(null);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 text-left text-lg shadow-card active:bg-brand-50"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">
                    {u.full_name.slice(0, 1).toUpperCase()}
                  </span>
                  {u.full_name}
                </button>
              </li>
            ))}
          </ul>
          <a href="/login" className="block pt-4 text-center text-sm text-slate-500 underline">
            {t(locale, "officeLogin")}
          </a>
        </section>
      ) : (
        <section className="space-y-4">
          <button onClick={() => setUser(null)} className="text-sm text-slate-500">
            ← {t(locale, "back")}
          </button>
          <div className="text-center">
            <div className="text-xl font-semibold">{user.full_name}</div>
            <div className="mt-1 text-slate-600">{t(locale, "enterPin")}</div>
          </div>
          <div className="flex justify-center gap-3" aria-label="PIN">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={"h-4 w-4 rounded-full transition " + (i < pin.length ? "bg-brand-700" : "border-2 border-slate-300")}
              />
            ))}
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">{error}</p>}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                disabled={busy}
                onClick={() => press(d)}
                className="rounded-2xl border border-slate-200 bg-white py-5 text-2xl font-medium shadow-card active:bg-brand-50 disabled:opacity-50"
              >
                {d}
              </button>
            ))}
            <button onClick={() => setPin("")} disabled={busy} className="rounded-xl py-5 text-base text-slate-600">
              {t(locale, "clear")}
            </button>
            <button
              disabled={busy}
              onClick={() => press("0")}
              className="rounded-2xl border border-slate-200 bg-white py-5 text-2xl font-medium shadow-card active:bg-brand-50 disabled:opacity-50"
            >
              0
            </button>
            <span />
          </div>
        </section>
      )}
    </div>
  );
}
