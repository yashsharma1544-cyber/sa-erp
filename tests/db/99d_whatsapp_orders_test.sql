-- WhatsApp group orders: group → firm, customer / salesman / item matching,
-- quantity rules, automatic placing, office fixes, deleted messages, re-sync.
\set owner_auth '00000000-0000-0000-0000-00000000e001'

-- Stand-in for the Whatsapp Orders project (same columns as the foreign tables).
create table wa_src.wa_groups (jid text, subject text, track boolean);
create table wa_src.wa_salesmen (jid text, name text, aliases text[]);
create table wa_src.wa_messages (id bigint, group_jid text, message_id text, sender_name text, sent_at timestamptz, message_type text,
  body text, parse_status text, parse_notes text, received_at timestamptz, parsed_at timestamptz);
create table wa_src.wa_order_lines (id bigint, message_id bigint, group_jid text, sender_name text, sent_at timestamptz, order_no int,
  customer text, brand text, pack text, qty numeric, unit text, raw_line text, uncertain boolean, source text, created_at timestamptz,
  item_code text, item_name text, free_qty numeric);

insert into public.items (id, name, unit, kg_per_unit, gst_rate, category) values
  ('00000000-0000-0000-0000-0000000a0004', 'Test Lion 10 Rs', 'pkt', 0.676, 5, 'tea');
insert into public.price_list (firm_id, item_id, rate, effective_from)
select f.id, '00000000-0000-0000-0000-0000000a0004', 220, private.today_ist() from public.firms f where f.code = 'SA';

insert into wa_src.wa_groups values ('g-jalna', 'JALNA LOCAL ORDER', true), ('g-mehkar', 'Mehkar. Booking', true);
insert into wa_src.wa_salesmen values ('s1', 'Salesman Seven', array['SS 777']);
insert into wa_src.wa_messages values
  (1, 'g-jalna', 'w1', 'SS 777', now() - interval '2 hours', 'text', E'Mehkar Shop, Lonar\nT250 2\nL10 1.352kg', 'parsed', null, now(), now()),
  (2, 'g-mehkar', 'w2', 'Unknown Guy', now() - interval '1 hour', 'text', E'New Party\nT250 5 zola', 'parsed', null, now(), now()),
  (3, 'g-mehkar', 'w3', 'SS 777', now() - interval '1 hour', 'text', E'Someone\nT250 1', 'parsed', null, now(), now());
insert into wa_src.wa_order_lines (id, message_id, group_jid, sender_name, sent_at, order_no, customer, pack, qty, unit, raw_line, uncertain, item_name) values
  (11, 1, 'g-jalna', 'SS 777', now(), 1, 'Mehkar Shop, Lonar', '250g', 2, null, 'T250 2', false, 'Test Tea 250 Gm'),
  (12, 1, 'g-jalna', 'SS 777', now(), 1, 'Mehkar Shop, Lonar', '10rs', 1.352, 'kg', 'L10 1.352kg', false, 'Test Lion 10 Rs'),
  (21, 2, 'g-mehkar', 'Unknown Guy', now(), 1, 'New Party', '250g', 5, 'zola', 'T250 5 zola', false, 'Test Tea 250 Gm'),
  (31, 3, 'g-mehkar', 'SS 777', now(), 1, 'Someone', '250g', 1, null, 'T250 1', false, 'Test Tea 250 Gm');

-- Conversion rules on their own.
do $$
declare it public.items; r record;
begin
  select * into it from public.items where id = '00000000-0000-0000-0000-0000000a0001'; -- billed per kg
  select * into r from wa.convert_qty(it, '250g', 100, null, false);
  if r.qty <> 100 or r.problem is not null then raise exception 'packet tea bare number = kg: %', row_to_json(r); end if;
  select * into r from wa.convert_qty(it, '250g', 40, 'pkt', false);
  if r.qty <> 10 then raise exception '40 pkt of 250 g = 10 kg: %', row_to_json(r); end if;
  select * into r from wa.convert_qty(it, '250g', 5, 'chawal', false);
  if r.problem is null or r.qty is not null then raise exception 'unknown unit accepted'; end if;
  select * into r from wa.convert_qty(it, '250g', 3, null, true);
  if r.problem <> 'Unclear in the message' then raise exception 'uncertain not flagged'; end if;
  select * into it from public.items where id = '00000000-0000-0000-0000-0000000a0004'; -- billed per pkt, 0.676 kg
  select * into r from wa.convert_qty(it, '10rs', 160, null, false);
  if r.qty <> 160 or round(r.kg, 2) <> 108.16 then raise exception 'sachet bare number = pkt: %', row_to_json(r); end if;
  select * into r from wa.convert_qty(it, '10rs', 5, 'kg', false);
  if r.problem is null then raise exception '5 kg is 7.4 pkt and must be checked'; end if;
end;
$$;

select wa.run_sync();

