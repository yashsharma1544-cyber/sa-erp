-- Price list and orders: rates, GST per firm, credit and discount approvals,
-- idempotent submit, cancel, customer's usual items.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set sm_auth    '00000000-0000-0000-0000-00000000e002'
\set acct_auth  '00000000-0000-0000-0000-00000000f009'
\set adm_auth   '00000000-0000-0000-0000-0000000c0001'

insert into public.items (id, name, unit, kg_per_unit, gst_rate, category) values
  ('00000000-0000-0000-0000-0000000a0001', 'Test Tea 250 Gm', 'kg', 1, 5, 'tea'),
  ('00000000-0000-0000-0000-0000000a0002', 'Test Oil 1 Ltr Box', 'box', 0, 5, 'oil'),
  ('00000000-0000-0000-0000-0000000a0003', 'Test No Rate', 'kg', 1, 5, 'tea');
insert into public.customers (id, name, beat_id)
  select '00000000-0000-0000-0000-0000000a0b01', 'Mehkar Shop', b.id from public.beats b where b.name = 'Mehkar';
insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name)
  select '00000000-0000-0000-0000-0000000a0b01', f.id, 'Mehkar Shop' from public.firms f;
-- Tally history: Mehkar Shop bought the tea twice.
insert into tally.vouchers (id, company_id, company_name, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, first_seen_at, updated_at) values
  ('00000000-0000-0000-0000-0000000a0f01', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'MS/1', private.today_ist() - 20, 'Mehkar Shop', 0, false, now(), now()),
  ('00000000-0000-0000-0000-0000000a0f02', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'MS/2', private.today_ist() - 5, 'Mehkar Shop', 0, false, now(), now());
insert into public.item_aliases (item_id, source, alias_name) values ('00000000-0000-0000-0000-0000000a0001', 'tally', 'TEST TEA 250 GM');
insert into tally.voucher_lines (id, voucher_id, line_no, item_name, qty, rate, amount, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0f01', 1, 'Test Tea 250 Gm', 5, 400, 2000, now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000a0f02', 1, 'Test Tea 250 Gm', 8, 400, 3200, now(), now());

set role authenticated;

-- Rates: salesman cannot, accounts can.
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  perform public.set_prices((select id from public.firms where code = 'SA'), '[{"item_id": "00000000-0000-0000-0000-0000000a0001", "rate": 1}]');
  raise exception 'salesman set a rate';
exception when insufficient_privilege then null;
end;
$$;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); aa uuid := (select id from public.firms where code = 'AA');
begin
  if public.set_prices(sa, '[{"item_id": "00000000-0000-0000-0000-0000000a0001", "rate": 400}, {"item_id": "00000000-0000-0000-0000-0000000a0002", "rate": 1500}]') <> 2 then
    raise exception 'set prices count';
  end if;
  -- Same rate again changes nothing; a new rate the same day replaces today's row.
  if public.set_prices(sa, '[{"item_id": "00000000-0000-0000-0000-0000000a0001", "rate": 400}]') <> 0 then raise exception 'unchanged rate counted'; end if;
  perform public.set_prices(aa, '[{"item_id": "00000000-0000-0000-0000-0000000a0001", "rate": 380}]');
  perform public.set_prices(sa, '[{"item_id": "00000000-0000-0000-0000-0000000a0002", "rate": 1510}]');
  perform public.set_prices(sa, '[{"item_id": "00000000-0000-0000-0000-0000000a0002", "rate": 1500}]');
  if (select count(*) from public.price_list where item_id = '00000000-0000-0000-0000-0000000a0002') <> 1 then raise exception 'same-day rate not replaced'; end if;
  if (select rate from public.v_current_prices where firm_id = sa and item_id = '00000000-0000-0000-0000-0000000a0002') <> 1500 then raise exception 'current rate'; end if;
end;
$$;

-- Salesman (Mehkar beat) takes an order at list rates: passes, approved.
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); r jsonb; o public.orders;
begin
  begin
    perform public.create_order(jsonb_build_object('client_op_id', gen_random_uuid(), 'firm_id', sa, 'source', 'salesman',
      'customer_id', '00000000-0000-0000-0000-0000000e0b01', 'lines', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 1))));
    raise exception 'ordered for a customer outside his beats';
  exception when insufficient_privilege then null;
  end;
  r := public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000a0d01', 'firm_id', sa, 'source', 'salesman',
    'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(
      jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 10),
      jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0002', 'qty', 2))));
  select * into o from public.orders where id = (r ->> 'id')::uuid;
  if o.order_no not like 'SA/O/%/00001' or o.status <> 'approved' or o.taxable <> 7000 or o.gst <> 350 or o.total <> 7350 or o.total_kg <> 10 then
    raise exception 'order: % %', r, row_to_json(o);
  end if;
  if (select count(*) from public.order_events where order_id = o.id) <> 2 then raise exception 'events'; end if;
  if public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000a0d01', 'firm_id', sa,
       'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', '[]'::jsonb)) ->> 'status' <> 'duplicate' then
    raise exception 'resend created a second order';
  end if;
  begin
    perform public.create_order(jsonb_build_object('client_op_id', gen_random_uuid(), 'firm_id', sa, 'source', 'salesman',
      'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0003', 'qty', 1))));
    raise exception 'ordered an item with no rate';
  exception when check_violation then null;
  end;

  -- Below list: waits for a discount approval of 10 kg × ₹10.
  r := public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000a0d02', 'firm_id', sa, 'source', 'salesman',
    'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(
      jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 10, 'rate', 390))));
  if r ->> 'order_status' <> 'pending_approval' or (r ->> 'discount')::numeric <> 100 then raise exception 'discount order: %', r; end if;
