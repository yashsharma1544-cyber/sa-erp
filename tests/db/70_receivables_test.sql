-- Receivables: snapshot + later vouchers, newest-bills-first spreading,
-- "older than records" remainder, split receipts, buckets, overdue,
-- non-customers left out, firm/beat access, DSO.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set sm_auth    '00000000-0000-0000-0000-00000000e002'

-- Current and previous FY companies for Sushil (ids unique to this test).
insert into tally.companies (id, name, fy_start_date, fy_end_date, updated_at) values
  ('00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', private.today_ist() - 200, private.today_ist() + 165, now()),
  ('00000000-0000-0000-0000-0000000e0c00', 'SUSHIL AGENCIES PREV', private.today_ist() - 565, private.today_ist() - 201, now());

-- Snapshot 3 days ago (negative closing = owes us).
insert into tally.ledger_balances (id, company_id, company_name, ledger_name, root_group, closing_balance, as_on_date, last_seen_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Ram Kirana',      'Sundry Debtors', -1500, private.today_ist() - 3, now() - interval '3 days', now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Old Party',       'Sundry Debtors',  -900, private.today_ist() - 3, now() - interval '3 days', now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Shyam Stores',    'Sundry Debtors',   200, private.today_ist() - 3, now() - interval '3 days', now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Phone Pay Sales', 'Sundry Debtors',  -300, private.today_ist() - 3, now() - interval '3 days', now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'HDFC Bank',       'Bank Accounts', -99999, private.today_ist() - 3, now() - interval '3 days', now()),
  -- an older snapshot that must be ignored
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'Ram Kirana',      'Sundry Debtors', -7777, private.today_ist() - 9, now() - interval '9 days', now());

insert into tally.vouchers (id, company_id, company_name, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, first_seen_at, updated_at) values
  -- before the snapshot (already inside the Tally balance)
  ('00000000-0000-0000-0000-0000000e0a01', '00000000-0000-0000-0000-0000000e0c00', 'SUSHIL AGENCIES PREV', 'sales', 'P/1', private.today_ist() - 300, 'Ram Kirana', 500,  false, now() - interval '300 days', now()),
  ('00000000-0000-0000-0000-0000000e0a02', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'sales', 'S/1', private.today_ist() - 70,  'Ram Kirana', 1000, false, now() - interval '70 days', now()),
  ('00000000-0000-0000-0000-0000000e0a03', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'sales', 'S/2', private.today_ist() - 20,  'Ram  Kirana', 800, false, now() - interval '20 days', now()),
  ('00000000-0000-0000-0000-0000000e0a04', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'sales', 'S/3', private.today_ist() - 10,  'Old Party',  300,  false, now() - interval '10 days', now()),
  ('00000000-0000-0000-0000-0000000e0a09', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'sales', 'S/9', private.today_ist() - 5,   'Ram Kirana', 999,  true,  now() - interval '5 days', now()),
  -- after the snapshot
  ('00000000-0000-0000-0000-0000000e0a05', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'sales',   'S/4', private.today_ist() - 1, 'Ram Kirana', 400, false, now(), now()),
  ('00000000-0000-0000-0000-0000000e0a06', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'receipt', 'R/1', private.today_ist() - 1, 'Ram Kirana', 100, false, now(), now()),
  ('00000000-0000-0000-0000-0000000e0a07', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR',  'receipt', 'R/2', private.today_ist(),     'Ram Kirana', 250, false, now(), now());
-- R/2 is one receipt paying two parties.
insert into tally.voucher_allocations (id, voucher_id, seq, party_name, amount, created_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0a07', 1, 'Ram Kirana', 150, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0a07', 2, 'Old Party',  100, now());

-- ERP customer for Ram (ledger name stored with different spacing), 30 days credit.
insert into public.customers (id, name, beat_id)
  select '00000000-0000-0000-0000-0000000e0b01', 'Ram Kirana', b.id from public.beats b where b.name = 'Lonar';
insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name, credit_days)
  select '00000000-0000-0000-0000-0000000e0b01', f.id, 'Ram  Kirana', 30 from public.firms f where f.code = 'SA';

select tally.refresh_receivables();

do $$
declare
  sa uuid := (select id from public.firms where code = 'SA');
  r record;
