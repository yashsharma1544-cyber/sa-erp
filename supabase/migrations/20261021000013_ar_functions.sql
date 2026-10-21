-- =============================================================================
-- SA ERP · 0013 Receivables through functions, not owner-rights views (D-44)
-- The two receivables views read the mirror with the owner's rights, so the
-- access rule lived inside each view and Supabase flags them as
-- "security definer views". They move into the private tally schema; the API
-- reaches them only through the functions below, which keep the same rule.
-- =============================================================================

alter view public.v_ar_customers set schema tally;
alter view public.v_ar_bills set schema tally;
revoke all on tally.v_ar_customers, tally.v_ar_bills from public, anon, authenticated;

create or replace function public.ar_customers(p_firm_id uuid default null)
returns table (
  firm_id uuid, ledger_key text, ledger_name text, customer_id uuid, customer_name text, status text,
  beat_id uuid, beat_name text, territory_id uuid, territory_name text, whatsapp text, credit_days integer,
  credit_limit numeric(14,2), balance numeric(14,2), tally_balance numeric(14,2), movement numeric(14,2),
  vouchers_since bigint, snapshot_date date, last_receipt_date date, last_sale_date date,
  b0_15 numeric(14,2), b16_30 numeric(14,2), b31_45 numeric(14,2), b46_60 numeric(14,2), b60_plus numeric(14,2),
  overdue numeric(14,2), oldest_bill_date date, open_bills bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  -- tally.v_ar_customers itself limits rows to the caller's firms (and beats for field staff).
  select * from tally.v_ar_customers v where p_firm_id is null or v.firm_id = p_firm_id
$$;

create or replace function public.ar_bills(p_firm_id uuid default null, p_ledger_key text default null, p_customer_ids uuid[] default null)
returns table (
  firm_id uuid, ledger_key text, customer_id uuid, bill_key text, voucher_id uuid, bill_no text, bill_date date,
  kind text, bill_amount numeric(14,2), pending numeric(14,2), days integer, bucket text, overdue boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from tally.v_ar_bills v
   where (p_firm_id is null or v.firm_id = p_firm_id)
     and (p_ledger_key is null or v.ledger_key = p_ledger_key)
     and (p_customer_ids is null or v.customer_id = any(p_customer_ids))
$$;

revoke execute on function public.ar_customers(uuid), public.ar_bills(uuid, text, uuid[]) from public, anon;
grant execute on function public.ar_customers(uuid), public.ar_bills(uuid, text, uuid[]) to authenticated;

-- The field functions pointed at the old view names.
create or replace function public.field_collect_list(p_beat_id uuid)
returns table (
  customer_id uuid, customer_name text, beat_id uuid, whatsapp text, phone text, address text,
  firm_id uuid, firm_code text, ledger_key text, balance numeric, overdue numeric, b60_plus numeric,
  oldest_bill_date date, last_receipt_date date, credit_days int,
  erp_collected_since_snapshot numeric, open_promise_date date, open_promise_amount numeric,
  visited_today text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.beat_id, c.whatsapp, c.phone, c.address,
         a.firm_id, f.code, ar.ledger_key, ar.balance, ar.overdue, ar.b60_plus,
         ar.oldest_bill_date, ar.last_receipt_date, a.credit_days,
         (select coalesce(sum(r.amount), 0) from public.receipts r
           where r.customer_id = c.id and r.firm_id = a.firm_id and r.deleted_at is null
             and r.status not in ('cancelled', 'bounced', 'tally_matched')
             and r.collected_on >= coalesce(ar.snapshot_date, '1900-01-01')),
         p.promise_date, p.amount,
         (select v.outcome from public.collection_visits v
           where v.customer_id = c.id and v.deleted_at is null
             and (v.visited_at at time zone 'Asia/Kolkata')::date = private.today_ist()
           order by v.visited_at desc limit 1)
    from public.customers c
    join public.customer_firm_accounts a on a.customer_id = c.id and a.deleted_at is null and a.active
    join public.firms f on f.id = a.firm_id
    join tally.v_ar_customers ar on ar.firm_id = a.firm_id and ar.customer_id = c.id
    left join lateral (
      select pr.promise_date, pr.amount from public.promises pr
       where pr.customer_id = c.id and pr.firm_id = a.firm_id and pr.status = 'open' and pr.deleted_at is null
       order by pr.promise_date limit 1
    ) p on true
   where c.deleted_at is null
     and c.status = 'active'
     and c.beat_id = p_beat_id
     and (private.is_office_user() or p_beat_id = any(private.my_collection_beat_ids()))
     and a.firm_id = any(private.my_firm_ids())
     and ar.balance > 0
$$;

create or replace function public.field_customer_bills(p_customer_id uuid, p_firm_id uuid)
returns table (bill_key text, bill_no text, bill_date date, kind text, bill_amount numeric, pending numeric, days int, overdue boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.bill_key, b.bill_no, b.bill_date, b.kind, b.bill_amount, b.pending, b.days, b.overdue
    from tally.v_ar_bills b
    join public.customers c on c.id = b.customer_id
   where b.customer_id = p_customer_id and b.firm_id = p_firm_id
     and (private.is_office_user() or c.beat_id = any(private.my_collection_beat_ids()))
   order by b.bill_date asc nulls first
$$;
