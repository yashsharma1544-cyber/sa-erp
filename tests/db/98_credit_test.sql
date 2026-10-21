-- Credit check, bulk credit terms and the Rupyz order approval queue.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set sm_auth    '00000000-0000-0000-0000-00000000e002'
\set col_auth   '00000000-0000-0000-0000-00000000f001'
\set acct_auth  '00000000-0000-0000-0000-00000000f009'
\set adm_auth   '00000000-0000-0000-0000-0000000c0001'

-- Credit Party: Tally says 1,500 (bills 40 days 1,000 and 10 days 500).
insert into tally.ledger_balances (id, company_id, company_name, ledger_name, root_group, closing_balance, as_on_date, last_seen_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Credit Party', 'Sundry Debtors', -1500, private.today_ist() - 3, now() - interval '3 days', now());
insert into tally.vouchers (id, company_id, company_name, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, first_seen_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'CP/1', private.today_ist() - 40, 'Credit Party', 1000, false, now() - interval '40 days', now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'CP/2', private.today_ist() - 10, 'Credit Party', 500,  false, now() - interval '10 days', now());
insert into public.customers (id, name, beat_id)
  select '00000000-0000-0000-0000-0000000c0b01', 'Credit Party', b.id from public.beats b where b.name = 'Lonar';
insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name)
  select '00000000-0000-0000-0000-0000000c0b01', f.id, 'Credit Party' from public.firms f where f.code = 'SA';
select tally.refresh_receivables();

insert into auth.users (id, email) values (:'adm_auth', 'adm9@example.com');
insert into public.app_users (full_name, email, login_kind, auth_user_id) values ('Sales Admin Nine', 'adm9@example.com', 'email', :'adm_auth');
insert into public.user_roles (user_id, role) select id, 'sales_admin' from public.app_users where full_name = 'Sales Admin Nine';
insert into public.user_firms (user_id, firm_id)
  select u.id, f.id from public.app_users u, public.firms f where u.full_name = 'Sales Admin Nine';

set role authenticated;

-- No terms yet: passes, flagged as not set. A salesman outside the beat cannot check.
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); cp uuid := '00000000-0000-0000-0000-0000000c0b01'; r jsonb;
begin
  r := public.credit_check(sa, cp, 400);
  if not (r ->> 'ok')::boolean or (r ->> 'terms_set')::boolean or (r ->> 'outstanding')::numeric <> 1500 then
    raise exception 'unset terms: %', r;
  end if;
  begin
    perform public.set_credit_terms(sa, array[cp], 2000, 30);
    raise exception 'accounts set credit terms';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  perform public.credit_check((select id from public.firms where code = 'SA'), '00000000-0000-0000-0000-0000000c0b01', 400);
  raise exception 'salesman checked a customer outside his beats';
exception when insufficient_privilege then null;
end;
$$;

-- Owner sets 2,000 / 30 days in bulk (one existing account + one customer without an AA account).
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); aa uuid := (select id from public.firms where code = 'AA');
        cp uuid := '00000000-0000-0000-0000-0000000c0b01'; r jsonb;
begin
  if public.set_credit_terms(sa, array[cp], 2000, 30) <> 1 then raise exception 'bulk set count'; end if;
  if public.set_credit_terms(sa, array[cp], 2000, 30) <> 0 then raise exception 'unchanged rows counted'; end if;
  if public.set_credit_terms(aa, array[cp], null, 15) <> 1 then raise exception 'AA account not opened'; end if;
  if (select credit_days from public.customer_firm_accounts where customer_id = cp and firm_id = aa) <> 15 then raise exception 'AA days'; end if;
  begin
    perform public.set_credit_terms(sa, array[cp], null, null);
    raise exception 'empty terms accepted';
  exception when check_violation then null;
  end;
  if (select credit_limit from public.credit_terms_list(sa) where customer_id = cp) <> 2000 then raise exception 'terms list'; end if;

  -- 1,500 + 400 is inside 2,000, but the 40-day bill is past 30 days.
  r := public.credit_check(sa, cp, 400);
  if (r ->> 'ok')::boolean or r -> 'reasons' -> 0 ->> 'code' <> 'overdue' or jsonb_array_length(r -> 'reasons') <> 1 then
    raise exception 'overdue: %', r;
  end if;
  -- Grace of 15 days lets it through.
  update public.app_settings set value = '15'::jsonb where key = 'credit_grace_days';
  if not (public.credit_check(sa, cp, 400) ->> 'ok')::boolean then raise exception 'grace ignored'; end if;
  update public.app_settings set value = '0'::jsonb where key = 'credit_grace_days';
  -- Counter cash sale skips everything.
  if not (public.credit_check(sa, cp, 99999, 'counter_cash') ->> 'skipped')::boolean then raise exception 'counter skip'; end if;
end;
$$;

