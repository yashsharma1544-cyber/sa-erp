-- Field collections on top of the receivables test data (Ram Kirana, Lonar,
-- SA bills S/1 450 · S/2 800 · S/4 400 pending).
\set col_auth   '00000000-0000-0000-0000-00000000f001'
\set other_auth '00000000-0000-0000-0000-00000000f002'
\set op1 '00000000-0000-0000-0000-0000000f0001'

insert into auth.users (id, email) values (:'col_auth', 'col8@field.invalid'), (:'other_auth', 'oth8@field.invalid');
insert into public.app_users (full_name, login_kind, auth_user_id) values ('Collector Eight', 'pin', :'col_auth'), ('Collector Other', 'pin', :'other_auth');
insert into public.user_roles (user_id, role) select id, 'collector' from public.app_users where full_name in ('Collector Eight', 'Collector Other');
insert into public.user_firms (user_id, firm_id)
  select u.id, f.id from public.app_users u, public.firms f where u.full_name in ('Collector Eight', 'Collector Other') and f.code = 'SA';
-- Eight collects in Lonar; Other only has Lonar as a *sales* beat.
insert into public.user_beats (user_id, beat_id, purpose)
  select u.id, b.id, 'collection' from public.app_users u, public.beats b where u.full_name = 'Collector Eight' and b.name = 'Lonar'
  union all
  select u.id, b.id, 'sales' from public.app_users u, public.beats b where u.full_name = 'Collector Other' and b.name = 'Lonar';

set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);

do $$
declare
  sa uuid := (select id from public.firms where code = 'SA');
  ram uuid := '00000000-0000-0000-0000-0000000e0b01';
  r jsonb;
  r2 jsonb;
begin
  r := public.record_collection(jsonb_build_object(
    'client_op_id', '00000000-0000-0000-0000-0000000f0001', 'kind', 'receipt', 'firm_id', sa, 'customer_id', ram,
    'amount', '500', 'mode', 'cash', 'lat', '19.84', 'lng', '75.88'));
  if r ->> 'status' <> 'created' or r ->> 'receipt_no' not like 'SA/R/%/00001' then raise exception 'receipt: %', r; end if;

  -- Oldest bill first: S/1 450, then 50 of S/2.
  if (select string_agg(bill_no || '=' || amount, ',' order by bill_date) from public.receipt_allocations
       where receipt_id = (r ->> 'id')::uuid) <> 'S/1=450.00,S/2=50.00' then
    raise exception 'allocation: %', (select string_agg(coalesce(bill_no, 'on account') || '=' || amount, ',') from public.receipt_allocations where receipt_id = (r ->> 'id')::uuid);
  end if;

  -- The offline queue resends: same receipt back, nothing new.
  r2 := public.record_collection(jsonb_build_object(
    'client_op_id', '00000000-0000-0000-0000-0000000f0001', 'kind', 'receipt', 'firm_id', sa, 'customer_id', ram,
    'amount', '500', 'mode', 'cash'));
  if r2 ->> 'status' <> 'duplicate' or r2 ->> 'id' <> r ->> 'id' then raise exception 'resend: %', r2; end if;
  if (select count(*) from public.receipts) <> 1 then raise exception 'resend created a second receipt'; end if;

  -- A second receipt skips what the first already settled: S/2 750 left, then S/4.
  r := public.record_collection(jsonb_build_object(
    'client_op_id', gen_random_uuid(), 'kind', 'receipt', 'firm_id', sa, 'customer_id', ram,
    'amount', '2000', 'mode', 'upi', 'upi_ref', 'UTR123'));
  if (select string_agg(coalesce(bill_no, 'on account') || '=' || amount, ',' order by bill_date nulls last) from public.receipt_allocations
       where receipt_id = (r ->> 'id')::uuid) <> 'S/2=750.00,S/4=400.00,on account=850.00' then
    raise exception 'second allocation: %', (select string_agg(coalesce(bill_no, 'on account') || '=' || amount, ',' order by bill_date nulls last) from public.receipt_allocations where receipt_id = (r ->> 'id')::uuid);
  end if;
  if r ->> 'receipt_no' not like '%/00002' then raise exception 'numbering: %', r; end if;

  begin
    perform public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt', 'firm_id', sa,
      'customer_id', ram, 'amount', '100', 'mode', 'upi'));
    raise exception 'UPI without reference accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt', 'firm_id', sa,
      'customer_id', ram, 'amount', '100', 'mode', 'cheque', 'cheque_no', '1234', 'cheque_date', private.today_ist(), 'cheque_bank', 'SBI'));
    raise exception 'cheque without photo accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt', 'firm_id', sa,
      'customer_id', ram, 'amount', '100', 'mode', 'cash', 'happened_at', now() - interval '9 days'));
    raise exception 'old entry accepted';
  exception when check_violation then null;
  end;

  r := public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'promise', 'firm_id', sa,
    'customer_id', ram, 'amount', '1000', 'promise_date', private.today_ist() + 3));
  if r ->> 'status' <> 'created' then raise exception 'promise: %', r; end if;
  begin
    perform public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'promise', 'firm_id', sa,
      'customer_id', ram, 'amount', '1000', 'promise_date', private.today_ist() - 1));
    raise exception 'promise in the past accepted';
  exception when check_violation then null;
  end;

  r := public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'visit',
    'customer_id', ram, 'outcome', 'not_available', 'note', 'Shop shut'));
  if r ->> 'kind' <> 'visit' then raise exception 'visit: %', r; end if;

  -- Day list for Lonar.
  if not exists (select 1 from public.field_collect_list((select id from public.beats where name = 'Lonar')) l
                  where l.customer_id = ram and l.erp_collected_since_snapshot = 2500 and l.open_promise_amount = 1000
                    and l.visited_today = 'not_available') then
    raise exception 'day list: %', (select json_agg(l) from public.field_collect_list((select id from public.beats where name = 'Lonar')) l);
  end if;
  if (select count(*) from public.field_customer_bills(ram, sa)) <> 3 then raise exception 'collector cannot see bills'; end if;
  if (select count(*) from public.receipts) <> 2 then raise exception 'collector should see own receipts'; end if;

  begin
    insert into public.receipts (firm_id, customer_id, receipt_no, collected_on, collected_at, collected_by, mode, amount, client_op_id)
    values (sa, ram, 'X', current_date, now(), private.current_app_user_id(), 'cash', 1, gen_random_uuid());
    raise exception 'direct insert allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- A collector without Lonar as a collection beat can't collect there or see the list.
select set_config('request.jwt.claim.sub', :'other_auth', false);
do $$
begin
  begin
    perform public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt',
      'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b01',
      'amount', '100', 'mode', 'cash'));
    raise exception 'collected outside collection beats';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.field_collect_list((select id from public.beats where name = 'Lonar'))) then
    raise exception 'list shown outside collection beats';
  end if;
  if exists (select 1 from public.receipts) then raise exception 'sees another collector''s receipts'; end if;
end;
$$;
reset role;
