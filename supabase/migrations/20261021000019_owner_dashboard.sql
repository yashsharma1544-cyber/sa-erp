-- =============================================================================
-- SA ERP · 0019 Owner dashboard (D-56)
--   collection_lines(from, to): every rupee collected in the period, once.
--     ERP receipts (by collector), plus Tally receipts no ERP receipt is matched
--     to (shown as "Office / Tally"). Grouped per day, firm, customer, collector
--     and mode, with beat and territory, so the dashboard can cut it any way.
--   collector_board(today, jc_start): per field collector: collected today and
--     this JC, cash in hand, promises due today, visits today, and what is
--     outstanding in their collection beats.
-- =============================================================================

create or replace function public.collection_lines(p_from date, p_to date)
returns table (
  collected_on date, firm_id uuid, source text, customer_id uuid, ledger_key text, customer_name text,
  beat_id uuid, beat_name text, territory_id uuid, territory_name text,
  collector_id uuid, collector_name text, mode text, amount numeric, receipts bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ok as (
    select private.is_office_user() and private.has_perm('reports.view_all') and p_to >= p_from
           and p_to - p_from <= 400 as allowed
  ),
  erp as (
    select r.collected_on, r.firm_id, 'erp'::text as source, r.customer_id, null::text as ledger_key,
           r.collected_by as collector_id, r.mode, sum(r.amount) as amount, count(*) as receipts
      from public.receipts r, ok
     where ok.allowed and r.deleted_at is null
       and r.status not in ('cancelled', 'bounced')
       and r.collected_on between p_from and p_to
       and r.firm_id = any(private.my_firm_ids())
     group by 1, 2, 3, 4, 5, 6, 7
  ),
  tly as (
    select e.voucher_date as collected_on, e.firm_id, 'tally'::text as source, b.customer_id, e.nm as ledger_key,
           null::uuid as collector_id, 'tally'::text as mode, sum(e.cr) as amount, count(*) as receipts
      from tally.v_ledger_entries e
      join tally.mv_ar_balances b on b.firm_id = e.firm_id and b.nm = e.nm
      cross join ok
     where ok.allowed and e.voucher_kind = 'receipt' and e.cr > 0
       and e.voucher_date between p_from and p_to
       and e.firm_id = any(private.my_firm_ids())
       and not exists (select 1 from public.receipt_tally_matches m
                        where m.tally_voucher_id = e.voucher_id and m.ledger_key = e.nm and m.deleted_at is null)
     group by 1, 2, 3, 4, 5, 6, 7
  ),
  allx as (select * from erp union all select * from tly)
  select x.collected_on, x.firm_id, x.source, x.customer_id, x.ledger_key,
         coalesce(c.name, (select bb.ledger_name from tally.mv_ar_balances bb where bb.firm_id = x.firm_id and bb.nm = x.ledger_key)),
         c.beat_id, bt.name, bt.territory_id, t.name,
         x.collector_id, u.full_name, x.mode, round(x.amount, 2), x.receipts
    from allx x
    left join public.customers c on c.id = x.customer_id
    left join public.beats bt on bt.id = c.beat_id
    left join public.territories t on t.id = bt.territory_id
    left join public.app_users u on u.id = x.collector_id
$$;

create or replace function public.collector_board(p_today date, p_jc_start date)
returns table (
  collector_id uuid, collector_name text, roles text[],
  collected_today numeric, receipts_today bigint, collected_jc numeric,
  cash_in_hand numeric, oldest_cash date,
  promises_today bigint, promises_today_amount numeric,
  visits_today bigint, last_activity_at timestamptz,
  collection_beats text[], beats_outstanding numeric, beats_overdue numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with ok as (select private.is_office_user() and private.has_perm('reports.view_all') as allowed),
  people as (
    select u.id, u.full_name, array_agg(distinct r.role order by r.role) as roles
      from public.app_users u
      join public.user_roles r on r.user_id = u.id and r.deleted_at is null
     cross join ok
     where ok.allowed and u.deleted_at is null and u.active
       and (r.role = 'collector'
            or exists (select 1 from public.receipts x where x.collected_by = u.id and x.deleted_at is null
                        and x.collected_on >= p_jc_start))
     group by u.id, u.full_name
  ),
  beats as (
    select ub.user_id, array_agg(distinct b.name order by b.name) as names, array_agg(distinct b.id) as ids
      from public.user_beats ub join public.beats b on b.id = ub.beat_id
     where ub.purpose = 'collection' and ub.deleted_at is null
     group by ub.user_id
  )
  select p.id, p.full_name, p.roles,
         coalesce(sum(r.amount) filter (where r.collected_on = p_today), 0),
         count(r.id) filter (where r.collected_on = p_today),
         coalesce(sum(r.amount) filter (where r.collected_on >= p_jc_start), 0),
         (select coalesce(sum(c.amount), 0) from public.receipts c
           where c.collected_by = p.id and c.mode = 'cash' and c.status = 'recorded' and c.deleted_at is null),
         (select min(c.collected_on) from public.receipts c
           where c.collected_by = p.id and c.mode = 'cash' and c.status = 'recorded' and c.deleted_at is null),
         (select count(*) from public.promises pr
           where pr.made_to = p.id and pr.promise_date = p_today and pr.status = 'open' and pr.deleted_at is null),
         (select coalesce(sum(pr.amount), 0) from public.promises pr
           where pr.made_to = p.id and pr.promise_date = p_today and pr.status = 'open' and pr.deleted_at is null),
         (select count(*) from public.collection_visits v
           where v.user_id = p.id and v.deleted_at is null
             and (v.visited_at at time zone 'Asia/Kolkata')::date = p_today),
         greatest(max(r.collected_at),
                  (select max(v.visited_at) from public.collection_visits v where v.user_id = p.id and v.deleted_at is null)),
         bt.names,
         (select coalesce(sum(bal.balance), 0) from tally.mv_ar_balances bal
            join public.customers c on c.id = bal.customer_id
           where c.beat_id = any(bt.ids) and c.status = 'active' and c.deleted_at is null and bal.balance > 0
             and bal.firm_id = any(private.my_firm_ids())),
         (select coalesce(sum(o.pending), 0) from tally.mv_ar_bills o
            join tally.mv_ar_balances bal on bal.firm_id = o.firm_id and bal.nm = o.nm
            join public.customers c on c.id = bal.customer_id
            left join public.customer_firm_accounts a on a.customer_id = c.id and a.firm_id = o.firm_id and a.deleted_at is null
           where c.beat_id = any(bt.ids) and c.status = 'active' and c.deleted_at is null
             and o.firm_id = any(private.my_firm_ids())
             and (o.bill_date is null or o.bill_date + coalesce(a.credit_days, 0) < p_today))
    from people p
    left join public.receipts r on r.collected_by = p.id and r.deleted_at is null
         and r.status not in ('cancelled', 'bounced') and r.collected_on >= least(p_jc_start, p_today)
         and r.firm_id = any(private.my_firm_ids())
    left join beats bt on bt.user_id = p.id
   group by p.id, p.full_name, p.roles, bt.names, bt.ids
$$;

revoke execute on function public.collection_lines(date, date), public.collector_board(date, date) from public, anon;
grant execute on function public.collection_lines(date, date), public.collector_board(date, date) to authenticated;
