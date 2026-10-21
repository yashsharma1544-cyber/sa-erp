-- Cash handover and deposit, on top of test 80 (Collector Eight has one SA
-- cash receipt of 500 and one UPI receipt of 2,000).
\set col_auth  '00000000-0000-0000-0000-00000000f001'
\set acct_auth '00000000-0000-0000-0000-00000000f009'

insert into auth.users (id, email) values (:'acct_auth', 'acct9@example.com');
insert into public.app_users (full_name, email, login_kind, auth_user_id) values ('Accounts Nine', 'acct9@example.com', 'email', :'acct_auth');
insert into public.user_roles (user_id, role) select id, 'accounts' from public.app_users where full_name = 'Accounts Nine';
insert into public.user_firms (user_id, firm_id) select u.id, f.id from public.app_users u, public.firms f where u.full_name = 'Accounts Nine';
insert into public.bank_accounts (firm_id, bank, account_last4) select id, 'HDFC Bank', '4303' from public.firms where code = 'SA';
insert into public.bank_accounts (firm_id, bank, account_last4) select id, 'HDFC Bank', '9999' from public.firms where code = 'AA';

set role authenticated;

-- 1. The collector hands over: only cash, only what isn't handed over yet.
select set_config('request.jwt.claim.sub', :'col_auth', false);
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.submit_handover(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000c0001', 'declared', jsonb_build_object('500', 1)));
  if r ->> 'status' <> 'created' or (r ->> 'expected')::numeric <> 500 or (r ->> 'receipts')::int <> 1 then raise exception 'handover: %', r; end if;
  r2 := public.submit_handover(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000c0001'));
  if r2 ->> 'status' <> 'duplicate' then raise exception 'resend should return the same handover: %', r2; end if;
  if (select status from public.receipts where mode = 'cash') <> 'handed_over' then raise exception 'receipt not marked handed over'; end if;
  if (select status from public.receipts where mode = 'upi') <> 'recorded' then raise exception 'UPI must not be handed over'; end if;
  begin
    perform public.submit_handover('{}'::jsonb);
    raise exception 'second handover with no cash accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.accept_handover((r ->> 'id')::uuid, '{"500": 1}'::jsonb);
    raise exception 'collector counted their own cash';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.cash_handovers) <> 1 then raise exception 'collector should see their handover'; end if;
end;
$$;

-- 2. Accounts counts 450 against 500: needs a note, then the collector is 50 short.
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare h uuid := (select id from public.cash_handovers limit 1); r jsonb; p record;
begin
  begin
    perform public.accept_handover(h, '{"200": 2, "coins": 50}'::jsonb);
    raise exception 'a short count without a note was accepted';
  exception when check_violation then null;
  end;
  begin
    perform public.accept_handover(h, '{"500": "x"}'::jsonb, 'bad');
    raise exception 'bad note count accepted';
  exception when check_violation then null;
  end;
  r := public.accept_handover(h, '{"200": 2, "coins": 50}'::jsonb, 'One ₹50 note missing');
  if (r ->> 'variance')::numeric <> -50 then raise exception 'variance: %', r; end if;
  if (select variance from public.cash_handovers where id = h) <> -50 then raise exception 'stored variance'; end if;
  if (select status from public.receipts where mode = 'cash') <> 'counted' then raise exception 'receipt not counted'; end if;

  select * into p from public.cash_position() where collector_name = 'Collector Eight';
  if p.short_excess <> -50 or p.in_hand <> 0 or p.handovers_counted <> 1 then raise exception 'position: %', row(p.*); end if;
end;
$$;

-- 3. Deposit the counted SA cash: slip 450 against 500 receipts → −50.
do $$
declare
  sa uuid := (select id from public.firms where code = 'SA');
  aa uuid := (select id from public.firms where code = 'AA');
  rid uuid := (select id from public.receipts where mode = 'cash');
  r jsonb;
begin
  begin
    perform public.record_deposit(jsonb_build_object('firm_id', sa, 'bank_account_id', (select id from public.bank_accounts where firm_id = aa),
      'deposited_on', private.today_ist(), 'amount', 450, 'receipt_ids', jsonb_build_array(rid)));
    raise exception 'deposited into another firm''s bank';
  exception when check_violation then null;
  end;
  begin
    perform public.record_deposit(jsonb_build_object('firm_id', aa, 'bank_account_id', (select id from public.bank_accounts where firm_id = aa),
      'deposited_on', private.today_ist(), 'amount', 450, 'receipt_ids', jsonb_build_array(rid)));
    raise exception 'SA cash deposited for AA';
  exception when check_violation then null;
  end;
  r := public.record_deposit(jsonb_build_object('firm_id', sa, 'bank_account_id', (select id from public.bank_accounts where firm_id = sa),
    'deposited_on', private.today_ist(), 'slip_no', 'S-77', 'amount', 450, 'receipt_ids', jsonb_build_array(rid)));
  if (r ->> 'variance')::numeric <> -50 then raise exception 'deposit: %', r; end if;
  if (select status from public.receipts where id = rid) <> 'deposited' then raise exception 'receipt not deposited'; end if;
  begin
    perform public.record_deposit(jsonb_build_object('firm_id', sa, 'bank_account_id', (select id from public.bank_accounts where firm_id = sa),
      'deposited_on', private.today_ist(), 'amount', 450, 'receipt_ids', jsonb_build_array(rid)));
    raise exception 'same cash deposited twice';
  exception when check_violation then null;
  end;
end;
$$;

-- 4. A new cash receipt, handed over by accounts for the collector, then cancelled.
select set_config('request.jwt.claim.sub', :'col_auth', false);
select public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b01',
  'amount', '300', 'mode', 'cash'));
do $$
begin
  if exists (select 1 from public.deposits) then raise exception 'collector sees deposits'; end if;
end;
$$;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare r jsonb; col uuid := (select id from public.app_users where full_name = 'Collector Eight');
begin
  r := public.submit_handover(jsonb_build_object('collector_id', col));
  if (r ->> 'expected')::numeric <> 300 then raise exception 'office handover: %', r; end if;
  perform public.cancel_handover((r ->> 'id')::uuid, 'Counted next day instead');
  if (select status from public.receipts where amount = 300) <> 'recorded' then raise exception 'cancel did not return the cash'; end if;
  if (select in_hand from public.cash_position() where collector_id = col) <> 300 then raise exception 'cash in hand after cancel'; end if;
  -- And it can be handed over again.
  r := public.submit_handover(jsonb_build_object('collector_id', col));
  if (r ->> 'receipts')::int <> 1 then raise exception 're-handover: %', r; end if;
end;
$$;
reset role;
