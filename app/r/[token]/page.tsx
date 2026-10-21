import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate, formatINR } from "@/lib/format";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "पावती · Receipt", robots: { index: false, follow: false } };

type Receipt = {
  receipt_no: string;
  collected_on: string;
  amount: string;
  mode: "cash" | "upi" | "cheque" | "bank";
  cheque_no: string | null;
  cheque_date: string | null;
  cheque_bank: string | null;
  upi_ref: string | null;
  status: string;
  customer_name: string;
  firm_name: string;
  firm_address: string | null;
  firm_gstin: string | null;
  collector_name: string;
};

const MODE: Record<Receipt["mode"], string> = { cash: "रोख (Cash)", upi: "UPI", cheque: "चेक (Cheque)", bank: "बँक (Bank)" };

// The customer's receipt, reached only through the random link in their WhatsApp message.
export default async function PublicReceipt({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();
  const { data } = await createAdminClient().rpc("receipt_by_token", { p_token: token }).maybeSingle();
  const r = data as Receipt | null;
  if (!r) notFound();
  const void_ = r.status === "cancelled" || r.status === "bounced";

  return (
    <main className="mx-auto min-h-screen max-w-md bg-white px-5 py-8 print:py-0">
      <div className="rounded-2xl border border-slate-200 p-6 shadow-card print:border-0 print:shadow-none">
        <div className="border-b border-slate-100 pb-4 text-center">
          <h1 className="text-xl font-semibold text-slate-900">{r.firm_name}</h1>
          {r.firm_address && <p className="text-sm text-slate-500">{r.firm_address}</p>}
          {r.firm_gstin && <p className="text-xs text-slate-500">GSTIN {r.firm_gstin}</p>}
          <p className="mt-3 text-sm font-medium uppercase tracking-wide text-brand-700">पावती · Payment receipt</p>
        </div>

        {void_ && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-center text-sm font-medium text-red-700">
            {r.status === "bounced" ? "हा चेक परत आला (बाऊन्स) — ही पावती रद्द आहे." : "ही पावती रद्द आहे."}
          </div>
        )}

        <dl className="mt-4 space-y-2.5 text-sm">
          <Row label="पावती क्र. · Receipt no." value={r.receipt_no} />
          <Row label="दिनांक · Date" value={formatDate(r.collected_on)} />
          <Row label="ग्राहक · Customer" value={r.customer_name} />
          <Row label="प्रकार · Mode" value={MODE[r.mode]} />
          {r.mode === "upi" && r.upi_ref && <Row label="UPI संदर्भ · Ref" value={r.upi_ref} />}
          {r.mode === "cheque" && (
            <>
              <Row label="चेक क्र. · Cheque no." value={r.cheque_no ?? "—"} />
              <Row label="बँक · Bank" value={r.cheque_bank ?? "—"} />
              <Row label="चेक दिनांक · Cheque date" value={r.cheque_date ? formatDate(r.cheque_date) : "—"} />
            </>
          )}
          <Row label="घेणारे · Collected by" value={r.collector_name} />
        </dl>

        <div className="mt-5 rounded-xl bg-brand-50 p-4 text-center">
          <div className="text-sm text-brand-800">रक्कम · Amount</div>
          <div className={`text-3xl font-semibold ${void_ ? "text-slate-400 line-through" : "text-brand-900"}`}>{formatINR(r.amount)}</div>
        </div>

        {r.mode === "cheque" && !void_ && (
          <p className="mt-3 text-center text-xs text-slate-500">चेक वटल्यानंतरच भरणा पूर्ण मानला जाईल. · Subject to the cheque being honoured.</p>
        )}
        <p className="mt-4 text-center text-xs text-slate-400">ही संगणकाद्वारे बनवलेली पावती आहे, सहीची आवश्यकता नाही.</p>
      </div>
      <PrintButton />
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}
