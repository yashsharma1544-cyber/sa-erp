"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { markAlertRead } from "./home-actions";

export type AlertRow = { id: string; title: string; body: string | null; created_at: string };

/** Owner alerts (bounced cheques for now). */
export function AlertsCard({ alerts }: { alerts: AlertRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (alerts.length === 0) return null;
  return (
    <Card className="border-red-200">
      <CardHeader title={`Alerts (${alerts.length})`} description="Mark each one read once it's handled." />
      <ul className="divide-y divide-slate-100">
        {alerts.map((a) => (
          <li key={a.id} className="flex items-start gap-3 px-5 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <div className="flex-1">
              <div className="font-medium text-slate-900">{a.title}</div>
              {a.body && <div className="text-slate-600">{a.body}</div>}
              <div className="text-xs text-slate-400">{formatDateTime(a.created_at)}</div>
            </div>
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markAlertRead(a.id);
                  router.refresh();
                })
              }
              className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Mark read"
            >
              <Check className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
