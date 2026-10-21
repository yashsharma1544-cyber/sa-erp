-- =============================================================================
-- SA ERP · 0011 Receivables (Phase 1, slice 1.1), D-38
--
-- TallySync carries no bill-wise references, so the ERP works out bills the
-- way the collections app does:
--   balance  = Tally closing balance of the debtor ledger at the latest
--              snapshot + vouchers first seen after that snapshot
--   bills    = that balance spread over the customer's newest sales and debit
--              notes first (older bills count as paid, D-12 oldest-first).
--              Anything left over is "older than our records".
-- Results are materialised after every Tally sync and read through firm- and
-- beat-filtered views.
-- =============================================================================

create or replace function private.ledger_key(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(trim(coalesce(p, ''))), '\s+', ' ', 'g')
$$;

-- One row per party per voucher. A receipt split across several parties is
-- split by its allocations; anything else goes wholly to the voucher's party.
create or replace view tally.v_ledger_entries as
select v.id as voucher_id,
       cf.firm_id,
       v.company_id,
       x.ledger_name,
       private.ledger_key(x.ledger_name) as nm,
       v.voucher_date,
       v.voucher_kind,
       v.voucher_no,
       v.first_seen_at,
       case when v.voucher_kind in ('sales', 'debit_note', 'payment') then x.amt else 0 end::numeric(14,2) as dr,
       case when v.voucher_kind in ('receipt', 'credit_note', 'purchase') then x.amt else 0 end::numeric(14,2) as cr
  from tally.vouchers v
  join tally.v_company_firm cf on cf.company_id = v.company_id
  left join lateral (
    select count(distinct a.party_name) as parties
      from tally.voucher_allocations a
     where a.voucher_id = v.id and a.removed_at is null
  ) m on v.voucher_kind = 'receipt'
  cross join lateral (
    select a.party_name as ledger_name, sum(a.amount) as amt
      from tally.voucher_allocations a
     where v.voucher_kind = 'receipt' and coalesce(m.parties, 0) > 1
       and a.voucher_id = v.id and a.removed_at is null and a.party_name is not null
     group by a.party_name
    union all
    select v.party_name, v.total_amount
     where not (v.voucher_kind = 'receipt' and coalesce(m.parties, 0) > 1)
  ) x
 where v.removed_at is null
   and not coalesce(v.is_voided, false)
   and v.voucher_kind in ('sales', 'debit_note', 'payment', 'receipt', 'credit_note', 'purchase')
   and x.ledger_name is not null;

