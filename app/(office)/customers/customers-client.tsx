"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { formatDate, formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CustomerForm, blankCustomer } from "./customer-form";
import { saveCustomer, setCustomersBeat, type CustomerInput } from "./actions";

export type CustomerRow = {
  id: string;
  name: string;
  customer_type: string;
  beat_id: string | null;
  whatsapp: string | null;
  town: string | null;
  status: "active" | "bad_debt" | "ignore";
  accounts: { firm_id: string; credit_limit: string; credit_days: number }[];
  last_sale_date: string | null;
};

type Beat = { id: string; name: string; territory_name: string };
type Firm = { id: string; code: string };

export const statusBadge = {
  active: <Badge tone="green">Active</Badge>,
  bad_debt: <Badge tone="red">Bad debt</Badge>,
  ignore: <Badge>Ignore</Badge>,
};

const PAGE = 100;

export function CustomersClient({
  customers,
  beats,
  firms,
  canEdit,
}: {
  customers: CustomerRow[];
  beats: Beat[];
  firms: Firm[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [beat, setBeat] = useState("all");
  const [status, setStatus] = useState("all");
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState<CustomerInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBeat, setBulkBeat] = useState("");

  const beatName = (id: string | null) => beats.find((b) => b.id === id)?.name ?? "No beat";
  const firmCode = (id: string) => firms.find((f) => f.id === id)?.code ?? "?";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = customers.filter(
      (c) =>
        (beat === "all" || (beat === "none" ? !c.beat_id : c.beat_id === beat)) &&
        (status === "all" || c.status === status) &&
        (!needle || `${c.name} ${c.town ?? ""} ${c.whatsapp ?? ""}`.toLowerCase().includes(needle)),
    );
    // Without a beat, the shops that bought most recently come first.
    return beat === "none" ? [...list].sort((a, b) => (b.last_sale_date ?? "").localeCompare(a.last_sale_date ?? "")) : list;
  }, [customers, q, beat, status]);

  const visible = shown.slice(0, limit);
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const applyBeat = () =>
    start(async () => {
      setError(null);
      setNotice(null);
      const res = await setCustomersBeat({ ids: [...selected], beatId: bulkBeat === "none" ? null : bulkBeat });
      if (res.error) setError(res.error);
      else {
        setNotice(res.ok ?? "Done");
        setSelected(new Set());
        router.refresh();
      }
    });

  const counts = {
    active: customers.filter((c) => c.status === "active").length,
    bad_debt: customers.filter((c) => c.status === "bad_debt").length,
    ignore: customers.filter((c) => c.status === "ignore").length,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers"
        description={`${formatNumber(customers.length)} customers · ${formatNumber(counts.active)} active · ${formatNumber(counts.bad_debt)} bad debt · ${formatNumber(counts.ignore)} ignore`}
        actions={
          canEdit && (
            <Button onClick={() => setAdding(blankCustomer())}>
              <Plus className="h-4 w-4" /> Customer
            </Button>
          )
        }
      />
      {error && <Alert kind="error">{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <div className="min-w-[220px] flex-1">
            <SearchInput placeholder="Search name, town or WhatsApp" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Select value={beat} onChange={(e) => setBeat(e.target.value)} className="w-56">
            <option value="all">All beats</option>
            <option value="none">No beat</option>
            {beats.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.territory_name})
              </option>
            ))}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="bad_debt">Bad debt</option>
            <option value="ignore">Ignore</option>
          </Select>
        </div>
        {canEdit && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 bg-brand-50/60 px-4 py-3 text-sm">
            <span className="font-medium text-slate-800">{formatNumber(selected.size)} selected</span>
            <Select value={bulkBeat} onChange={(e) => setBulkBeat(e.target.value)} className="w-64">
              <option value="">Choose a beat…</option>
              {beats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.territory_name})
                </option>
              ))}
              <option value="none">No beat</option>
            </Select>
            <Button size="sm" disabled={!bulkBeat || pending} onClick={applyBeat}>
              Set beat
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        )}
        <Table>
          <THead>
            <tr>
              {canEdit && (
                <TH className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all shown"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        for (const c of visible) {
                          if (allVisibleSelected) next.delete(c.id);
                          else next.add(c.id);
                        }
                        return next;
                      })
                    }
                  />
                </TH>
              )}
              <TH>Customer</TH>
              <TH>Beat</TH>
              <TH>Last bill</TH>
              <TH>WhatsApp</TH>
              <TH>Firm accounts · credit</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {visible.map((c) => (
              <TR key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/customers/${c.id}`)}>
                {canEdit && (
                  <TD onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} />
                  </TD>
                )}
                <TD>
                  <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {c.name}
                  </Link>
                  <div className="text-xs capitalize text-slate-500">
                    {c.customer_type}
                    {c.town ? ` · ${c.town}` : ""}
                  </div>
                </TD>
                <TD className={c.beat_id ? "" : "text-amber-700"}>{beatName(c.beat_id)}</TD>
                <TD className="whitespace-nowrap text-sm">{c.last_sale_date ? formatDate(c.last_sale_date) : <span className="text-slate-400">—</span>}</TD>
                <TD className="num">{c.whatsapp ?? "—"}</TD>
                <TD>
                  <div className="flex flex-wrap gap-1">
                    {c.accounts.map((a) => (
                      <Badge key={a.firm_id} tone="blue">
                        {firmCode(a.firm_id)} · {Number(a.credit_limit) > 0 ? `${formatINR(a.credit_limit)} / ${a.credit_days}d` : "no limit set"}
                      </Badge>
                    ))}
                    {c.accounts.length === 0 && <span className="text-xs text-slate-400">None</span>}
                  </div>
                </TD>
                <TD>{statusBadge[c.status]}</TD>
              </TR>
            ))}
            {shown.length === 0 && (
              <EmptyRow colSpan={canEdit ? 7 : 6}>
                {customers.length === 0 ? "No customers yet. They are imported from Tally in the next step." : "No customers match."}
              </EmptyRow>
            )}
          </tbody>
        </Table>
        {shown.length > limit && (
          <div className="border-t border-slate-100 p-3 text-center">
            <Button variant="ghost" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({formatNumber(shown.length - limit)} left)
            </Button>
          </div>
        )}
      </Card>

      <Modal open={!!adding} onClose={() => setAdding(null)} title="New customer" wide>
        {adding && (
          <CustomerForm
            value={adding}
            onChange={setAdding}
            beats={beats}
            pending={pending}
            onCancel={() => setAdding(null)}
            onSubmit={() =>
              start(async () => {
                const res = await saveCustomer(adding);
                if (res.error) setError(res.error);
                else if (res.id) router.push(`/customers/${res.id}`);
              })
            }
          />
        )}
      </Modal>
    </div>
  );
}
