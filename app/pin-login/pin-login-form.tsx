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
    <div className="w-full max-w-sm space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t(locale, "appName")}</h1>
        <button onClick={switchLocale} className="rounded-md border border-slate-300 px-3 py-1 text-sm">
          {locale === "mr" ? "English" : "मराठी"}
        </button>
      </div>

      {!user ? (
        <section className="space-y-3">
          <h2 className="text-lg">{t(locale, "chooseName")}</h2>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t(locale, "searchName")}
            className="w-full rounded-md border border-slate-300 px-3 py-3 text-lg"
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
                  className="w-full rounded-lg bg-white px-4 py-4 text-left text-lg shadow-sm active:bg-slate-100"
                >
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
          <div className="text-lg font-medium">{user.full_name}</div>
          <div className="text-slate-600">{t(locale, "enterPin")}</div>
          <div className="flex justify-center gap-3" aria-label="PIN">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={"h-4 w-4 rounded-full " + (i < pin.length ? "bg-brand" : "border-2 border-slate-400")}
              />
            ))}
          </div>
          {error && <p className="text-center text-red-600">{error}</p>}
          <div className="grid grid-cols-3 gap-3">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
              <button
                key={d}
                disabled={busy}
                onClick={() => press(d)}
                className="rounded-xl bg-white py-5 text-2xl shadow-sm active:bg-slate-200 disabled:opacity-50"
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
              className="rounded-xl bg-white py-5 text-2xl shadow-sm active:bg-slate-200 disabled:opacity-50"
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
