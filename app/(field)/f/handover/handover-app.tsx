"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatINR } from "@/lib/format";
import { t, type Locale, type StringKey } from "@/lib/i18n";
import { flushOutbox, newOpId, outbox } from "@/lib/field/outbox";
import { handOver } from "./actions";

export type MyReceipt = { id: string; receipt_no: string; amount: string; collected_at: string; customer: { name: string } | null };
export type MyHandover = {
  id: string;
  handover_no: string;
  handed_at: string;
  expected_cash: string;
  counted_total: string | null;
  variance: string | null;
  status: "submitted" | "accepted";
};

const DENOMS = [500, 200, 100, 50, 20, 10] as const;
const rupees = (n: number) => formatINR(n).replace(/\.00$/, "");

export function HandoverApp({ locale, receipts, handovers }: { locale: Locale; receipts: MyReceipt[]; handovers: MyHandover[] }) {
  const tr = (k: StringKey, v?: Record<string, string | number>) => t(locale, k, v);
  const router = useRouter();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendingOps, setPendingOps] = useState(0);
  const [opId] = useState(() => newOpId());
  const [busy, start] = useTransition();

  // Receipts still on the phone must reach the server first, or they'd be left out.
  useEffect(() => {
    void flushOutbox().then(() => {
      setPendingOps(outbox.list().filter((e) => e.state === "pending" && e.op.kind === "receipt").length);
      router.refresh();
    });
  }, [router]);

  const expected = receipts.reduce((s, r) => s + Number(r.amount), 0);
  const declared: Record<string, number> = {};
  for (const [k, v] of Object.entries(counts)) if (v !== "") declared[k] = Number(v);
  const total = DENOMS.reduce((s, d) => s + (declared[String(d)] ?? 0) * d, 0) + (declared.coins ?? 0);
  const diff = total - expected;

  const submit = () =>
    start(async () => {
      if (!navigator.onLine) return setMsg({ ok: false, text: tr("needNetwork") });
      const r = await handOver(opId, declared, note);
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: tr("handoverDone", { no: r.handoverNo ?? "" }) });
        setCounts({});
        setNote("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-4 pb-16">
      <Link href="/f" className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
        <ArrowLeft className="h-5 w-5" /> {tr("handover")}
      </Link>

      {msg && (
        <div className={cn("flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm", msg.ok ? "bg-brand-50 text-brand-800" : "bg-red-50 text-red-700")}>
          {msg.ok && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {msg.text}
        </div>
      )}

      <div className="rounded-2xl bg-brand-800 p-4 text-white shadow-card">
        <div className="text-sm text-brand-100">{tr("cashInHand")}</div>
        <div className="mt-1 text-3xl font-semibold">{rupees(expected)}</div>
        <div className="text-sm text-brand-100">{tr("receiptsCount", { n: receipts.length })}</div>
      </div>

      {pendingOps > 0 && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{tr("pendingFirst")}</div>}

      {receipts.length === 0 ? (
        <div className="rounded-2xl bg-white p-5 text-center text-slate-500">{tr("noCashInHand")}</div>
      ) : (
        <div className="space-y-3 rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-100">
          <h2 className="font-semibold">{tr("countYourNotes")}</h2>
          {DENOMS.map((d) => (
            <div key={d} className="flex items-center gap-3">
              <span className="w-14 font-medium text-slate-700">₹{d}</span>
              <span className="text-slate-400">×</span>
              <input
                inputMode="numeric"
                value={counts[String(d)] ?? ""}
                onChange={(e) => setCounts({ ...counts, [String(d)]: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                className="h-12 w-24 rounded-xl border border-slate-300 px-3 text-lg"
              />
              <span className="flex-1 text-right text-slate-600">{rupees((declared[String(d)] ?? 0) * d)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <span className="w-14 font-medium text-slate-700">{tr("coins")}</span>
            <span className="w-3" />
            <input
              inputMode="decimal"
              value={counts.coins ?? ""}
              onChange={(e) => setCounts({ ...counts, coins: e.target.value.replace(/[^\d.]/g, "").slice(0, 9) })}
              className="h-12 w-24 rounded-xl border border-slate-300 px-3 text-lg"
            />
          </div>
          <dl className="space-y-1 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between">
              <dt>{tr("yourCount")}</dt>
              <dd className="font-semibold">{rupees(total)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>{tr("receiptsSay")}</dt>
              <dd>{rupees(expected)}</dd>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-1">
              <dt>{tr("difference")}</dt>
              <dd className={cn("font-semibold", diff < 0 ? "text-red-700" : diff > 0 ? "text-amber-700" : "text-brand-700")}>
                {diff === 0 ? "✓" : diff < 0 ? tr("short", { amt: rupees(-diff) }) : tr("excess", { amt: rupees(diff) })}
              </dd>
            </div>
          </dl>
          <label className="block">
            <span className="text-sm font-medium text-slate-600">{tr("note")}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-12 w-full rounded-xl border border-slate-300 px-3" />
          </label>
          <button
            onClick={submit}
            disabled={busy || pendingOps > 0 || total === 0}
            className="h-14 w-full rounded-xl bg-brand-700 text-base font-semibold text-white disabled:opacity-50"
          >
            {tr("handOverNow")} · {rupees(total)}
          </button>
          <ul className="divide-y divide-slate-100 text-sm">
            {receipts.map((r) => (
              <li key={r.id} className="flex justify-between py-1.5">
                <span className="text-slate-600">
                  {r.customer?.name} · {r.receipt_no}
                </span>
                <span>{rupees(Number(r.amount))}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {handovers.length > 0 && (
        <div className="rounded-2xl bg-white p-4 shadow-card ring-1 ring-slate-100">
          <h2 className="mb-2 font-semibold">{tr("myHandovers")}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {handovers.map((h) => {
              const v = Number(h.variance ?? 0);
              return (
                <li key={h.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{h.handover_no}</span>
                    <span className="block text-xs text-slate-500">{formatDateTime(h.handed_at)}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-medium">{rupees(Number(h.expected_cash))}</span>
                    <span className={cn("text-xs", h.status === "submitted" ? "text-amber-700" : v < 0 ? "text-red-700" : "text-slate-500")}>
                      {h.status === "submitted"
                        ? tr("waitingCount")
                        : v === 0
                          ? tr("counted")
                          : v < 0
                            ? tr("short", { amt: rupees(-v) })
                            : tr("excess", { amt: rupees(v) })}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
