"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { formatINR, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { SearchInput } from "@/components/ui/search-input";
import { EmptyRow, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CustomerForm, blankCustomer } from "./customer-form";
import { saveCustomer, type CustomerInput } from "./actions";

export type CustomerRow = {
  id: string;
  name: string;
  customer_type: string;
  beat_id: string | null;
  whatsapp: string | null;
  town: string | null;
  status: "active" | "bad_debt" | "ignore";
  accounts: { firm_id: string; credit_limit: string; credit_days: number }[];
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
  const [pending, start] = useTransition();

  const beatName = (id: string | null) => beats.find((b) => b.id === id)?.name ?? "No beat";
  const firmCode = (id: string) => firms.find((f) => f.id === id)?.code ?? "?";

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return customers.filter(
      (c) =>
        (beat === "all" || (beat === "none" ? !c.beat_id : c.beat_id === beat)) &&
        (status === "all" || c.status === status) &&
        (!needle || `${c.name} ${c.town ?? ""} ${c.whatsapp ?? ""}`.toLowerCase().includes(needle)),
    );
  }, [customers, q, beat, status]);

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
        <Table>
          <THead>
            <tr>
              <TH>Customer</TH>
              <TH>Beat</TH>
              <TH>WhatsApp</TH>
              <TH>Firm accounts · credit</TH>
              <TH>Status</TH>
            </tr>
          </THead>
          <tbody>
            {shown.slice(0, limit).map((c) => (
              <TR key={c.id} className="cursor-pointer hover:bg-slate-50" onClick={() => router.push(`/customers/${c.id}`)}>
                <TD>
                  <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">
                    {c.name}
                  </Link>
                  <div className="text-xs capitalize text-slate-500">
                    {c.customer_type}
                    {c.town ? ` · ${c.town}` : ""}
                  </div>
                </TD>
                <TD>{beatName(c.beat_id)}</TD>
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
              <EmptyRow colSpan={5}>
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
