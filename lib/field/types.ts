// Shapes shared by the collector app and its API routes.

export type FieldAccount = {
  firm_id: string;
  firm_code: string;
  ledger_key: string;
  balance: number;
  overdue: number;
  b60_plus: number;
  oldest_bill_date: string | null;
  last_receipt_date: string | null;
  credit_days: number | null;
  erp_collected: number;
  promise_date: string | null;
  promise_amount: number | null;
};

export type FieldBill = {
  bill_key: string;
  bill_no: string | null;
  bill_date: string | null;
  kind: string;
  bill_amount: number | null;
  pending: number;
  days: number | null;
  overdue: boolean;
};

export type FieldCustomer = {
  id: string;
  name: string;
  whatsapp: string | null;
  phone: string | null;
  address: string | null;
  visited_today: string | null;
  accounts: FieldAccount[];
  bills: Record<string, FieldBill[]>; // by firm_id
};

export type FieldReceipt = {
  receipt_no: string;
  amount: number;
  mode: "cash" | "upi" | "cheque" | "bank";
  customer_id: string;
  firm_id: string;
  collected_at: string;
};

export type CollectPayload = {
  beatId: string;
  fetchedAt: string;
  customers: FieldCustomer[];
  myToday: FieldReceipt[];
};

/** One entry the phone sends to /api/field/ops (and keeps in its outbox until sent). */
export type FieldOp = {
  client_op_id: string;
  kind: "receipt" | "promise" | "visit";
  firm_id?: string;
  customer_id: string;
  amount?: string;
  mode?: "cash" | "upi" | "cheque";
  upi_ref?: string;
  cheque_no?: string;
  cheque_date?: string;
  cheque_bank?: string;
  cheque_photo_path?: string;
  promise_date?: string;
  outcome?: "not_available" | "refused" | "closed";
  note?: string;
  happened_at: string;
  lat?: string;
  lng?: string;
};

export type OpResult = { status: "created" | "duplicate"; kind: string; id: string; receipt_no?: string };
