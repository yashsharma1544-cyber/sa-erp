-- Owner dashboard: every rupee once (ERP receipts + Tally receipts not matched
-- to one), access, and the per-collector board. Runs on the data of tests 70–98.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set sm_auth    '00000000-0000-0000-0000-00000000e002'
\set col_auth   '00000000-0000-0000-0000-00000000f001'

-- Give Collector Eight a promise due today.
insert into public.promises (firm_id, customer_id, promise_date, amount, made_to, client_op_id)
select f.id, '00000000-0000-0000-0000-0000000e0b01', private.today_ist(), 250, u.id, gen_random_uuid()
  from public.firms f, public.app_users u where f.code = 'SA' and u.auth_user_id = :'col_auth';

-- Expected Tally side, worked out directly (the API role cannot read tally.*).
create temp table expect_tally as
select coalesce(sum(e.cr), 0) as amt
  from tally.v_ledger_entries e join tally.mv_ar_balances b on b.firm_id = e.firm_id and b.nm = e.nm
 where e.voucher_kind = 'receipt' and e.voucher_date between private.today_ist() - 30 and private.today_ist()
   and not exists (select 1 from public.receipt_tally_matches m
                    where m.tally_voucher_id = e.voucher_id and m.ledger_key = e.nm and m.deleted_at is null);
grant select on expect_tally to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare
  d0 date := private.today_ist() - 30;
  d1 date := private.today_ist();
  v_erp numeric; v_tally numeric; v_lines numeric; r record;
begin
  select coalesce(sum(amount), 0) into v_erp from public.receipts
   where deleted_at is null and status not in ('cancelled', 'bounced') and collected_on between d0 and d1;
  if v_erp = 0 then raise exception 'test needs ERP receipts'; end if;
  if (select sum(amount) from public.collection_lines(d0, d1) where source = 'erp') <> v_erp then
    raise exception 'erp total % vs %', (select sum(amount) from public.collection_lines(d0, d1) where source = 'erp'), v_erp;
  end if;

  -- Tally side: debtor receipts in the window minus the ones matched to ERP receipts.
  select amt into v_tally from expect_tally;
  if v_tally = 0 then raise exception 'test needs unmatched Tally receipts'; end if;
  if (select coalesce(sum(amount), 0) from public.collection_lines(d0, d1) where source = 'tally') <> v_tally then
    raise exception 'tally total';
  end if;
  -- TR/3 (Ram's 1,500 line) is matched to the UPI receipt, so it must not appear on the Tally side.
  if exists (select 1 from public.collection_lines(d0, d1) l where l.source = 'tally' and l.ledger_key = 'ram kirana'
               and l.collected_on = private.today_ist() - 10) then
    raise exception 'matched Tally receipt counted twice';
  end if;
  -- Beat is carried for ERP customers.
  if exists (select 1 from public.collection_lines(d0, d1) where source = 'erp' and customer_name = 'Ram Kirana' and beat_name is distinct from 'Lonar') then
    raise exception 'beat missing';
  end if;

  select * into r from public.collector_board(d1, d0) where collector_name = 'Collector Eight';
  if r.collected_today <> (select sum(amount) from public.receipts x join public.app_users u on u.id = x.collected_by
                            where u.full_name = 'Collector Eight' and x.collected_on = d1 and x.deleted_at is null
                              and x.status not in ('cancelled', 'bounced')) then
    raise exception 'board today %', r.collected_today;
  end if;
  if (r.promises_today, r.promises_today_amount) is distinct from (select (count(*), sum(pr.amount)) from public.promises pr
        join public.app_users u on u.id = pr.made_to where u.full_name = 'Collector Eight' and pr.promise_date = d1 and pr.status = 'open') then raise exception 'board promises %', r; end if;
  if r.collection_beats <> array['Lonar'] or r.beats_outstanding <= 0 then raise exception 'board beats %', r; end if;
  if r.cash_in_hand <> (select coalesce(sum(amount), 0) from public.receipts x join public.app_users u on u.id = x.collected_by
                         where u.full_name = 'Collector Eight' and x.mode = 'cash' and x.status = 'recorded' and x.deleted_at is null) then
    raise exception 'board cash in hand';
  end if;
  if exists (select 1 from public.collection_lines(d0, d0 + 500)) then raise exception 'over-long range returned rows'; end if;
  if exists (select 1 from public.collection_lines(d1, d0)) then raise exception 'reversed range returned rows'; end if;
end;
$$;

-- A salesman sees nothing.
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  if exists (select 1 from public.collection_lines(private.today_ist() - 30, private.today_ist()))
     or exists (select 1 from public.collector_board(private.today_ist(), private.today_ist() - 30)) then
    raise exception 'salesman saw the dashboard';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
