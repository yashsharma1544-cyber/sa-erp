import { createClient } from "@/lib/supabase/server";
import { readAll } from "@/lib/supabase/read-all";
import type { ArBill, ArCustomer } from "./types";

export { sectionOf, type ArBill, type ArCustomer, type Section } from "./types";

const CUSTOMER_COLUMNS =
  "firm_id, ledger_key, ledger_name, customer_id, customer_name, status, beat_id, beat_name, territory_id, territory_name, whatsapp, credit_days, credit_limit, balance, tally_balance, movement, vouchers_since, snapshot_date, last_receipt_date, last_sale_date, b0_15, b16_30, b31_45, b46_60, b60_plus, overdue, oldest_bill_date, open_bills";

/** Every ledger with a non-zero balance in one firm. */
export async function loadArCustomers(firmId: string): Promise<ArCustomer[]> {
  const supabase = await createClient();
  return readAll<ArCustomer>((a, b) =>
    supabase
      .rpc("ar_customers", { p_firm_id: firmId })
      .neq("balance", 0)
      .select(CUSTOMER_COLUMNS)
      .order("balance", { ascending: false })
      .order("ledger_key")
      .range(a, b),
  );
}

export async function loadArBills(firmId: string, ledgerKey?: string): Promise<ArBill[]> {
  const supabase = await createClient();
  return readAll<ArBill>((a, b) => {
    return supabase
      .rpc("ar_bills", { p_firm_id: firmId, p_ledger_key: ledgerKey ?? null })
      .select("ledger_key, bill_key, bill_no, bill_date, kind, bill_amount, pending, days, bucket, overdue")
      .order("ledger_key")
      .order("bill_date", { ascending: false, nullsFirst: false })
      .range(a, b);
  });
}
