"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateTime, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Input } from "@/components/ui/field";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { retryMessage, saveRule, saveTemplate } from "./actions";

export type TemplateRow = {
  id: string;
  key: "receipt" | "reminder" | "reminder_firm" | "promise_due";
  wati_template_name: string | null;
  params: string[];
  body_mr: string;
  approved: boolean;
  active: boolean;
};
export type RuleRow = { id: string; min_overdue_days: number; template_key: string; repeat_every_days: number; active: boolean };
export type MessageRow = {
  id: string;
  template_key: string;
  to_number: string;
  status: "queued" | "sent" | "failed" | "skipped";
  error: string | null;
  attempts: number;
  created_at: string;
  sent_at: string | null;
  customer: { name: string } | null;
};

const LABEL: Record<TemplateRow["key"], string> = {
  receipt: "Receipt (sent when a payment is recorded)",
  reminder: "Overdue reminder",
  reminder_firm: "Firm overdue reminder (last step)",
  promise_due: "Promise day reminder",
};
const STATUS_TONE = { queued: "amber", sent: "green", failed: "red", skipped: "neutral" } as const;

export function WhatsAppClient({
  templates, rules, messages, configured, canEdit,
}: {
  templates: TemplateRow[];
  rules: RuleRow[];
  messages: MessageRow[];
  configured: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"messages" | "setup">(configured ? "messages" : "setup");
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ error?: string; ok?: string }>) =>
    start(async () => {
      const r = await fn();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
      if (!r.error) router.refresh();
    });

  const counts = { queued: 0, sent: 0, failed: 0, skipped: 0 };
  for (const m of messages) counts[m.status]++;

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        description="Receipts, overdue reminders and promise reminders to customers in Marathi through WATi. Nothing goes out until a template is approved and switched on."
      />
      {!configured && (
        <Alert kind="info">
          WATi isn&apos;t connected yet. Add WATI_API_ENDPOINT and WATI_API_TOKEN in Vercel (see the runbook). Messages wait in the queue until then.
        </Alert>
      )}
      {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}

      <div className="flex gap-2">
        {(["messages", "setup"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn("rounded-full px-3 py-1 text-sm", t === tab ? "bg-brand-700 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200")}
          >
            {t === "messages" ? "Messages" : "Templates & reminders"}
          </button>
        ))}
      </div>

      {tab === "messages" && (
        <Card>
          <CardHeader
            title="Last 300 messages"
            description={`${formatNumber(counts.sent)} sent · ${formatNumber(counts.queued)} waiting · ${formatNumber(counts.failed)} failed · ${formatNumber(counts.skipped)} skipped`}
          />
          <Table>
            <THead>
              <tr>
                <TH>Customer</TH>
                <TH>Message</TH>
                <TH>Status</TH>
                <TH>When</TH>
                <TH />
              </tr>
            </THead>
            <tbody>
              {messages.length === 0 && <EmptyRow colSpan={5}>No messages yet.</EmptyRow>}
              {messages.map((m) => (
                <TR key={m.id}>
                  <TD>
                    <div className="font-medium">{m.customer?.name ?? "—"}</div>
                    <div className="num text-xs text-slate-500">+{m.to_number}</div>
                  </TD>
                  <TD className="text-sm">{LABEL[m.template_key as TemplateRow["key"]]?.split(" (")[0] ?? m.template_key}</TD>
                  <TD>
                    <Badge tone={STATUS_TONE[m.status]}>{m.status}</Badge>
                    {m.error && <div className="mt-1 max-w-xs text-xs text-red-700">{m.error}</div>}
                  </TD>
                  <TD className="whitespace-nowrap text-sm">{formatDateTime(m.sent_at ?? m.created_at)}</TD>
                  <TD className="text-right">
                    {(m.status === "failed" || m.status === "skipped") && (
                      <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => retryMessage(m.id))}>
                        <RotateCw className="h-4 w-4" /> Retry
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === "setup" && (
        <>
          <Card>
            <CardHeader
              title="Templates"
              description="Create each one in WATi (Marathi, Utility category) with exactly this text, wait for WhatsApp to approve it, then enter its WATi name here and switch it on."
            />
            <div className="divide-y divide-slate-100">
              {templates.map((t) => (
                <TemplateEditor key={t.id} t={t} canEdit={canEdit} pending={pending} onSave={(v) => run(() => saveTemplate(v))} />
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Reminder ladder"
              description="Every morning at 9, customers with bills overdue by at least these days get the reminder, at most once per repeat period. Skipped: bad debt / ignore, opted out, an open promise, or a payment in the last 7 days."
            />
            <div className="divide-y divide-slate-100">
              {rules.map((r) => (
                <RuleEditor key={r.id} r={r} canEdit={canEdit} pending={pending} onSave={(v) => run(() => saveRule(v))} />
              ))}
            </div>
            <p className="px-5 pb-4 text-xs text-amber-700">
              Overdue counts from credit days. Until credit days are set per customer, every bill past its date counts, so keep the ladder off until then.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}

function TemplateEditor({
  t, canEdit, pending, onSave,
}: {
  t: TemplateRow;
  canEdit: boolean;
  pending: boolean;
  onSave: (v: { id: string; watiTemplateName: string; approved: boolean; active: boolean }) => void;
}) {
  const [name, setName] = useState(t.wati_template_name ?? "");
  const [approved, setApproved] = useState(t.approved);
  const [active, setActive] = useState(t.active);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium">{LABEL[t.key]}</div>
        {t.active ? <Badge tone="green">On</Badge> : t.approved ? <Badge tone="amber">Approved, off</Badge> : <Badge>Not approved yet</Badge>}
      </div>
      <div className="relative rounded-lg bg-slate-50 p-3 pr-10 text-sm leading-relaxed text-slate-800">
        {t.body_mr}
        <button
          onClick={() => {
            void navigator.clipboard.writeText(t.body_mr);
            setCopied(true);
          }}
          className="absolute right-2 top-2 rounded p-1 text-slate-500 hover:bg-slate-200"
          aria-label="Copy text"
        >
          <Copy className="h-4 w-4" />
        </button>
        {copied && <span className="absolute right-9 top-2.5 text-xs text-brand-700">Copied</span>}
      </div>
      <div className="text-xs text-slate-500">
        {t.params.map((p, i) => (
          <span key={p} className="mr-3">
            {`{{${i + 1}}}`} = {p.replace(/_/g, " ")}
          </span>
        ))}
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Input className="w-64" placeholder="Template name in WATi" value={name} onChange={(e) => setName(e.target.value)} />
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> Approved
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Switched on
          </label>
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => onSave({ id: t.id, watiTemplateName: name, approved, active })}>
            Save
          </Button>
        </div>
      )}
    </div>
  );
}

function RuleEditor({
  r, canEdit, pending, onSave,
}: {
  r: RuleRow;
  canEdit: boolean;
  pending: boolean;
  onSave: (v: { id: string; minOverdueDays: number; repeatEveryDays: number; active: boolean }) => void;
}) {
  const [days, setDays] = useState(String(r.min_overdue_days));
  const [repeat, setRepeat] = useState(String(r.repeat_every_days));
  const [active, setActive] = useState(r.active);
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <span>Overdue</span>
      <Input className="w-20" inputMode="numeric" disabled={!canEdit} value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
      <span>days or more → {LABEL[r.template_key as TemplateRow["key"]]?.toLowerCase() ?? r.template_key}, every</span>
      <Input className="w-16" inputMode="numeric" disabled={!canEdit} value={repeat} onChange={(e) => setRepeat(e.target.value.replace(/\D/g, ""))} />
      <span>days</span>
      <label className="flex items-center gap-1.5">
        <input type="checkbox" disabled={!canEdit} checked={active} onChange={(e) => setActive(e.target.checked)} /> On
      </label>
      {canEdit && (
        <Button size="sm" variant="secondary" disabled={pending} onClick={() => onSave({ id: r.id, minOverdueDays: Number(days), repeatEveryDays: Number(repeat), active })}>
          Save
        </Button>
      )}
    </div>
  );
}