-- -----------------------------------------------------------------------------
-- Balances per debtor ledger, current FY company of each firm.
-- -----------------------------------------------------------------------------
create materialized view tally.mv_ar_balances as
with cur as (
  select cf.company_id, cf.firm_id
    from tally.v_company_firm cf
    join tally.companies c on c.id = cf.company_id
   where private.today_ist() between c.fy_start_date and c.fy_end_date
),
snap as (
  select l.company_id, max(l.as_on_date) as d
    from tally.ledger_balances l
    join cur on cur.company_id = l.company_id
   where l.removed_at is null and not coalesce(l.is_voided, false)
   group by l.company_id
),
lb as (
  select cur.firm_id, l.company_id, l.ledger_name, private.ledger_key(l.ledger_name) as nm,
         -l.closing_balance as bal, l.last_seen_at, s.d as snapshot_date
    from tally.ledger_balances l
    join snap s on s.company_id = l.company_id and s.d = l.as_on_date
    join cur on cur.company_id = l.company_id
   where l.removed_at is null and not coalesce(l.is_voided, false)
     and l.root_group = 'Sundry Debtors'
),
st as (
  select company_id, max(last_seen_at) as t, max(snapshot_date) as snapshot_date from lb group by company_id
),
mv as (
  select e.firm_id, e.nm, max(e.ledger_name) as ledger_name, sum(e.dr - e.cr) as delta, count(*) as vouchers
    from tally.v_ledger_entries e
    join st on st.company_id = e.company_id
   where e.first_seen_at > st.t
   group by e.firm_id, e.nm
),
base as (
  select coalesce(lb.firm_id, mv.firm_id) as firm_id,
         coalesce(lb.nm, mv.nm) as nm,
         coalesce(lb.ledger_name, mv.ledger_name) as ledger_name,
         coalesce(lb.bal, 0) as tally_balance,
         coalesce(mv.delta, 0) as movement,
         coalesce(mv.vouchers, 0) as vouchers_since,
         lb.nm is not null as in_snapshot
    from lb
    full join mv on mv.firm_id = lb.firm_id and mv.nm = lb.nm
),
acct as (
  select a.firm_id, private.ledger_key(a.tally_ledger_name) as nm, min(a.customer_id::text)::uuid as customer_id
    from public.customer_firm_accounts a
   where a.deleted_at is null and a.tally_ledger_name is not null
   group by 1, 2
),
last_moves as (
  select e.firm_id, e.nm,
         max(e.voucher_date) filter (where e.voucher_kind = 'receipt') as last_receipt_date,
         max(e.voucher_date) filter (where e.voucher_kind = 'sales') as last_sale_date
    from tally.v_ledger_entries e
   group by e.firm_id, e.nm
)
select b.firm_id,
       b.nm,
       b.ledger_name,
       acct.customer_id,
       round(b.tally_balance + b.movement, 2)::numeric(14,2) as balance,
       b.tally_balance::numeric(14,2) as tally_balance,
       b.movement::numeric(14,2) as movement,
       b.vouchers_since,
       (select max(st.snapshot_date) from st join cur on cur.company_id = st.company_id where cur.firm_id = b.firm_id) as snapshot_date,
       lm.last_receipt_date,
       lm.last_sale_date
  from base b
  left join acct on acct.firm_id = b.firm_id and acct.nm = b.nm
  left join last_moves lm on lm.firm_id = b.firm_id and lm.nm = b.nm
 where (b.in_snapshot or acct.customer_id is not null)
   and not exists (
     select 1 from public.non_customer_parties n
      where n.firm_id = b.firm_id and n.deleted_at is null and private.ledger_key(n.tally_ledger_name) = b.nm
   );

create unique index mv_ar_balances_uq on tally.mv_ar_balances (firm_id, nm);
create index mv_ar_balances_customer_idx on tally.mv_ar_balances (customer_id);

-- -----------------------------------------------------------------------------
-- Open bills: positive balances spread over the newest bills first.
-- -----------------------------------------------------------------------------
create materialized view tally.mv_ar_bills as
with bal as (
  select firm_id, nm, balance from tally.mv_ar_balances where balance > 0
),
inv as (
  select cf.firm_id, private.ledger_key(v.party_name) as nm, v.id as voucher_id, v.voucher_no, v.voucher_date,
         v.voucher_kind, v.total_amount as amt
    from tally.vouchers v
    join tally.v_company_firm cf on cf.company_id = v.company_id
   where v.removed_at is null and not coalesce(v.is_voided, false)
     and v.voucher_kind in ('sales', 'debit_note') and v.total_amount > 0 and v.party_name is not null
),
j as (
  select b.firm_id, b.nm, b.balance, i.voucher_id, i.voucher_no, i.voucher_date, i.voucher_kind, i.amt,
         sum(i.amt) over (partition by b.firm_id, b.nm order by i.voucher_date desc, i.voucher_no desc, i.voucher_id
                          rows unbounded preceding) as cum
    from bal b
    join inv i on i.firm_id = b.firm_id and i.nm = b.nm
),
open_bills as (
  select firm_id, nm, voucher_id::text as bill_key, voucher_id, voucher_no as bill_no, voucher_date as bill_date,
         voucher_kind as kind, amt as bill_amount, round(least(amt, balance - (cum - amt)), 2) as pending
    from j
   where cum - amt < balance
),
rest as (
  select b.firm_id, b.nm, 'older'::text as bill_key, null::uuid as voucher_id, null::text as bill_no, null::date as bill_date,
         'older'::text as kind, null::numeric as bill_amount,
         round(b.balance - coalesce((select sum(o.pending) from open_bills o where o.firm_id = b.firm_id and o.nm = b.nm), 0), 2) as pending
    from bal b
)
select firm_id, nm, bill_key, voucher_id, bill_no, bill_date, kind, bill_amount::numeric(14,2), pending::numeric(14,2) from open_bills
union all
select firm_id, nm, bill_key, voucher_id, bill_no, bill_date, kind, bill_amount::numeric(14,2), pending::numeric(14,2) from rest where pending > 0.5;