begin
  -- Ram: 1500 + 400 − 100 − 150 = 1650
  select * into r from tally.mv_ar_balances where firm_id = sa and nm = 'ram kirana';
  if r.balance <> 1650 then raise exception 'Ram balance %', r.balance; end if;
  if r.customer_id <> '00000000-0000-0000-0000-0000000e0b01' then raise exception 'Ram not linked to customer'; end if;
  if r.tally_balance <> 1500 then raise exception 'used the wrong snapshot: %', r.tally_balance; end if;
  -- Old Party: 900 − 100 = 800
  if (select balance from tally.mv_ar_balances where firm_id = sa and nm = 'old party') <> 800 then raise exception 'Old Party balance'; end if;
  if (select balance from tally.mv_ar_balances where firm_id = sa and nm = 'shyam stores') <> -200 then raise exception 'advance balance'; end if;
  if exists (select 1 from tally.mv_ar_balances where nm in ('phone pay sales', 'hdfc bank')) then raise exception 'non-debtors included'; end if;

  -- Ram's bills, newest first: 400 + 800 + 450 of the 1000; the voided bill and the old-FY bill are paid/ignored.
  if (select string_agg(bill_no || '=' || pending, ',' order by bill_date desc) from tally.mv_ar_bills where firm_id = sa and nm = 'ram kirana')
     <> 'S/4=400.00,S/2=800.00,S/1=450.00' then
    raise exception 'Ram bills: %', (select string_agg(bill_no || '=' || pending, ',' order by bill_date desc) from tally.mv_ar_bills where firm_id = sa and nm = 'ram kirana');
  end if;
  -- Old Party: 300 bill + 500 older than records
  if (select pending from tally.mv_ar_bills where firm_id = sa and nm = 'old party' and bill_key = 'older') <> 500 then raise exception 'older remainder'; end if;
  if exists (select 1 from tally.mv_ar_bills where nm = 'shyam stores') then raise exception 'advance should have no bills'; end if;
end;
$$;

-- Owner sees buckets and overdue; a salesman only sees customers in his beats.
insert into auth.users (id, email) values (:'owner_auth', 'own7@example.com'), (:'sm_auth', 'sm7@field.invalid');
select private.bootstrap_owner('own7@example.com', 'Owner Seven');
insert into public.app_users (full_name, login_kind, auth_user_id) values ('Salesman Seven', 'pin', :'sm_auth');
insert into public.user_roles (user_id, role) select id, 'salesman' from public.app_users where full_name = 'Salesman Seven';
insert into public.user_firms (user_id, firm_id)
  select u.id, f.id from public.app_users u, public.firms f where u.full_name = 'Salesman Seven' and f.code = 'SA';
insert into public.user_beats (user_id, beat_id, purpose)
  select u.id, b.id, 'sales' from public.app_users u, public.beats b where u.full_name = 'Salesman Seven' and b.name = 'Mehkar';

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare r record; d record;
begin
  select * into r from public.v_ar_customers where ledger_key = 'ram kirana';
  if r.customer_name <> 'Ram Kirana' or r.beat_name <> 'Lonar' then raise exception 'customer details missing'; end if;
  if (r.b0_15, r.b16_30, r.b31_45, r.b46_60, r.b60_plus) <> (400.00, 800.00, 0.00, 0.00, 450.00) then
    raise exception 'Ram buckets %', row(r.b0_15, r.b16_30, r.b31_45, r.b46_60, r.b60_plus);
  end if;
  if r.overdue <> 450 then raise exception 'Ram overdue % (30 days credit)', r.overdue; end if;
  if r.open_bills <> 3 then raise exception 'Ram open bills %', r.open_bills; end if;
  if (select b60_plus from public.v_ar_customers where ledger_key = 'old party') <> 500 then raise exception 'older remainder must age 60+'; end if;
  if (select bucket from public.v_ar_bills where ledger_key = 'ram kirana' and bill_no = 'S/1') <> '60+' then raise exception 'bucket label'; end if;

  select * into d from public.ar_dso((select id from public.firms where code = 'SA'), private.today_ist() - 29, private.today_ist());
  -- credit sales in 30 days to debtor ledgers: S/2 800 + S/3 300 + S/4 400 = 1500
  if d.credit_sales < 1500 or d.days <> 30 or d.dso is null then raise exception 'dso %', row(d.outstanding, d.credit_sales, d.days, d.dso); end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  if exists (select 1 from public.v_ar_customers where ledger_key = 'ram kirana') then
    raise exception 'salesman sees a customer outside his beats';
  end if;
  if exists (select 1 from public.ar_dso((select id from public.firms where code = 'SA'), private.today_ist() - 29, private.today_ist())) then
    raise exception 'field user got DSO';
  end if;
  begin
    perform 1 from tally.mv_ar_balances limit 1;
    raise exception 'field user read the raw mirror';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
