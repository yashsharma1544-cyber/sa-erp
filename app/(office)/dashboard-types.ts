export type CollectionLine = {
  collected_on: string;
  firm_id: string;
  source: "erp" | "tally";
  customer_id: string | null;
  ledger_key: string | null;
  customer_name: string | null;
  beat_id: string | null;
  beat_name: string | null;
  territory_id: string | null;
  territory_name: string | null;
  collector_id: string | null;
  collector_name: string | null;
  mode: "cash" | "upi" | "cheque" | "bank" | "tally";
  amount: string;
  receipts: number;
};

export type CollectorRow = {
  collector_id: string;
  collector_name: string;
  roles: string[];
  collected_today: string;
  receipts_today: number;
  collected_jc: string;
  cash_in_hand: string;
  oldest_cash: string | null;
  promises_today: number;
  promises_today_amount: string;
  visits_today: number;
  last_activity_at: string | null;
  collection_beats: string[] | null;
  beats_outstanding: string;
  beats_overdue: string;
};

/** Outstanding per customer and firm, the "to collect" side. */
export type DueRow = {
  firm_id: string;
  beat_id: string | null;
  beat_name: string | null;
  territory_name: string | null;
  balance: number;
  overdue: number;
  b60_plus: number;
};

export type PromiseRow = {
  id: string;
  firm_id: string;
  customer_id: string;
  customer_name: string;
  beat_name: string | null;
  amount: string;
  made_to_name: string;
  note: string | null;
};

export type Firm = { id: string; code: string; name: string };
