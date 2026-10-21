-- WhatsApp queue: receipt messages, opt-out, reminder ladder, promise day,
-- promise closing, public receipt page.
\set col_auth  '00000000-0000-0000-0000-00000000f001'
\set acct_auth '00000000-0000-0000-0000-00000000f009'

update public.customers set whatsapp = '9822011111' where id = '00000000-0000-0000-0000-0000000e0b01';
-- A second shop for the "Old Party" ledger: ₹300 due on a 10-day-old bill after test 95's Tally receipt.
insert into public.customers (id, name, beat_id, whatsapp)
  select '00000000-0000-0000-0000-0000000e0b02', 'Old Party Shop', b.id, '9822033333' from public.beats b where b.name = 'Lonar';
insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name, credit_days)
  select '00000000-0000-0000-0000-0000000e0b02', id, 'Old Party', 0 from public.firms where code = 'SA';
select tally.refresh_receivables();

set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);
-- Template not approved yet: nothing is queued.
select public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b01', 'amount', '50', 'mode', 'cash'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if exists (select 1 from public.wa_messages) then raise exception 'queued before the template was approved'; end if;
end $$;

update public.wa_templates set approved = true, active = true, wati_template_name = 'sa_receipt_mr' where key = 'receipt';
set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);
select public.record_collection(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000aa001', 'kind', 'receipt',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b01', 'amount', '75', 'mode', 'cash'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$
declare m public.wa_messages;
begin
  select * into m from public.wa_messages where template_key = 'receipt';
  if m.to_number <> '919822011111' or (m.data ->> 'amount')::numeric <> 75 or m.data ->> 'customer_name' <> 'Ram Kirana' then
    raise exception 'receipt message: %', row(m.*);
  end if;
  if m.data ->> 'token' <> (select public_token::text from public.receipts where client_op_id = '00000000-0000-0000-0000-0000000aa001') then
    raise exception 'link token';
  end if;
  -- The public page finds the receipt by its token only.
  if (select amount from public.receipt_by_token((m.data ->> 'token')::uuid)) <> 75 then raise exception 'receipt page'; end if;
  if exists (select 1 from public.receipt_by_token(gen_random_uuid())) then raise exception 'random token found a receipt'; end if;
end;
$$;
do $$
begin
  if has_function_privilege('anon', 'public.receipt_by_token(uuid)', 'execute') then raise exception 'anon can call receipt_by_token'; end if;
  if has_function_privilege('authenticated', 'public.wa_queue_reminders()', 'execute') then raise exception 'users can queue reminders'; end if;
end;
$$;

-- Opted out: no message.
update public.customers set wa_opt_out = true where id = '00000000-0000-0000-0000-0000000e0b01';
set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);
select public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'receipt',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b01', 'amount', '20', 'mode', 'cash'));
reset role;
select set_config('request.jwt.claim.sub', '', false);
do $$ begin
  if (select count(*) from public.wa_messages where template_key = 'receipt') <> 1 then raise exception 'opted-out customer messaged'; end if;
end $$;

-- Reminder ladder: 7 and 30 days on, the 60-day rule's template isn't approved.
update public.wa_templates set approved = true, active = true, wati_template_name = 'sa_reminder_mr' where key = 'reminder';
update public.reminder_rules set active = true;
do $$
declare r jsonb; m public.wa_messages;
begin
  r := public.wa_queue_reminders();
  -- Ram paid this week (skipped); Old Party Shop owes 300 on a 10-day-old bill → the 7-day rung.
  if (r ->> 'reminders')::int <> 1 then raise exception 'reminders: %', r; end if;
  select * into m from public.wa_messages where template_key = 'reminder';
  if m.customer_id <> '00000000-0000-0000-0000-0000000e0b02' or (m.data ->> 'days')::int <> 7 or (m.data ->> 'outstanding')::numeric <> 300 then
    raise exception 'reminder message: %', row(m.*);
  end if;
  if (public.wa_queue_reminders() ->> 'reminders')::int <> 0 then raise exception 'reminded twice'; end if;
end;
$$;

-- Promise due today → promise reminder; a promise that passed unpaid → broken.
update public.wa_templates set approved = true, active = true, wati_template_name = 'sa_promise_mr' where key = 'promise_due';
set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);
select public.record_collection(jsonb_build_object('client_op_id', gen_random_uuid(), 'kind', 'promise',
  'firm_id', (select id from public.firms where code = 'SA'), 'customer_id', '00000000-0000-0000-0000-0000000e0b02',
  'amount', '400', 'promise_date', private.today_ist()));
reset role;
select set_config('request.jwt.claim.sub', '', false);
insert into public.promises (firm_id, customer_id, promise_date, amount, made_to, client_op_id, created_at)
  select f.id, '00000000-0000-0000-0000-0000000e0b02', private.today_ist() - 2, 300, u.id, gen_random_uuid(), now() - interval '5 days'
    from public.firms f, public.app_users u where f.code = 'SA' and u.full_name = 'Collector Eight';
do $$
declare r jsonb;
begin
  r := public.wa_queue_reminders();
  if (r ->> 'promises')::int <> 1 then raise exception 'promise reminders: %', r; end if;
  if public.close_due_promises() <> 1 then raise exception 'past promise not closed'; end if;
  if (select status from public.promises where promise_date = private.today_ist() - 2) <> 'broken' then raise exception 'promise should be broken'; end if;
  if (select status from public.promises where promise_date = private.today_ist()) <> 'open' then raise exception 'today''s promise closed too early'; end if;
end;
$$;

-- Sending: the sender marks the result; office can retry a failure.
do $$
declare v_id uuid := (select id from public.wa_messages where template_key = 'receipt');
begin
  perform public.wa_mark(v_id, 'failed', null, 'WATi 401');
  if (select attempts from public.wa_messages where wa_messages.id = v_id) <> 1 then raise exception 'attempts'; end if;
end;
$$;
set role authenticated;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
begin
  perform public.wa_retry((select id from public.wa_messages where template_key = 'receipt'));
  if (select status from public.wa_messages where template_key = 'receipt') <> 'queued' then raise exception 'retry'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
