-- Masters: seed, route days, field visibility, credit and status guards.
\set owner_auth '00000000-0000-0000-0000-00000000c001'
\set acct_auth  '00000000-0000-0000-0000-00000000c002'
\set sm_auth    '00000000-0000-0000-0000-00000000c003'

do $$
begin
  if (select count(*) from public.beats where deleted_at is null) <> 22 then
    raise exception 'expected 22 seeded beats (21 + counter), got %', (select count(*) from public.beats);
  end if;
  if exists (select 1 from public.v_beats where territory_name = 'Mehkar' and route_weekday <> 2) then
    raise exception 'Mehkar beats must run Tuesday';
  end if;
  if (select route_weekday from public.beats where name = 'Lonar') <> 4 then raise exception 'Lonar must be Thursday'; end if;
  if (select route_weekday from public.beats where name = 'D Raja') <> 5 then raise exception 'D Raja must be Friday'; end if;
  if (select count(*) from public.non_customer_parties) <> 3 then raise exception 'non-customer parties not seeded'; end if;
  if (select cash_discount_pct from public.supplier_firm_accounts) <> 1.00 then raise exception 'Vikram 1%% CD missing'; end if;
  begin
    insert into public.beats (territory_id, name, route_kind) select id, 'Bad Beat', 'outstation' from public.territories limit 1;
    raise exception 'outstation beat without weekday accepted';
  exception when check_violation then null;
  end;
end $$;

insert into auth.users (id, email) values (:'owner_auth', 'own3@example.com'), (:'acct_auth', 'acct3@example.com'), (:'sm_auth', 'sm3@field.invalid');
select private.bootstrap_owner('own3@example.com', 'Owner Three');
insert into public.app_users (full_name, email, login_kind, auth_user_id) values ('Acct Three', 'acct3@example.com', 'email', :'acct_auth');
insert into public.app_users (full_name, login_kind, auth_user_id) values ('Salesman Three', 'pin', :'sm_auth');
insert into public.user_roles (user_id, role)
  select id, 'accounts'::public.app_role from public.app_users where full_name = 'Acct Three'
  union all select id, 'salesman'::public.app_role from public.app_users where full_name = 'Salesman Three';
insert into public.user_beats (user_id, beat_id, purpose)
  select u.id, b.id, 'sales' from public.app_users u, public.beats b where u.full_name = 'Salesman Three' and b.name = 'Lonar';

-- Accounts (masters.manage, no credit.manage) creates customers but cannot set credit or bad debt.
set role authenticated;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare v_lonar uuid; v_mehkar uuid;
begin
  insert into public.customers (name, beat_id) values ('Lonar Kirana', (select id from public.beats where name = 'Lonar')) returning id into v_lonar;
  insert into public.customers (name, beat_id) values ('Mehkar Traders', (select id from public.beats where name = 'Mehkar')) returning id into v_mehkar;
  insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name)
    values (v_lonar, (select id from public.firms where code = 'SA'), 'Lonar Kirana (Lonar)');
  begin
    insert into public.customer_firm_accounts (customer_id, firm_id, credit_limit) values (v_mehkar, (select id from public.firms where code = 'SA'), 50000);
    raise exception 'accounts set a credit limit';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customer_firm_accounts set credit_days = 30 where customer_id = v_lonar;
    raise exception 'accounts changed credit days';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.customers set status = 'bad_debt' where id = v_lonar;
    raise exception 'accounts marked bad debt';
  exception when insufficient_privilege then null;
  end;
  update public.customers set phone = '9800011111' where id = v_lonar; -- ordinary edit is fine
  begin
    insert into public.customers (name, whatsapp) values ('Bad Phone', '12345');
    raise exception 'invalid whatsapp accepted';
  exception when check_violation then null;
  end;
end $$;

-- Owner sets credit and status.
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
begin
  update public.customer_firm_accounts set credit_limit = 100000, credit_days = 21
   where customer_id = (select id from public.customers where name = 'Lonar Kirana');
  update public.customers set status = 'bad_debt', status_note = 'Stopped paying' where name = 'Mehkar Traders';
  if (select credit_limit from public.customer_firm_accounts where tally_ledger_name = 'Lonar Kirana (Lonar)') <> 100000 then
    raise exception 'owner credit change not saved';
  end if;
end $$;

-- Salesman sees only Lonar customers, no suppliers, but all beats and items.
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  if (select count(*) from public.customers) <> 1 then raise exception 'salesman should see 1 customer, sees %', (select count(*) from public.customers); end if;
  if (select name from public.customers) <> 'Lonar Kirana' then raise exception 'salesman sees wrong customer'; end if;
  if (select count(*) from public.customer_firm_accounts) <> 1 then raise exception 'salesman should see 1 firm account'; end if;
  if (select count(*) from public.suppliers) <> 0 then raise exception 'salesman sees suppliers'; end if;
  if (select count(*) from public.beats) <> 22 then raise exception 'salesman should see all beats'; end if;
  begin
    insert into public.customers (name) values ('Sneaky');
    raise exception 'salesman created a customer';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
