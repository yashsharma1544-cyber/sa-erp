-- =============================================================================
-- SA ERP · 0018 Credit check, bulk credit terms, Rupyz order approval queue
--   credit_check(firm, customer, order amount) → ok / reasons (D-51…D-54)
--   set_credit_terms(): one limit / days for many customers at once
--   rupyz_orders: orders from Rupyz land here, get checked, and the ones that
--   fail wait in the approval queue (kind 'order', permission order.approve).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Outstanding as the ERP sees it: Tally balance minus ERP receipts that Tally
-- has not posted yet (same rule as the collector app: unmatched, last 45 days).
-- -----------------------------------------------------------------------------
create or replace function private.erp_unposted_receipts(p_firm_id uuid, p_customer_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.amount), 0)
    from public.receipts r
   where r.customer_id = p_customer_id and r.firm_id = p_firm_id and r.deleted_at is null
     and r.status not in ('cancelled', 'bounced')
     and r.tally_voucher_id is null
     and r.collected_on >= private.today_ist() - 45
$$;

-- The check itself, without any access rule (callers apply their own).
create or replace function private.credit_eval(
  p_firm_id uuid, p_customer_id uuid, p_order_amount numeric, p_sale_kind text default 'credit'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today   date := private.today_ist();
  v_grace   int := coalesce((select (s.value #>> '{}')::int from public.app_settings s
                              where s.key = 'credit_grace_days' and s.deleted_at is null), 0);
  c         public.customers;
  a         public.customer_firm_accounts;
  v_tally   numeric := 0;
  v_unpost  numeric := 0;
  v_out     numeric;
  v_amount  numeric := round(coalesce(p_order_amount, 0), 2);
  v_oldest  record;
  v_reasons jsonb := '[]'::jsonb;
  v_days    int;
  v_has_old boolean;
begin
  select * into c from public.customers where id = p_customer_id and deleted_at is null;
  if not found then
    raise exception 'Customer not found' using errcode = 'no_data_found';
  end if;

  -- Mondha counter cash sales never need a credit check (D-09).
  if p_sale_kind = 'counter_cash' then
    return jsonb_build_object('ok', true, 'skipped', true, 'reasons', '[]'::jsonb,
                              'note', 'Counter cash sale: no credit check');
  end if;

  select * into a from public.customer_firm_accounts
   where customer_id = p_customer_id and firm_id = p_firm_id and deleted_at is null;

  select coalesce(sum(b.balance), 0) into v_tally
    from tally.mv_ar_balances b where b.firm_id = p_firm_id and b.customer_id = p_customer_id;
  v_unpost := private.erp_unposted_receipts(p_firm_id, p_customer_id);
  v_out := round(v_tally - v_unpost, 2);

  -- Oldest bill still unpaid once unposted ERP receipts settle the oldest bills
  -- first. "Older than records" bills sort first (age unknown).
  select x.bill_date, x.bill_no, x.is_older into v_oldest
    from (
      select bl.bill_date, bl.bill_no, bl.bill_date is null as is_older, bl.pending,
             sum(bl.pending) over (order by bl.bill_date nulls first, bl.bill_key rows unbounded preceding) as cum
        from tally.mv_ar_bills bl
        join tally.mv_ar_balances b on b.firm_id = bl.firm_id and b.nm = bl.nm
       where bl.firm_id = p_firm_id and b.customer_id = p_customer_id and bl.pending > 0
    ) x
   where x.cum > v_unpost + 0.5
   order by x.bill_date nulls first
   limit 1;
  v_has_old := found;
  v_days := case when v_oldest.bill_date is not null then v_today - v_oldest.bill_date end;

  if c.status = 'bad_debt' then
    v_reasons := v_reasons || jsonb_build_object('code', 'bad_debt', 'text', 'Customer is marked bad debt');
  elsif c.status = 'ignore' then
    v_reasons := v_reasons || jsonb_build_object('code', 'inactive', 'text', 'Customer is marked ignore');
  end if;

  -- 0 means "not set yet": that rule is skipped (D-51).
  if coalesce(a.credit_limit, 0) > 0 and v_out + v_amount > a.credit_limit then
    v_reasons := v_reasons || jsonb_build_object(
      'code', 'over_limit',
      'text', format('Outstanding %s + order %s is over the limit %s by %s',
                     to_char(v_out, 'FM99999999990.00'), to_char(v_amount, 'FM99999999990.00'),
                     to_char(a.credit_limit, 'FM99999999990.00'),
                     to_char(v_out + v_amount - a.credit_limit, 'FM99999999990.00')));
  end if;
  if coalesce(a.credit_days, 0) > 0 and v_has_old
     and (v_oldest.is_older or v_days > a.credit_days + v_grace) then
    v_reasons := v_reasons || jsonb_build_object(
      'code', 'overdue',
      'text', case when v_oldest.is_older
                   then format('A bill older than Tally records is unpaid (credit days %s + grace %s)', a.credit_days, v_grace)
                   else format('Oldest unpaid bill %s is %s days old (credit days %s + grace %s)',
                               coalesce(v_oldest.bill_no, ''), v_days, a.credit_days, v_grace) end);
  end if;

  return jsonb_build_object(
    'ok', jsonb_array_length(v_reasons) = 0,
    'skipped', false,
    'reasons', v_reasons,
    'terms_set', coalesce(a.credit_limit, 0) > 0 or coalesce(a.credit_days, 0) > 0,
    'status', c.status,
    'order_amount', v_amount,
    'tally_outstanding', round(v_tally, 2),
    'unposted_receipts', round(v_unpost, 2),
    'outstanding', v_out,
    'credit_limit', coalesce(a.credit_limit, 0),
    'available', case when coalesce(a.credit_limit, 0) > 0 then round(a.credit_limit - v_out, 2) end,
    'credit_days', coalesce(a.credit_days, 0),
    'grace_days', v_grace,
    'oldest_bill_date', v_oldest.bill_date,
    'oldest_bill_no', v_oldest.bill_no,
    'oldest_is_older_than_records', coalesce(v_oldest.is_older, false),
    'oldest_days', v_days,
    'checked_at', now()
  );
end;
$$;

-- App-facing check: office users for their firms, field users for customers in their beats.
create or replace function public.credit_check(
  p_firm_id uuid, p_customer_id uuid, p_order_amount numeric, p_sale_kind text default 'credit'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (p_firm_id = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  if not private.is_office_user()
     and not exists (select 1 from public.customers c
                      where c.id = p_customer_id and c.beat_id = any(private.my_beat_ids())) then
    raise exception 'This customer is not in your beats' using errcode = 'insufficient_privilege';
  end if;
  if p_sale_kind not in ('credit', 'counter_cash') then
    raise exception 'Unknown sale kind %', p_sale_kind using errcode = 'check_violation';
  end if;
  return private.credit_eval(p_firm_id, p_customer_id, p_order_amount, p_sale_kind);
end;
$$;

-- -----------------------------------------------------------------------------
-- Bulk credit terms. null leaves that value as it is. Opens a firm account for
-- customers that have none yet. Each row change is audit-logged.
-- -----------------------------------------------------------------------------
create or replace function public.set_credit_terms(
  p_firm_id uuid, p_customer_ids uuid[], p_credit_limit numeric default null, p_credit_days int default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int := 0;
  v_m int := 0;
begin
  if not private.has_perm('credit.manage') then
    raise exception 'Only someone with credit.manage can set credit terms' using errcode = 'insufficient_privilege';
  end if;
  if not (p_firm_id = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  if p_credit_limit is null and p_credit_days is null then
    raise exception 'Give a credit limit, credit days or both' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(p_customer_ids, 1), 0) = 0 or array_length(p_customer_ids, 1) > 2000 then
    raise exception 'Pick between 1 and 2,000 customers' using errcode = 'check_violation';
  end if;
  if p_credit_limit < 0 or p_credit_limit > 999999999999.99 then
    raise exception 'Credit limit must be between 0 and 999,999,999,999.99' using errcode = 'check_violation';
  end if;
  if p_credit_days < 0 or p_credit_days > 365 then
    raise exception 'Credit days must be between 0 and 365' using errcode = 'check_violation';
  end if;

  update public.customer_firm_accounts a
     set credit_limit = coalesce(round(p_credit_limit, 2), a.credit_limit),
         credit_days  = coalesce(p_credit_days, a.credit_days)
   where a.firm_id = p_firm_id and a.customer_id = any(p_customer_ids) and a.deleted_at is null
     and (a.credit_limit is distinct from coalesce(round(p_credit_limit, 2), a.credit_limit)
          or a.credit_days is distinct from coalesce(p_credit_days, a.credit_days));
  get diagnostics v_n = row_count;

  insert into public.customer_firm_accounts (customer_id, firm_id, credit_limit, credit_days)
  select c.id, p_firm_id, coalesce(round(p_credit_limit, 2), 0), coalesce(p_credit_days, 0)
    from public.customers c
   where c.id = any(p_customer_ids) and c.deleted_at is null
     and not exists (select 1 from public.customer_firm_accounts a
                      where a.customer_id = c.id and a.firm_id = p_firm_id and a.deleted_at is null);
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

-- Rows for the bulk screen: every customer with this firm's terms and position.
create or replace function public.credit_terms_list(p_firm_id uuid)
returns table (
  customer_id uuid, customer_name text, status text, customer_type text, beat_id uuid, beat_name text,
  territory_name text, has_account boolean, credit_limit numeric, credit_days int,
  outstanding numeric, oldest_bill_date date, sales_90d numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with bal as (
    select b.customer_id, sum(b.balance) as balance
      from tally.mv_ar_balances b where b.firm_id = p_firm_id and b.customer_id is not null
     group by b.customer_id
  ),
  old as (
    select b.customer_id, min(bl.bill_date) as oldest
      from tally.mv_ar_bills bl
      join tally.mv_ar_balances b on b.firm_id = bl.firm_id and b.nm = bl.nm
     where bl.firm_id = p_firm_id and b.customer_id is not null
     group by b.customer_id
  ),
  sales as (
    select b.customer_id, sum(v.total_amount) as amt
      from tally.vouchers v
      join tally.v_company_firm cf on cf.company_id = v.company_id and cf.firm_id = p_firm_id
      join tally.mv_ar_balances b on b.firm_id = p_firm_id and b.nm = private.ledger_key(v.party_name)
     where v.removed_at is null and not coalesce(v.is_voided, false) and v.voucher_kind = 'sales'
       and v.voucher_date >= private.today_ist() - 90 and b.customer_id is not null
     group by b.customer_id
  )
  select c.id, c.name, c.status, c.customer_type, c.beat_id, bt.name, t.name,
         a.id is not null, coalesce(a.credit_limit, 0), coalesce(a.credit_days, 0),
         round(coalesce(bal.balance, 0) - private.erp_unposted_receipts(p_firm_id, c.id), 2),
         old.oldest, coalesce(sales.amt, 0)
    from public.customers c
    left join public.customer_firm_accounts a on a.customer_id = c.id and a.firm_id = p_firm_id and a.deleted_at is null
    left join public.beats bt on bt.id = c.beat_id
    left join public.territories t on t.id = bt.territory_id
    left join bal on bal.customer_id = c.id
    left join old on old.customer_id = c.id
    left join sales on sales.customer_id = c.id
   where c.deleted_at is null
     and private.is_office_user()
     and p_firm_id = any(private.my_firm_ids())
     and (a.id is not null or bal.customer_id is not null or c.status = 'active')
$$;

-- -----------------------------------------------------------------------------
-- System-raised approval requests (Rupyz orders) have no ERP requester.
-- -----------------------------------------------------------------------------
alter table public.approval_requests alter column requested_by drop not null;
alter table public.approval_requests add constraint approval_requests_requester_ck
  check (requested_by is not null or subject_table = 'rupyz_orders');

-- -----------------------------------------------------------------------------
-- Customer links to outside systems (Rupyz customer id → ERP customer).
-- -----------------------------------------------------------------------------
create table public.customer_aliases (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id),
  source       text not null check (source in ('rupyz', 'mondha', 'other')),
  external_id  text not null,
  alias_name   text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create unique index customer_aliases_uq on public.customer_aliases (source, external_id) where deleted_at is null;
create index customer_aliases_customer_idx on public.customer_aliases (customer_id) where deleted_at is null;
select private.standardise_table('public.customer_aliases');
create policy customer_aliases_read on public.customer_aliases for select to authenticated
  using (deleted_at is null and private.is_office_user());

-- -----------------------------------------------------------------------------
-- Rupyz orders
-- -----------------------------------------------------------------------------
create table public.rupyz_orders (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms (id),
  rupyz_order_id       text not null,
  order_no             text,
  order_date           date not null,
  ordered_at           timestamptz,
  rupyz_customer_id    text,
  rupyz_customer_name  text not null,
  customer_id          uuid references public.customers (id),
  salesman_name        text,
  beat_name            text,
  amount               numeric(14,2) not null check (amount >= 0),
  items                jsonb not null default '[]'::jsonb,
  rupyz_status         text,
  status               text not null default 'unmapped'
                       check (status in ('unmapped', 'cleared', 'held', 'approved', 'rejected', 'cancelled')),
  credit               jsonb,
  checked_at           timestamptz,
  approval_request_id  uuid references public.approval_requests (id),
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  deleted_at           timestamptz,
  deleted_by           uuid
);
create unique index rupyz_orders_uq on public.rupyz_orders (rupyz_order_id) where deleted_at is null;
create index rupyz_orders_status_idx on public.rupyz_orders (status, order_date) where deleted_at is null;
create index rupyz_orders_customer_idx on public.rupyz_orders (customer_id) where deleted_at is null;
select private.standardise_table('public.rupyz_orders');
create policy rupyz_orders_read on public.rupyz_orders for select to authenticated
  using (deleted_at is null and private.is_office_user() and firm_id = any(private.my_firm_ids()));

-- Customer for a Rupyz order: linked id first, then a unique exact name match.
create or replace function private.rupyz_customer(p_external_id text, p_name text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select ca.customer_id from public.customer_aliases ca
      where ca.source = 'rupyz' and ca.external_id = p_external_id and ca.deleted_at is null),
    (select min(c.id::text)::uuid from public.customers c
      where c.deleted_at is null and private.ledger_key(c.name) = private.ledger_key(p_name)
     having count(*) = 1)
  )
$$;

-- Run the check on one order and move it to cleared / held (raising or
-- refreshing its approval request). Decided orders are left alone.
create or replace function private.rupyz_check_order(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o   public.rupyz_orders;
  v   jsonb;
  v_c public.customers;
  v_req uuid;
begin
  select * into o from public.rupyz_orders where id = p_id and deleted_at is null for update;
  if not found or o.status in ('approved', 'rejected', 'cancelled') then
    return o.status;
  end if;
  if o.customer_id is null then
    o.customer_id := private.rupyz_customer(o.rupyz_customer_id, o.rupyz_customer_name);
  end if;
  if o.customer_id is null then
    update public.rupyz_orders set status = 'unmapped', credit = null, checked_at = now() where id = p_id;
    return 'unmapped';
  end if;

  v := private.credit_eval(o.firm_id, o.customer_id, o.amount, 'credit');
  select * into v_c from public.customers where id = o.customer_id;

  if (v ->> 'ok')::boolean then
    if o.approval_request_id is not null then
      update public.approval_requests
         set status = 'cancelled', decided_at = now(), decision_note = 'Passed the credit check on recheck'
       where id = o.approval_request_id and status = 'pending';
    end if;
    update public.rupyz_orders
       set customer_id = o.customer_id, status = 'cleared', credit = v, checked_at = now(), approval_request_id = null
     where id = p_id;
    return 'cleared';
  end if;

  select r.id into v_req from public.approval_requests r
   where r.id = o.approval_request_id and r.status = 'pending';
  if v_req is null then
    insert into public.approval_requests (
      firm_id, kind, permission_key, subject_table, subject_id, subject_label,
      amount, is_bad_debt, reason, details, requested_by
    ) values (
      o.firm_id, 'order', 'order.approve', 'rupyz_orders', o.id,
      format('Rupyz order %s · %s', coalesce(o.order_no, o.rupyz_order_id), v_c.name),
      o.amount, v_c.status = 'bad_debt',
      (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(v -> 'reasons') x),
      jsonb_build_object('source', 'rupyz', 'salesman', o.salesman_name, 'order_date', o.order_date, 'credit', v),
      null
    ) returning id into v_req;
  else
    update public.approval_requests
       set reason = (select string_agg(x ->> 'text', '; ') from jsonb_array_elements(v -> 'reasons') x),
           is_bad_debt = v_c.status = 'bad_debt',
           amount = o.amount,
           details = details || jsonb_build_object('credit', v)
     where id = v_req;
  end if;
  update public.rupyz_orders
     set customer_id = o.customer_id, status = 'held', credit = v, checked_at = now(), approval_request_id = v_req
   where id = p_id;
  return 'held';
end;
$$;

-- Intake: an array of orders in the Rupyz Sync shape. Idempotent on the Rupyz
-- order id; an order already decided keeps its decision. Called by the feed
-- (service role) or by the owner.
create or replace function public.intake_rupyz_orders(p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       jsonb;
  v_id    uuid;
  v_firm  uuid;
  v_res   text;
  v_new   int := 0;
  v_ins   boolean;
  v_out   jsonb := '{}'::jsonb;
begin
  -- No signed-in user means the service role or a database job (anon cannot execute this).
  if not (auth.uid() is null or private.is_owner()) then
    raise exception 'Only the Rupyz feed or the owner can load orders' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_orders) <> 'array' then
    raise exception 'Expected a list of orders' using errcode = 'check_violation';
  end if;

  for o in select * from jsonb_array_elements(p_orders) loop
    v_id := null;
    if coalesce(o ->> 'order_id', '') = '' or coalesce(o ->> 'customer_name', '') = '' then
      raise exception 'Every order needs order_id and customer_name' using errcode = 'check_violation';
    end if;
    -- Rupyz takes orders for Sushil Agencies; the firm can be overridden per order.
    v_firm := coalesce((select f.id from public.firms f where f.code = o ->> 'firm_code'),
                       (select f.id from public.firms f where f.code = 'SA'));

    insert into public.rupyz_orders (
      firm_id, rupyz_order_id, order_no, order_date, ordered_at, rupyz_customer_id, rupyz_customer_name,
      salesman_name, beat_name, amount, items, rupyz_status
    ) values (
      v_firm, o ->> 'order_id', coalesce(o ->> 'order_no', o ->> 'order_id'),
      coalesce((o ->> 'order_date')::date, ((o ->> 'order_ts')::timestamptz at time zone 'Asia/Kolkata')::date),
      (o ->> 'order_ts')::timestamptz, o ->> 'customer_id', o ->> 'customer_name',
      o ->> 'salesman_name', o ->> 'beat_name',
      round(coalesce((o ->> 'total_amount')::numeric, (o ->> 'amount')::numeric, 0), 2),
      coalesce(o -> 'items', '[]'::jsonb), o ->> 'delivery_status'
    )
    on conflict (rupyz_order_id) where deleted_at is null do update
       set amount = excluded.amount, items = excluded.items, rupyz_status = excluded.rupyz_status,
           salesman_name = excluded.salesman_name, beat_name = excluded.beat_name
     where public.rupyz_orders.status not in ('approved', 'rejected', 'cancelled')
       and (public.rupyz_orders.amount, public.rupyz_orders.items, public.rupyz_orders.rupyz_status)
           is distinct from (excluded.amount, excluded.items, excluded.rupyz_status)
    returning id, (xmax = 0) into v_id, v_ins;
    if v_id is null then
      continue; -- unchanged or already decided
    end if;
    if v_ins then v_new := v_new + 1; end if;
    v_res := private.rupyz_check_order(v_id);
    v_out := jsonb_set(v_out, array[v_res], to_jsonb(coalesce((v_out ->> v_res)::int, 0) + 1));
  end loop;
  return v_out || jsonb_build_object('new', v_new);
end;
$$;

-- Office: link a Rupyz customer to an ERP customer and recheck its open orders.
create or replace function public.link_rupyz_customer(p_order_id uuid, p_customer_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.rupyz_orders;
  v_n int := 0;
  r record;
begin
  if not private.has_perm('masters.manage') then
    raise exception 'You are not allowed to link customers' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.rupyz_orders where id = p_order_id and deleted_at is null;
  if not found or not (o.firm_id = any(private.my_firm_ids())) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id and deleted_at is null) then
    raise exception 'Customer not found' using errcode = 'no_data_found';
  end if;
  if o.rupyz_customer_id is not null then
    update public.customer_aliases set deleted_at = now(), deleted_by = auth.uid()
     where source = 'rupyz' and external_id = o.rupyz_customer_id and deleted_at is null and customer_id <> p_customer_id;
    insert into public.customer_aliases (customer_id, source, external_id, alias_name)
    select p_customer_id, 'rupyz', o.rupyz_customer_id, o.rupyz_customer_name
     where not exists (select 1 from public.customer_aliases
                        where source = 'rupyz' and external_id = o.rupyz_customer_id and deleted_at is null);
  end if;
  for r in
    select id from public.rupyz_orders
     where deleted_at is null and status in ('unmapped', 'held', 'cleared')
       and (id = p_order_id or (o.rupyz_customer_id is not null and rupyz_customer_id = o.rupyz_customer_id))
  loop
    update public.rupyz_orders set customer_id = p_customer_id where id = r.id;
    perform private.rupyz_check_order(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Office: run the check again (after a payment, or new credit terms).
create or replace function public.recheck_rupyz_orders(p_ids uuid[] default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_res text;
  v_out jsonb := '{}'::jsonb;
begin
  if not (private.has_perm('order.approve') or private.has_perm('credit.manage')) then
    raise exception 'You are not allowed to recheck orders' using errcode = 'insufficient_privilege';
  end if;
  for r in
    select id from public.rupyz_orders
     where deleted_at is null and status in ('unmapped', 'held')
       and firm_id = any(private.my_firm_ids())
       and (p_ids is null or id = any(p_ids))
  loop
    v_res := private.rupyz_check_order(r.id);
    v_out := jsonb_set(v_out, array[v_res], to_jsonb(coalesce((v_out ->> v_res)::int, 0) + 1));
  end loop;
  return v_out;
end;
$$;

-- A decision in the approval queue settles the order.
create or replace function private.approval_settles_subject()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_table = 'rupyz_orders' and new.status in ('approved', 'rejected')
     and old.status = 'pending' then
    update public.rupyz_orders
       set status = new.status
     where id = new.subject_id and approval_request_id = new.id and status = 'held';
  end if;
  return new;
end;
$$;
create trigger approval_settles_subject
  after update of status on public.approval_requests
  for each row execute function private.approval_settles_subject();

revoke execute on function
  private.erp_unposted_receipts(uuid, uuid),
  private.credit_eval(uuid, uuid, numeric, text),
  private.rupyz_customer(text, text),
  private.rupyz_check_order(uuid),
  private.approval_settles_subject()
from public, anon, authenticated;
revoke execute on function
  public.credit_check(uuid, uuid, numeric, text),
  public.set_credit_terms(uuid, uuid[], numeric, int),
  public.credit_terms_list(uuid),
  public.intake_rupyz_orders(jsonb),
  public.link_rupyz_customer(uuid, uuid),
  public.recheck_rupyz_orders(uuid[])
from public, anon;
grant execute on function
  public.credit_check(uuid, uuid, numeric, text),
  public.set_credit_terms(uuid, uuid[], numeric, int),
  public.credit_terms_list(uuid),
  public.intake_rupyz_orders(jsonb),
  public.link_rupyz_customer(uuid, uuid),
  public.recheck_rupyz_orders(uuid[])
to authenticated;
grant execute on function public.intake_rupyz_orders(jsonb) to service_role;