create unique index mv_ar_bills_uq on tally.mv_ar_bills (firm_id, nm, bill_key);

create or replace function tally.refresh_receivables()
returns void
language plpgsql
set search_path = ''
as $$
begin
  refresh materialized view concurrently tally.mv_ar_balances;
  refresh materialized view concurrently tally.mv_ar_bills;
end;
$$;

-- The sync now refreshes receivables at the end of every successful pull.
create or replace function tally.run_sync(p_full boolean default false, p_trigger text default 'cron')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_log bigint;
  v_overlap constant interval := interval '30 minutes';
  v_full boolean := p_full;
  v_counts jsonb;
  v_status text;
begin
  if to_regclass('tally_src.vouchers') is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'TallySync is not connected yet');
  end if;
  if not pg_try_advisory_xact_lock(hashtext('tally.run_sync')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'A sync is already running');
  end if;
  if not exists (select 1 from tally.vouchers) then
    v_full := true;
  end if;

  insert into tally.sync_log (full_pull, trigger) values (v_full, p_trigger) returning id into v_log;
  begin
    v_counts := jsonb_build_object(
      'companies',           tally.pull_companies(case when v_full then null else (select max(updated_at) from tally.companies) - v_overlap end),
      'vouchers',            tally.pull_vouchers(case when v_full then null else (select max(updated_at) from tally.vouchers) - v_overlap end),
      'voucher_lines',       tally.pull_voucher_lines(case when v_full then null else (select max(updated_at) from tally.voucher_lines) - v_overlap end),
      'voucher_allocations', tally.pull_voucher_allocations(case when v_full then null else (select max(created_at) from tally.voucher_allocations) - v_overlap end),
      'outstandings',        tally.pull_outstandings(case when v_full then null else (select max(updated_at) from tally.outstandings) - v_overlap end),
      'ledger_balances',     tally.pull_ledger_balances(case when v_full then null else (select max(updated_at) from tally.ledger_balances) - v_overlap end)
    );
    v_counts := v_counts || jsonb_build_object('removed', tally.mark_removed(v_full));
    perform tally.refresh_receivables();
    update tally.sync_log set status = 'ok', counts = v_counts, finished_at = clock_timestamp() where id = v_log;
    v_status := 'ok';
  exception when others then
    update tally.sync_log set status = 'failed', error = sqlerrm, finished_at = clock_timestamp() where id = v_log;
    v_status := 'failed';
    v_counts := jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('status', v_status, 'counts', v_counts);
end;
$$;

revoke all on all functions in schema tally from public;
revoke all on all tables in schema tally from anon, authenticated;

-- -----------------------------------------------------------------------------
-- App-facing views. They run as their owner, so the filters below are the
-- access rule: only firms the user works for; field users only their beats.
-- -----------------------------------------------------------------------------
create or replace view public.v_ar_bills
with (security_barrier = true) as
select b.firm_id,
       b.nm as ledger_key,
       bal.customer_id,
       b.bill_key,
       b.voucher_id,
       b.bill_no,
       b.bill_date,
       b.kind,
       b.bill_amount,
       b.pending,
       case when b.bill_date is null then null else private.today_ist() - b.bill_date end as days,
       case
         when b.bill_date is null or private.today_ist() - b.bill_date > 60 then '60+'
         when private.today_ist() - b.bill_date > 45 then '46-60'
         when private.today_ist() - b.bill_date > 30 then '31-45'
         when private.today_ist() - b.bill_date > 15 then '16-30'
         else '0-15'
       end as bucket,
       (b.bill_date is null or b.bill_date + coalesce(a.credit_days, 0) < private.today_ist()) as overdue
  from tally.mv_ar_bills b
  join tally.mv_ar_balances bal on bal.firm_id = b.firm_id and bal.nm = b.nm
  left join public.customers c on c.id = bal.customer_id and c.deleted_at is null
  left join public.customer_firm_accounts a
         on a.customer_id = bal.customer_id and a.firm_id = b.firm_id and a.deleted_at is null
 where b.firm_id = any(private.my_firm_ids())
   and (private.is_office_user() or c.beat_id = any(private.my_beat_ids()));

