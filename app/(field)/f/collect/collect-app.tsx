"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Camera, CheckCircle2, ChevronRight, CloudOff, Home, Phone, RefreshCw, Search, Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, formatDateTime, formatINR, todayIST } from "@/lib/format";
import { t, type Locale, type StringKey } from "@/lib/i18n";
import {
  beatCache, compressPhoto, currentPosition, flushOutbox, newOpId, outbox, type OutboxEntry,
} from "@/lib/field/outbox";
import type { CollectPayload, FieldAccount, FieldCustomer, FieldOp } from "@/lib/field/types";

type Beat = { id: string; name: string; territory: string | null };
type Firm = { id: string; code: string; name: string };
type FormKind = "receipt" | "promise" | "visit";
type Flash = { kind: "ok" | "offline" | "error"; text: string } | null;

const LAST_BEAT = "sa-field-last-beat";
const rupees = (n: number) => formatINR(n).replace(/\.00$/, "");

export function CollectApp({ locale: initialLocale, beats, firms }: { locale: Locale; beats: Beat[]; firms: Firm[] }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const tr = useCallback((k: StringKey, v?: Record<string, string | number>) => t(locale, k, v), [locale]);
  const [beatId, setBeatId] = useState<string | null>(null);
  const [data, setData] = useState<CollectPayload | null>(null);
  const [stale, setStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [flash, setFlash] = useState<Flash>(null);

  const refreshOutbox = useCallback(() => setEntries(outbox.list()), []);

  const load = useCallback(async (id: string) => {
    const cached = beatCache.get(id);
    if (cached) setData(cached);
    setLoading(true);
    try {
      const res = await fetch(`/api/field/collect?beat=${id}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const fresh = (await res.json()) as CollectPayload;
      beatCache.set(fresh);
      setData(fresh);
      setStale(false);
    } catch {
      setStale(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const sync = useCallback(async () => {
    const r = await flushOutbox();
    refreshOutbox();
    if (r.sent > 0 && beatId) void load(beatId);
    return r;
  }, [beatId, load, refreshOutbox]);

  useEffect(() => {
    refreshOutbox();
    let last: string | null = null;
    try {
      last = localStorage.getItem(LAST_BEAT);
    } catch {}
    const only = beats.length === 1 ? beats[0]!.id : null;
    const start = beats.some((b) => b.id === last) ? last : only;
    if (start) {
      setBeatId(start);
      void load(start);
    }
    void flushOutbox().then(refreshOutbox);
    const onOnline = () => void flushOutbox().then(refreshOutbox);
    window.addEventListener("online", onOnline);
    const timer = setInterval(onOnline, 60_000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [beats, load, refreshOutbox]);

  const chooseBeat = (id: string) => {
    setBeatId(id);
    setCustomerId(null);
    setQuery("");
    try {
      localStorage.setItem(LAST_BEAT, id);
    } catch {}
    void load(id);
  };

  const toggleLang = () => {
    const next: Locale = locale === "mr" ? "en" : "mr";
    document.cookie = `lang=${next}; path=/; max-age=31536000; samesite=lax`;
    setLocale(next);
  };

  /** Save an entry: outbox first, show it on screen at once, then try to send. */
  const save = async (op: FieldOp, label: string, photo?: string) => {
    outbox.add({ op, photo, label, state: "pending" });
    refreshOutbox();
    if (data) {
      const next = applyLocally(data, op);
      setData(next);
      beatCache.set(next);
    }
    const before = new Set(outbox.list().map((e) => e.op.client_op_id));
    await sync();
    const stillPending = outbox.list().find((e) => e.op.client_op_id === op.client_op_id);
    if (!stillPending && before.has(op.client_op_id)) {
      const sent = outbox.sentToday().find((e) => e.op.client_op_id === op.client_op_id);
      setFlash({ kind: "ok", text: sent?.result?.receipt_no ? tr("saved", { no: sent.result.receipt_no }) : tr("savedPlain") });
    } else if (stillPending?.state === "rejected") {
      setFlash({ kind: "error", text: stillPending.error ?? "Rejected" });
    } else {
      setFlash({ kind: "offline", text: tr("savedOffline") });
    }
  };

  const customers = useMemo(() => (data?.beatId === beatId ? data.customers : []), [data, beatId]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
  }, [customers, query]);
  const customer = customers.find((c) => c.id === customerId) ?? null;
  const beat = beats.find((b) => b.id === beatId);

  const pending = entries.filter((e) => e.state === "pending");
  const rejected = entries.filter((e) => e.state === "rejected");
  const todayTotal = useMemo(() => {
    const server = data?.myToday ?? [];
    const seen = new Set(server.map((r) => r.receipt_no));
    const local = [...outbox.sentToday(), ...pending]
      .filter((e) => e.op.kind === "receipt" && !(e.result?.receipt_no && seen.has(e.result.receipt_no)))
      .filter((e) => new Date(e.op.happened_at).toDateString() === new Date().toDateString());
    const all = [...server.map((r) => ({ mode: r.mode, amount: r.amount })), ...local.map((e) => ({ mode: e.op.mode!, amount: Number(e.op.amount) }))];
    return {
      total: all.reduce((s, r) => s + r.amount, 0),
      cash: all.filter((r) => r.mode === "cash").reduce((s, r) => s + r.amount, 0),
      count: all.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, entries]);

  return (
    <div className="space-y-4 pb-24">
      <header className="flex items-center justify-between gap-2">
        {customer ? (
          <button onClick={() => setCustomerId(null)} className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <ArrowLeft className="h-5 w-5" /> {beat?.name}
          </button>
        ) : (
          <Link href="/f" className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
            <Home className="h-5 w-5" /> {tr("collect")}
          </Link>
        )}
        <button onClick={toggleLang} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
          {tr("language")}
        </button>
      </header>

      {flash && (
        <div
          role="status"
          onClick={() => setFlash(null)}
          className={cn(
            "flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm",
            flash.kind === "ok" && "bg-brand-50 text-brand-800",
            flash.kind === "offline" && "bg-amber-50 text-amber-800",
            flash.kind === "error" && "bg-red-50 text-red-700",
          )}
        >
          {flash.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : flash.kind === "offline" ? <CloudOff className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          {flash.text}
        </div>
      )}

      {(pending.length > 0 || rejected.length > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="text-amber-800">
              {pending.length > 0 && tr("pendingSync", { n: pending.length })}
              {pending.length > 0 && rejected.length > 0 && " · "}
              {rejected.length > 0 && <span className="text-red-700">{tr("failedSync", { n: rejected.length })}</span>}
            </span>
            {pending.length > 0 && (
              <button onClick={() => void sync()} className="flex items-center gap-1 rounded-lg bg-white px-2.5 py-1 font-medium text-amber-900 ring-1 ring-amber-200">
                <Send className="h-3.5 w-3.5" /> {tr("syncNow")}
              </button>
            )}
          </div>
          {rejected.map((e) => (
            <div key={e.op.client_op_id} className="mt-2 flex items-start justify-between gap-2 border-t border-amber-200 pt-2">
              <div>
                <div className="font-medium text-slate-800">{e.label}</div>
                <div className="text-xs text-red-700">{e.error}</div>
              </div>
              <button
                onClick={() => {
                  outbox.remove(e.op.client_op_id);
                  refreshOutbox();
                }}
                className="text-xs font-medium text-slate-600 underline"
              >
                {tr("remove")}
              </button>
            </div>
          ))}
        </div>
      )}

      {customer && beatId ? (
        <CustomerView customer={customer} firms={firms} tr={tr} onSave={save} />
      ) : (
        <>
          <div className="rounded-2xl bg-brand-800 p-4 text-white shadow-card">
            <div className="text-sm text-brand-100">{tr("myToday")}</div>
            <div className="mt-1 text-2xl font-semibold">{rupees(todayTotal.total)}</div>
            <div className="text-sm text-brand-100">
              {tr("cash")} {rupees(todayTotal.cash)} · {todayTotal.count}
            </div>
          </div>

          {beats.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-slate-600">{tr("noBeats")}</div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {beats.map((b) => (
                <button
                  key={b.id}
                  onClick={() => chooseBeat(b.id)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium",
                    b.id === beatId ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200",
                  )}
                >
                  {b.name}
                </button>
              ))}
            </div>
          )}

          {beatId && (
            <>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={tr("searchShop")}
                    className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-3 text-base"
                  />
                </div>
                <button
                  onClick={() => void load(beatId)}
                  className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600"
                  aria-label={tr("refresh")}
                >
                  <RefreshCw className={cn("h-5 w-5", loading && "animate-spin")} />
                </button>
              </div>
              {data && data.beatId === beatId && (
                <div className={cn("text-xs", stale ? "text-amber-700" : "text-slate-500")}>
                  {stale ? tr("offlineData", { time: formatDateTime(data.fetchedAt) }) : tr("updatedAt", { time: formatDateTime(data.fetchedAt) })}
                </div>
              )}

              {customers.length === 0 && !loading && data?.beatId === beatId && (
                <div className="rounded-2xl bg-white p-5 text-center text-slate-500">{tr("nothingDue")}</div>
              )}
              <ul className="space-y-2">
                {shown.map((c) => (
                  <li key={c.id}>
                    <CustomerCard customer={c} tr={tr} onOpen={() => setCustomerId(c.id)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function CustomerCard({ customer: c, tr, onOpen }: { customer: FieldCustomer; tr: Tr; onOpen: () => void }) {
  const due = net(c);
  const overdue = c.accounts.reduce((s, a) => s + a.overdue, 0);
  const oldest = c.accounts.map((a) => a.oldest_bill_date).filter(Boolean).sort()[0] ?? null;
  return (
    <button onClick={onOpen} className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-card ring-1 ring-slate-100">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold text-slate-900">{c.name}</span>
          {c.visited_today && <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-600" aria-label={tr("visitedToday")} />}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-500">
          {overdue > 0 && <span className="text-red-700">{tr("overdue")} {rupees(overdue)}</span>}
          {oldest && <span>{tr("daysAgo", { n: daysSince(oldest) })}</span>}
          {c.accounts.length > 1 && <span>{c.accounts.map((a) => a.firm_code).join(" + ")}</span>}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-semibold text-slate-900">{rupees(due)}</div>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
    </button>
  );
}

type Tr = (k: StringKey, v?: Record<string, string | number>) => string;

function CustomerView({
  customer: c, firms, tr, onSave,
}: {
  customer: FieldCustomer;
  firms: Firm[];
  tr: Tr;
  onSave: (op: FieldOp, label: string, photo?: string) => Promise<void>;
}) {
  const [form, setForm] = useState<{ kind: FormKind; outcome?: FieldOp["outcome"] } | null>(null);
  const [showBills, setShowBills] = useState<string | null>(null);
  const firmName = (id: string) => firms.find((f) => f.id === id)?.name ?? "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{c.name}</h1>
        {c.address && <p className="text-sm text-slate-500">{c.address}</p>}
        {(c.whatsapp || c.phone) && (
          <a href={`tel:${c.whatsapp ?? c.phone}`} className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
            <Phone className="h-4 w-4" /> {tr("call")} {c.whatsapp ?? c.phone}
          </a>
        )}
      </div>

      {c.accounts.map((a) => (
        <div key={a.firm_id} className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-100">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-500">{firmName(a.firm_id)}</span>
            <span className="text-2xl font-semibold text-slate-900">{rupees(Math.max(0, a.balance - a.erp_collected))}</span>
          </div>
          <dl className="mt-2 space-y-1 text-sm">
            {a.overdue > 0 && <Row label={tr("overdue")} value={rupees(a.overdue)} danger />}
            {a.oldest_bill_date && <Row label={tr("oldestBill")} value={`${formatDate(a.oldest_bill_date)} · ${tr("daysAgo", { n: daysSince(a.oldest_bill_date) })}`} />}
            <Row label={tr("lastPaid")} value={a.last_receipt_date ? formatDate(a.last_receipt_date) : tr("never")} />
            {a.erp_collected > 0 && <p className="text-xs text-slate-500">{tr("collectedSince", { amt: rupees(a.erp_collected) })}</p>}
            {a.promise_date && a.promise_amount && (
              <p className="text-xs font-medium text-amber-700">{tr("openPromise", { date: formatDate(a.promise_date), amt: rupees(a.promise_amount) })}</p>
            )}
          </dl>
          {(c.bills[a.firm_id]?.length ?? 0) > 0 && (
            <button onClick={() => setShowBills(showBills === a.firm_id ? null : a.firm_id)} className="mt-2 text-sm font-medium text-brand-700">
              {tr("bills")} ({c.bills[a.firm_id]!.length})
            </button>
          )}
          {showBills === a.firm_id && (
            <ul className="mt-2 divide-y divide-slate-100 text-sm">
              {c.bills[a.firm_id]!.map((b) => (
                <li key={b.bill_key} className="flex justify-between gap-2 py-1.5">
                  <span className="text-slate-600">
                    {b.kind === "older" ? tr("olderDues") : `${b.bill_no ?? "—"} · ${b.bill_date ? formatDate(b.bill_date) : ""}`}
                  </span>
                  <span className={cn("font-medium", b.overdue ? "text-red-700" : "text-slate-900")}>{rupees(b.pending)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {form ? (
        <EntryForm
          kind={form.kind}
          outcome={form.outcome}
          customer={c}
          firms={firms}
          tr={tr}
          onCancel={() => setForm(null)}
          onSave={async (op, label, photo) => {
            await onSave(op, label, photo);
            setForm(null);
          }}
        />
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <BigButton className="col-span-2 bg-brand-700 text-white" onClick={() => setForm({ kind: "receipt" })}>
            {tr("takePayment")}
          </BigButton>
          <BigButton className="col-span-2 bg-white text-slate-800 ring-1 ring-slate-200" onClick={() => setForm({ kind: "promise" })}>
            {tr("promise")}
          </BigButton>
          <BigButton className="bg-white text-slate-700 ring-1 ring-slate-200" onClick={() => setForm({ kind: "visit", outcome: "not_available" })}>
            {tr("notAvailable")}
          </BigButton>
          <BigButton className="bg-white text-slate-700 ring-1 ring-slate-200" onClick={() => setForm({ kind: "visit", outcome: "refused" })}>
            {tr("refused")}
          </BigButton>
          <BigButton className="col-span-2 bg-white text-slate-700 ring-1 ring-slate-200" onClick={() => setForm({ kind: "visit", outcome: "closed" })}>
            {tr("shopClosed")}
          </BigButton>
        </div>
      )}
    </div>
  );
}

function EntryForm({
  kind, outcome, customer: c, firms, tr, onCancel, onSave,
}: {
  kind: FormKind;
  outcome?: FieldOp["outcome"];
  customer: FieldCustomer;
  firms: Firm[];
  tr: Tr;
  onCancel: () => void;
  onSave: (op: FieldOp, label: string, photo?: string) => Promise<void>;
}) {
  const [firmId, setFirmId] = useState(c.accounts[0]?.firm_id ?? "");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<"cash" | "upi" | "cheque">("cash");
  const [upiRef, setUpiRef] = useState("");
  const [chequeNo, setChequeNo] = useState("");
  const [chequeDate, setChequeDate] = useState(todayIST());
  const [chequeBank, setChequeBank] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [promiseDate, setPromiseDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account: FieldAccount | undefined = c.accounts.find((a) => a.firm_id === firmId);

  const submit = async () => {
    setError(null);
    const amt = Number(amount);
    if (kind !== "visit" && !(amt > 0)) return setError(tr("enterAmount"));
    if (kind === "receipt" && mode === "upi" && !upiRef.trim()) return setError(tr("fillUpi"));
    if (kind === "receipt" && mode === "cheque" && (!chequeNo.trim() || !chequeDate || !chequeBank.trim() || !photo)) return setError(tr("fillCheque"));
    if (kind === "promise" && !promiseDate) return setError(tr("pickDate"));
    if (kind === "receipt" && account && amt > Math.max(0, account.balance - account.erp_collected) && !window.confirm(tr("moreThanDue"))) return;

    setBusy(true);
    const pos = await currentPosition();
    const op: FieldOp = {
      client_op_id: newOpId(),
      kind,
      customer_id: c.id,
      happened_at: new Date().toISOString(),
      ...(kind !== "visit" || c.accounts.length === 1 ? { firm_id: firmId } : {}),
      ...(kind !== "visit" ? { amount: amt.toFixed(2) } : {}),
      ...(kind === "receipt" ? { mode } : {}),
      ...(kind === "receipt" && mode === "upi" ? { upi_ref: upiRef.trim() } : {}),
      ...(kind === "receipt" && mode === "cheque" ? { cheque_no: chequeNo.trim(), cheque_date: chequeDate, cheque_bank: chequeBank.trim() } : {}),
      ...(kind === "promise" ? { promise_date: promiseDate } : {}),
      ...(kind === "visit" ? { outcome } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...pos,
    };
    const label =
      kind === "receipt" ? `${c.name} · ${rupees(amt)} ${tr(mode)}` : kind === "promise" ? `${c.name} · ${tr("promise")} ${rupees(amt)}` : `${c.name} · ${tr(outcomeKey(outcome))}`;
    await onSave(op, label, kind === "receipt" && mode === "cheque" ? photo ?? undefined : undefined);
    setBusy(false);
  };

  const title = kind === "receipt" ? tr("takePayment") : kind === "promise" ? tr("promise") : tr(outcomeKey(outcome));
  return (
    <div className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">{title}</h2>

      {kind !== "visit" && c.accounts.length > 1 && (
        <Segmented
          value={firmId}
          onChange={setFirmId}
          options={c.accounts.map((a) => ({ value: a.firm_id, label: firms.find((f) => f.id === a.firm_id)?.name ?? a.firm_code }))}
        />
      )}

      {kind !== "visit" && (
        <label className="block">
          <span className="text-sm font-medium text-slate-600">{tr("amount")}</span>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            className="mt-1 h-14 w-full rounded-xl border border-slate-300 px-3 text-2xl font-semibold"
            autoFocus
          />
        </label>
      )}

      {kind === "receipt" && (
        <>
          <span className="text-sm font-medium text-slate-600">{tr("mode")}</span>
          <Segmented
            value={mode}
            onChange={(v) => setMode(v as typeof mode)}
            options={[{ value: "cash", label: tr("cash") }, { value: "upi", label: tr("upi") }, { value: "cheque", label: tr("cheque") }]}
          />
          {mode === "upi" && <Field label={tr("upiRef")} value={upiRef} onChange={setUpiRef} />}
          {mode === "cheque" && (
            <>
              <Field label={tr("chequeNo")} value={chequeNo} onChange={setChequeNo} inputMode="numeric" />
              <Field label={tr("chequeDate")} value={chequeDate} onChange={setChequeDate} type="date" />
              <Field label={tr("chequeBank")} value={chequeBank} onChange={setChequeBank} />
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm font-medium text-slate-700">
                <Camera className="h-5 w-5" /> {photo ? tr("retakePhoto") : tr("chequePhoto")}
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setPhoto(await compressPhoto(f));
                  }}
                />
              </label>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {photo && <img src={photo} alt="" className="max-h-48 w-full rounded-xl object-contain" />}
            </>
          )}
        </>
      )}

      {kind === "promise" && <Field label={tr("promiseDate")} value={promiseDate} onChange={setPromiseDate} type="date" min={todayIST()} />}

      <Field label={tr("note")} value={note} onChange={setNote} />
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <BigButton className="bg-white text-slate-700 ring-1 ring-slate-200" onClick={onCancel} disabled={busy}>
          {tr("cancel")}
        </BigButton>
        <BigButton className="bg-brand-700 text-white" onClick={() => void submit()} disabled={busy}>
          {tr("save")}
        </BigButton>
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = "text", inputMode, min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  min?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      <input
        type={type}
        inputMode={inputMode}
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3 text-base"
      />
    </label>
  );
}

function Segmented({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="flex rounded-xl bg-slate-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn("h-11 flex-1 rounded-lg text-sm font-semibold", o.value === value ? "bg-white text-slate-900 shadow" : "text-slate-500")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function BigButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={cn("h-14 rounded-xl text-base font-semibold disabled:opacity-50", className)} {...props} />;
}

function Row({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className={cn("font-medium", danger ? "text-red-700" : "text-slate-800")}>{value}</dd>
    </div>
  );
}

function outcomeKey(o: FieldOp["outcome"]): StringKey {
  return o === "refused" ? "refused" : o === "closed" ? "shopClosed" : "notAvailable";
}

function net(c: FieldCustomer) {
  return c.accounts.reduce((s, a) => s + Math.max(0, a.balance - a.erp_collected), 0);
}

function daysSince(isoDate: string) {
  const ms = new Date(todayIST() + "T00:00:00Z").getTime() - new Date(isoDate + "T00:00:00Z").getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** Reflect an entry on screen straight away, before the server confirms it. */
function applyLocally(p: CollectPayload, op: FieldOp): CollectPayload {
  return {
    ...p,
    customers: p.customers.map((c) => {
      if (c.id !== op.customer_id) return c;
      return {
        ...c,
        visited_today: op.kind === "receipt" ? "paid" : op.kind === "promise" ? "promised" : op.outcome ?? c.visited_today,
        accounts: c.accounts.map((a) =>
          a.firm_id !== op.firm_id
            ? a
            : op.kind === "receipt"
              ? { ...a, erp_collected: a.erp_collected + Number(op.amount) }
              : op.kind === "promise"
                ? { ...a, promise_date: op.promise_date ?? null, promise_amount: Number(op.amount) }
                : a,
        ),
      };
    }),
  };
}