-- A ₹1,000 cash receipt not yet in Tally pays the 40-day bill.
select set_config('request.jwt.claim.sub', :'col_auth', false);
select public.record_collection(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000c0d01', 'kind', 'receipt',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000c0b01',
  'amount', '1000', 'mode', 'cash'));
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); cp uuid := '00000000-0000-0000-0000-0000000c0b01'; r jsonb;
begin
  r := public.credit_check(sa, cp, 400);
  if not (r ->> 'ok')::boolean or (r ->> 'outstanding')::numeric <> 500 or r ->> 'oldest_bill_no' <> 'CP/2' then
    raise exception 'after receipt: %', r;
  end if;
  r := public.credit_check(sa, cp, 1600);
  if r -> 'reasons' -> 0 ->> 'code' <> 'over_limit' then raise exception 'over limit: %', r; end if;
end;
$$;

-- Only the feed (no signed-in user) or the owner may load Rupyz orders.
select set_config('request.jwt.claim.sub', :'adm_auth', false);
do $$
begin
  perform public.intake_rupyz_orders('[]'::jsonb);
  raise exception 'sales admin loaded orders';
exception when insufficient_privilege then null;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare r jsonb; o text := $j$[
  {"order_id": "RZ-1", "order_no": "SO/1", "order_date": "2026-10-20", "customer_id": "77", "customer_name": "CREDIT  PARTY",
   "salesman_name": "Akshay", "total_amount": 1600, "items": [{"name": "Tea 1kg", "qty": 4}]},
  {"order_id": "RZ-2", "order_date": "2026-10-20", "customer_id": "78", "customer_name": "Unknown Shop", "total_amount": 300},
  {"order_id": "RZ-3", "order_date": "2026-10-20", "customer_id": "77", "customer_name": "Credit Party", "total_amount": 100}
]$j$;
begin
  r := public.intake_rupyz_orders(o::jsonb);
  if r <> '{"held": 1, "unmapped": 1, "cleared": 1, "new": 3}'::jsonb then raise exception 'intake: %', r; end if;
  -- Same feed again: nothing new, no second approval request.
  r := public.intake_rupyz_orders(o::jsonb);
  if r <> '{"new": 0}'::jsonb then raise exception 'second intake: %', r; end if;
  if (select count(*) from public.approval_requests where subject_table = 'rupyz_orders') <> 1 then raise exception 'approval count'; end if;
  if (select requested_by is null and kind = 'order' and permission_key = 'order.approve' and reason like '%over the limit%'
        from public.approval_requests where subject_table = 'rupyz_orders') is not true then
    raise exception 'approval row: %', (select row_to_json(a) from public.approval_requests a where subject_table = 'rupyz_orders');
  end if;
end;
$$;

-- Sales admin approves the held order; the order follows the decision.
set role authenticated;
select set_config('request.jwt.claim.sub', :'adm_auth', false);
do $$
begin
  perform public.decide_approval((select approval_request_id from public.rupyz_orders where rupyz_order_id = 'RZ-1'), true, 'Regular buyer');
  if (select status from public.rupyz_orders where rupyz_order_id = 'RZ-1') <> 'approved' then raise exception 'order not approved'; end if;
end;
$$;

-- Bad debt: only the owner may approve, and linking the unknown shop rechecks its order.
select set_config('request.jwt.claim.sub', :'owner_auth', false);
update public.customers set status = 'bad_debt', status_note = 'Test' where id = '00000000-0000-0000-0000-0000000c0b01';
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.intake_rupyz_orders('[{"order_id": "RZ-4", "order_date": "2026-10-21", "customer_id": "77", "customer_name": "Credit Party", "total_amount": 50}]'::jsonb);
set role authenticated;
select set_config('request.jwt.claim.sub', :'adm_auth', false);
do $$
declare a uuid := (select approval_request_id from public.rupyz_orders where rupyz_order_id = 'RZ-4');
begin
  if not (select is_bad_debt from public.approval_requests where id = a) then raise exception 'bad debt not flagged'; end if;
  begin
    perform public.decide_approval(a, true);
    raise exception 'sales admin approved for bad debt';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare
  o2 uuid := (select id from public.rupyz_orders where rupyz_order_id = 'RZ-2');
begin
  if public.link_rupyz_customer(o2, '00000000-0000-0000-0000-0000000c0b01') <> 1 then raise exception 'link count'; end if;
  if (select status from public.rupyz_orders where id = o2) <> 'held' then raise exception 'linked order not rechecked'; end if;
  if not exists (select 1 from public.customer_aliases where source = 'rupyz' and external_id = '78') then raise exception 'alias'; end if;
  -- Back to active: recheck clears the small orders and cancels their requests.
  update public.customers set status = 'active', status_note = null where id = '00000000-0000-0000-0000-0000000c0b01';
  if public.recheck_rupyz_orders() <> '{"cleared": 2}'::jsonb then raise exception 'recheck: %', public.recheck_rupyz_orders(); end if;
  if exists (select 1 from public.approval_requests where subject_table = 'rupyz_orders' and status = 'pending') then
    raise exception 'stale approval left pending';
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