create or replace view public.v_ar_customers
with (security_barrier = true) as
select bal.firm_id,
       bal.nm as ledger_key,
       bal.ledger_name,
       bal.customer_id,
       c.name as customer_name,
       coalesce(c.status, 'active') as status,
       c.beat_id,
       bt.name as beat_name,
       bt.territory_id,
       t.name as territory_name,
       c.whatsapp,
       a.credit_days,
       a.credit_limit,
       bal.balance,
       bal.tally_balance,
       bal.movement,
       bal.vouchers_since,
       bal.snapshot_date,
       bal.last_receipt_date,
       bal.last_sale_date,
       coalesce(x.b0_15, 0)::numeric(14,2)  as b0_15,
       coalesce(x.b16_30, 0)::numeric(14,2) as b16_30,
       coalesce(x.b31_45, 0)::numeric(14,2) as b31_45,
       coalesce(x.b46_60, 0)::numeric(14,2) as b46_60,
       coalesce(x.b60p, 0)::numeric(14,2)   as b60_plus,
       coalesce(x.overdue, 0)::numeric(14,2) as overdue,
       x.oldest_bill_date,
       coalesce(x.bills, 0) as open_bills
  from tally.mv_ar_balances bal
  left join public.customers c on c.id = bal.customer_id and c.deleted_at is null
  left join public.beats bt on bt.id = c.beat_id
  left join public.territories t on t.id = bt.territory_id
  left join public.customer_firm_accounts a
         on a.customer_id = bal.customer_id and a.firm_id = bal.firm_id and a.deleted_at is null
  left join lateral (
    select sum(o.pending) filter (where o.days is not null and o.days <= 15) as b0_15,
           sum(o.pending) filter (where o.days between 16 and 30) as b16_30,
           sum(o.pending) filter (where o.days between 31 and 45) as b31_45,
           sum(o.pending) filter (where o.days between 46 and 60) as b46_60,
           sum(o.pending) filter (where o.days is null or o.days > 60) as b60p,
           sum(o.pending) filter (where o.bill_date is null or o.bill_date + coalesce(a.credit_days, 0) < private.today_ist()) as overdue,
           min(o.bill_date) as oldest_bill_date,
           count(*) filter (where o.bill_date is not null) as bills
      from (select mb.*, private.today_ist() - mb.bill_date as days
              from tally.mv_ar_bills mb
             where mb.firm_id = bal.firm_id and mb.nm = bal.nm) o
  ) x on true
 where bal.firm_id = any(private.my_firm_ids())
   and (private.is_office_user() or c.beat_id = any(private.my_beat_ids()));

revoke all on public.v_ar_bills, public.v_ar_customers from anon, public;
grant select on public.v_ar_bills, public.v_ar_customers to authenticated;

-- -----------------------------------------------------------------------------
-- DSO = current working outstanding ÷ credit sales in the period × days.
-- Bad-debt and ignore customers are left out.
-- -----------------------------------------------------------------------------
create or replace function public.ar_dso(p_firm_id uuid, p_from date, p_to date)
returns table (outstanding numeric, credit_sales numeric, days int, dso numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with ok as (
    select p_firm_id = any(private.my_firm_ids()) and private.is_office_user() and p_to >= p_from as allowed
  ),
  o as (
    select coalesce(sum(b.balance), 0) as amt
      from tally.mv_ar_balances b
      left join public.customers c on c.id = b.customer_id
     where b.firm_id = p_firm_id and b.balance > 0 and coalesce(c.status, 'active') = 'active'
  ),
  s as (
    select coalesce(sum(e.dr), 0) as amt
      from tally.v_ledger_entries e
     where e.firm_id = p_firm_id and e.voucher_kind in ('sales', 'debit_note')
       and e.voucher_date between p_from and p_to
       and exists (select 1 from tally.mv_ar_balances b where b.firm_id = e.firm_id and b.nm = e.nm)
  )
  select o.amt, s.amt, (p_to - p_from + 1),
         case when s.amt > 0 then round(o.amt / s.amt * (p_to - p_from + 1), 1) end
    from o, s, ok
   where ok.allowed
$$;

revoke execute on function public.ar_dso(uuid, date, date) from public, anon;
grant execute on function public.ar_dso(uuid, date, date) to authenticated;

-- First fill (the views are created with data already; this keeps the
-- function exercised once).
select tally.refresh_receivables();
