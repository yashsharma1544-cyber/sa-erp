-- Tally bills linked to ERP orders: automatic, billed quantities, status, manual link / unlink.
\set owner_auth '00000000-0000-0000-0000-00000000e001'

update public.app_settings set value = to_jsonb((private.today_ist() - 30)::text) where key = 'order_link_from';

-- A fresh approved SA order for Mehkar Shop: 6 kg of Test Tea.
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
select public.set_credit_terms((select id from public.firms where code = 'SA'), array['00000000-0000-0000-0000-0000000a0b01'::uuid], 0, 0);
select public.create_order(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000b0d01', 'firm_id', (select id from public.firms where code = 'SA'),
  'source', 'office', 'customer_id', '00000000-0000-0000-0000-0000000a0b01', 'order_date', private.today_ist() - 1,
  'lines', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000a0001', 'qty', 6))));
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- Mark every other open Mehkar Shop order as fully billed so only the new one can match.
update public.order_lines l set qty_invoiced = l.qty
  from public.orders o where o.id = l.order_id and o.customer_id = '00000000-0000-0000-0000-0000000a0b01'
   and o.client_op_id <> '00000000-0000-0000-0000-0000000b0d01';

-- Tally bills today: Mehkar Shop 4 kg of the tea (part of the order), and a Cash sale.
insert into tally.vouchers (id, company_id, company_name, voucher_kind, voucher_no, voucher_date, party_name, total_amount, cgst, sgst, is_voided, first_seen_at, updated_at) values
  ('00000000-0000-0000-0000-0000000b0f01', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'SANM/1', private.today_ist(), 'Mehkar Shop', 1680, 40, 40, false, now(), now()),
  ('00000000-0000-0000-0000-0000000b0f02', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'SANM/2', private.today_ist(), 'Cash', 500, 0, 0, false, now(), now()),
  ('00000000-0000-0000-0000-0000000b0f03', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'sales', 'SANM/3', private.today_ist(), 'Mehkar Shop', 840, 20, 20, false, now(), now());
insert into tally.voucher_lines (id, voucher_id, line_no, item_name, qty, qty_kg, qty_raw_text, rate, amount, created_at, updated_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0f01', 1, 'Test Tea 250 Gm', 4, 4, '4.000 kg.', 400, 1600, now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0f02', 1, 'Test Tea 250 Gm', 1, 1, '1.000 kg.', 400, 500, now(), now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000b0f03', 1, 'Test Tea 250 Gm', 2, 2, '2.000 kg.', 400, 800, now(), now());

do $$
declare o public.orders; n int;
begin
  select * into o from public.orders where client_op_id = '00000000-0000-0000-0000-0000000b0d01';
  if o.status <> 'approved' then raise exception 'order not approved: %', o.status; end if;
  n := tally.link_sales_orders();
  -- Both Mehkar Shop bills go to the order (4 kg then 2 kg); the Cash sale stays unlinked.
  if n <> 2 then raise exception 'linked %', n; end if;
  if (select qty_invoiced from public.order_lines where order_id = o.id) <> 6 then raise exception 'billed qty'; end if;
  if (select status from public.orders where id = o.id) <> 'invoiced' then raise exception 'not invoiced'; end if;
  if exists (select 1 from public.invoices where tally_voucher_id = '00000000-0000-0000-0000-0000000b0f02') then raise exception 'cash sale linked'; end if;
  if (select gst from public.invoices where tally_voucher_id = '00000000-0000-0000-0000-0000000b0f01') <> 80 then raise exception 'gst'; end if;
  if tally.link_sales_orders() <> 0 then raise exception 'linked twice'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare o uuid := (select id from public.orders where client_op_id = '00000000-0000-0000-0000-0000000b0d01'); i uuid;
begin
  -- Invoiced orders can still go on a dispatch, and become dispatched when it leaves.
  if not exists (select 1 from public.dispatch_board(private.today_ist() + 8) where order_id = o) then raise exception 'invoiced order not on the board'; end if;
  -- Unlink both bills: back to approved, nothing billed.
  for i in select id from public.invoices where order_id = o loop
    perform public.unlink_bill(i);
  end loop;
  if (select status from public.orders where id = o) <> 'approved' or (select qty_invoiced from public.order_lines where order_id = o) <> 0 then
    raise exception 'unlink did not restore the order';
  end if;
  -- Manual link from the candidates.
  if not exists (select 1 from public.order_bill_candidates(o) where voucher_no = 'SANM/1') then raise exception 'candidates'; end if;
  perform public.link_bill(o, '00000000-0000-0000-0000-0000000b0f01');
  if (select qty_invoiced from public.order_lines where order_id = o) <> 4 or (select status from public.orders where id = o) <> 'invoiced' then
    raise exception 'manual link';
  end if;
  begin
    perform public.link_bill(o, '00000000-0000-0000-0000-0000000b0f01');
    raise exception 'same bill linked twice';
  exception when check_violation then null;
  end;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
