export type ArCustomer = {
  firm_id: string;
  ledger_key: string;
  ledger_name: string;
  customer_id: string | null;
  customer_name: string | null;
  status: "active" | "bad_debt" | "ignore";
  beat_id: string | null;
  beat_name: string | null;
  territory_id: string | null;
  territory_name: string | null;
  whatsapp: string | null;
  credit_days: number | null;
  credit_limit: string | null;
  balance: string;
  tally_balance: string;
  movement: string;
  vouchers_since: number;
  snapshot_date: string | null;
  last_receipt_date: string | null;
  last_sale_date: string | null;
  b0_15: string;
  b16_30: string;
  b31_45: string;
  b46_60: string;
  b60_plus: string;
  overdue: string;
  oldest_bill_date: string | null;
  open_bills: number;
};

export type ArBill = {
  ledger_key: string;
  bill_key: string;
  bill_no: string | null;
  bill_date: string | null;
  kind: string;
  bill_amount: string | null;
  pending: string;
  days: number | null;
  bucket: string;
  overdue: boolean;
};

/** Working = active customers who owe; bad debt / ignore and credit balances are shown apart. */
export type Section = "working" | "parked" | "advance";
export function sectionOf(c: Pick<ArCustomer, "status" | "balance">): Section {
  if (c.status !== "active") return "parked";
  return Number(c.balance) > 0 ? "working" : "advance";
}
