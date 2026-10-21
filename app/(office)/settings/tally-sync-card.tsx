"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { formatDate, formatDateTime, formatNumber } from "@/lib/format";
import { Card, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/field";
import { syncTallyNow } from "./actions";

export type TallySyncStatus = {
  connected: boolean;
  started_at: string | null;
  finished_at: string | null;
  status: "running" | "ok" | "failed" | null;
  full_pull: boolean | null;
  counts: Record<string, number> | null;
  error: string | null;
  last_ok_at: string | null;
  vouchers: number;
  latest_voucher_date: string | null;
};

const tone = { ok: "green", failed: "red", running: "amber" } as const;
const label = { ok: "OK", failed: "Failed", running: "Running" } as const;

export function TallySyncCard({ sync, isOwner }: { sync: TallySyncStatus | null; isOwner: boolean }) {
  const [flash, setFlash] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();

  const syncNow = () =>
    start(async () => {
      const r = await syncTallyNow();
      setFlash(r.error ? { kind: "error", text: r.error } : { kind: "success", text: r.ok ?? "Done" });
    });

  return (
    <Card>
      <CardHeader
        title="Tally sync"
        description="Read-only copy of TallySync: vouchers, bill lines, allocations, outstandings and ledger balances."
        action={
          isOwner &&
          sync?.connected && (
            <Button size="sm" variant="secondary" disabled={pending} onClick={syncNow}>
              <RefreshCw className={"h-4 w-4" + (pending ? " animate-spin" : "")} /> Sync now
            </Button>
          )
        }
      />
      <div className="space-y-3 px-5 py-4 text-sm">
        {flash && <Alert kind={flash.kind}>{flash.text}</Alert>}
        {!sync?.connected ? (
          <p className="text-amber-700">Not connected yet. See “Connect TallySync” in the runbook.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-y-1.5 sm:grid-cols-4">
            <dt className="text-slate-500">Last run</dt>
            <dd className="flex items-center gap-2">
              {sync.status ? <Badge tone={tone[sync.status]}>{label[sync.status]}</Badge> : "—"}
              {sync.started_at && <span className="text-slate-600">{formatDateTime(sync.started_at)}</span>}
            </dd>
            <dt className="text-slate-500">Last good sync</dt>
            <dd>{sync.last_ok_at ? formatDateTime(sync.last_ok_at) : "never"}</dd>
            <dt className="text-slate-500">Vouchers</dt>
            <dd className="num">{formatNumber(sync.vouchers)}</dd>
            <dt className="text-slate-500">Latest voucher</dt>
            <dd>{sync.latest_voucher_date ? formatDate(sync.latest_voucher_date) : "—"}</dd>
          </dl>
        )}
        {sync?.status === "failed" && sync.error && <p className="text-red-700">{sync.error}</p>}
      </div>
    </Card>
  );
}