do $$
declare o1 public.wa_orders; o2 public.wa_orders; ord public.orders;
begin
  select * into o1 from public.wa_orders where external_key = '1:1';
  select * into o2 from public.wa_orders where external_key = '2:1';
  -- Jalna group → Sushil, placed automatically with the salesman as requester.
  if o1.firm_id <> (select id from public.firms where code = 'SA') or o1.status <> 'ordered' then
    raise exception 'order 1: % %', o1.status, o1.problems;
  end if;
  select * into ord from public.orders where id = o1.order_id;
  if ord.source <> 'salesman' or ord.salesman_id <> (select id from public.app_users where full_name = 'Salesman Seven') then
    raise exception 'order 1 salesman';
  end if;
  if (select string_agg(i.name || '=' || l.qty || ' ' || l.unit, ', ' order by l.line_no) from public.order_lines l join public.items i on i.id = l.item_id where l.order_id = ord.id)
     <> 'Test Tea 250 Gm=2.000 kg, Test Lion 10 Rs=2.000 pkt' then
    raise exception 'order 1 lines';
  end if;
  -- 2 × 400 + 2 × 220, +5% = 1302 > Mehkar Shop's 1,000 limit → waits for approval requested by the salesman.
  if ord.total <> 1302 or ord.status <> 'pending_approval'
     or (select requested_by from public.approval_requests where subject_id = ord.id) <> ord.salesman_id then
    raise exception 'order 1 credit: % %', ord.total, ord.status;
  end if;
  -- Other group → Anjali, held: unknown customer, unknown unit, unknown salesman.
  if o2.firm_id <> (select id from public.firms where code = 'AA') or o2.status <> 'review' or cardinality(o2.problems) <> 3 then
    raise exception 'order 2: % %', o2.status, o2.problems;
  end if;
end;
$$;

-- The third message is deleted in WhatsApp; a re-sync changes nothing else.
update wa_src.wa_messages set parse_status = 'deleted', parsed_at = now() where id = 3;
do $$
declare r jsonb := wa.run_sync();
begin
  if r -> 'counts' ->> 'cancelled' <> '1' or (r -> 'counts' ->> 'new')::int <> 0 then raise exception 'resync %', r; end if;
  if (select status from public.wa_orders where external_key = '3:1') <> 'cancelled' then raise exception 'not cancelled'; end if;
  if (select count(*) from public.orders where note like 'WhatsApp%') <> 1 then raise exception 'second order made'; end if;
end;
$$;

-- Office fixes order 2 and places it.
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare o uuid := (select id from public.wa_orders where external_key = '2:1'); l uuid; r jsonb;
begin
  begin
    perform public.wa_place_order(o);
    raise exception 'placed with problems';
  exception when check_violation then null;
  end;
  perform public.wa_link_customer(o, '00000000-0000-0000-0000-0000000a0b01');
  l := (select id from public.wa_order_lines where wa_order_id = o and deleted_at is null);
  perform public.wa_set_line(l, '00000000-0000-0000-0000-0000000a0001', 3);
  if (select cardinality(problems) from public.wa_orders where id = o) <> 0 then
    raise exception 'still problems: %', (select problems from public.wa_orders where id = o);
  end if;
  r := public.wa_place_order(o);
  if (select status from public.wa_orders where id = o) <> 'ordered'
     or (select source from public.orders where id = (r ->> 'id')::uuid) <> 'whatsapp_paste'
     or (select total from public.orders where id = (r ->> 'id')::uuid) <> 1140 then
    raise exception 'placed: %', r;
  end if;
  if not exists (select 1 from public.customer_aliases where external_id = 'wa:new party') then raise exception 'customer wording not saved'; end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- The saved wording links the next order from "New Party" on its own.
insert into wa_src.wa_messages values (4, 'g-mehkar', 'w4', 'SS 777', now(), 'text', E'New Party\nT250 2', 'parsed', null, now(), now());
insert into wa_src.wa_order_lines (id, message_id, group_jid, sender_name, sent_at, order_no, customer, pack, qty, unit, raw_line, uncertain, item_name)
values (41, 4, 'g-mehkar', 'SS 777', now(), 1, 'New Party', '250g', 2, null, 'T250 2', false, 'Test Tea 250 Gm');
do $$
begin
  perform wa.run_sync();
  if (select status from public.wa_orders where external_key = '4:1') <> 'ordered' then
    raise exception 'order 4: %', (select problems from public.wa_orders where external_key = '4:1');
  end if;
end;
$$;

-- Closest-name suggestions for an unlinked shop.
insert into wa_src.wa_messages values (5, 'g-mehkar', 'w5', 'SS 777', now(), 'text', E'Mehkar shop.B.N.\nT250 1', 'parsed', null, now(), now());
insert into wa_src.wa_order_lines (id, message_id, group_jid, sender_name, sent_at, order_no, customer, pack, qty, unit, raw_line, uncertain, item_name)
values (51, 5, 'g-mehkar', 'SS 777', now(), 1, 'Mehkar shop.B.N.', '250g', 1, null, 'T250 1', false, 'Test Tea 250 Gm');
select wa.run_sync();
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
begin
  if (select name from public.wa_customer_suggestions((select id from public.wa_orders where external_key = '5:1')) limit 1) <> 'Mehkar Shop' then
    raise exception 'suggestions: %', (select json_agg(s) from public.wa_customer_suggestions((select id from public.wa_orders where external_key = '5:1')) s);
  end if;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