end;
$$;

-- Sales admin approves the discount; the order is approved.
select set_config('request.jwt.claim.sub', :'adm_auth', false);
do $$
declare o uuid := (select id from public.orders where client_op_id = '00000000-0000-0000-0000-0000000a0d02');
begin
  perform public.decide_approval((select id from public.approval_requests where subject_id = o and kind = 'discount'), true, 'Festival rate');
  if (select status from public.orders where id = o) <> 'approved' then raise exception 'discount approval did not approve the order'; end if;
  if (select note from public.order_events where order_id = o and to_status = 'approved') <> 'Approved: Festival rate' then raise exception 'event note'; end if;
end;
$$;

-- Credit limit 1,000: over the limit and below list → two requests; one approval
-- is not enough, a rejection rejects the order.
select set_config('request.jwt.claim.sub', :'owner_auth', false);
select public.set_credit_terms((select id from public.firms where code = 'SA'), array['00000000-0000-0000-0000-0000000a0b01'::uuid], 1000, null);
select set_config('request.jwt.claim.sub', :'sm_auth', false);
select public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000a0d03', 'firm_id', (select id from public.firms where code = 'SA'),
  'source', 'salesman', 'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(
    jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 5, 'rate', 395))));
select set_config('request.jwt.claim.sub', :'adm_auth', false);
do $$
declare o uuid := (select id from public.orders where client_op_id = '00000000-0000-0000-0000-0000000a0d03');
begin
  if (select count(*) from public.approval_requests where subject_id = o and status = 'pending') <> 2 then raise exception 'two requests expected'; end if;
  perform public.decide_approval((select id from public.approval_requests where subject_id = o and kind = 'order'), true);
  if (select status from public.orders where id = o) <> 'pending_approval' then raise exception 'approved with a request still open'; end if;
  perform public.decide_approval((select id from public.approval_requests where subject_id = o and kind = 'discount'), false, 'No');
  if (select status from public.orders where id = o) <> 'rejected' then raise exception 'not rejected'; end if;
end;
$$;

-- Anjali: no GST. Counter sale from the office skips the credit check.
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare aa uuid := (select id from public.firms where code = 'AA'); sa uuid := (select id from public.firms where code = 'SA'); r jsonb;
begin
  r := public.create_order(jsonb_build_object('client_op_id', gen_random_uuid(), 'firm_id', aa, 'source', 'office',
    'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 2))));
  if (r ->> 'total')::numeric <> 760 or (select gst from public.orders where id = (r ->> 'id')::uuid) <> 0 then raise exception 'AA order %', r; end if;
  if r ->> 'order_no' not like 'AA/O/%' then raise exception 'AA number %', r; end if;
  r := public.create_order(jsonb_build_object('client_op_id', gen_random_uuid(), 'firm_id', sa, 'source', 'counter',
    'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 50))));
  if r ->> 'order_status' <> 'approved' or not (r -> 'credit' ->> 'skipped')::boolean then raise exception 'counter %', r; end if;
  begin
    perform public.create_order(jsonb_build_object('client_op_id', gen_random_uuid(), 'firm_id', sa, 'source', 'office',
      'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(
        jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 1),
        jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 2))));
    raise exception 'same item twice accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- Salesman cancels his pending order; its request is withdrawn. Usual items.
select set_config('request.jwt.claim.sub', :'sm_auth', false);
select public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000a0d04', 'firm_id', (select id from public.firms where code = 'SA'),
  'source', 'salesman', 'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'lines', jsonb_build_array(
    jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 20))));
do $$
declare o uuid := (select id from public.orders where client_op_id = '00000000-0000-0000-0000-0000000a0d04'); u record;
begin
  if (select status from public.orders where id = o) <> 'pending_approval' then raise exception 'over-limit order not held'; end if;
  begin
    perform public.cancel_order(o, '');
    raise exception 'cancel without reason';
  exception when check_violation then null;
  end;
  perform public.cancel_order(o, 'Customer changed mind');
  if (select status from public.orders where id = o) <> 'cancelled' then raise exception 'not cancelled'; end if;
  if exists (select 1 from public.approval_requests where subject_id = o and status = 'pending') then raise exception 'request left pending'; end if;

  select * into u from public.customer_usual_items((select id from public.firms where code = 'SA'), '00000000-0000-0000-0000-0000000a0b01')
   where item_id = '00000000-0000-0000-0000-0000000a0001';
  -- 2 Tally bills + ERP orders not cancelled/rejected (10, 10, counter 50) = 5; last qty is the newest ERP order.
  if u.times <> 5 or u.rate <> 400 then raise exception 'usual items %', row_to_json(u); end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
