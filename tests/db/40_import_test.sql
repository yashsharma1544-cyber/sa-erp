-- Import: SA creates, AA auto-links on exact name, non-customers set aside,
-- suggestions, manual decisions and undo.
insert into public.import_parties (firm_id, ledger_name, erp_beat, whatsapp, flag, closing_balance, sales_count)
select f.id, v.ledger, v.beat, v.wa, v.flag, v.bal, 1
  from (values
    ('SA', 'Govind Kirana (Lonar)', 'Lonar', '+91 98220 11111', null, 1200.50),
    ('SA', 'Shree  Traders',        'Mehkar', null, 'bad_debt', 0),
    ('SA', 'Phone Pay Sales',       null, null, null, 0),
    ('AA', 'Govind kirana (LONAR)', 'Lonar', null, null, 300),
    ('AA', 'Shri Traders Mehkar',   'Mehkar', '9822022222', null, 0),
    ('AA', 'Totally Different Shop','Counter', null, null, 0),
    ('AA', 'Sushil Agencies',       null, null, null, 0)
  ) v (firm, ledger, beat, wa, flag, bal)
  join public.firms f on f.code = v.firm;

do $$
declare r jsonb;
begin
  r := public.import_process_parties();
  if (r ->> 'created')::int <> 2 then raise exception 'expected 2 created, got %', r; end if;
  if (r ->> 'linked')::int <> 1 then raise exception 'expected 1 auto-link, got %', r; end if;
  if (r ->> 'non_customer')::int <> 2 then raise exception 'expected 2 non-customers, got %', r; end if;
  if (r ->> 'pending')::int <> 2 then raise exception 'expected 2 pending, got %', r; end if;

  if (select whatsapp from public.customers where name = 'Govind Kirana (Lonar)') <> '9822011111' then
    raise exception 'whatsapp not normalised';
  end if;
  if (select count(*) from public.customer_firm_accounts a join public.customers c on c.id = a.customer_id
       where c.name = 'Govind Kirana (Lonar)') <> 2 then
    raise exception 'Govind should have SA and AA accounts';
  end if;
  if (select status from public.customers where name = 'Shree Traders') <> 'bad_debt' then
    raise exception 'flag not imported';
  end if;
  if (select b.name from public.customers c join public.beats b on b.id = c.beat_id where c.name = 'Shree Traders') <> 'Mehkar' then
    raise exception 'beat not mapped';
  end if;
  if (select suggestion_score from public.import_parties where ledger_name = 'Shri Traders Mehkar') < 0.45
     or (select suggested_customer_id from public.import_parties where ledger_name = 'Shri Traders Mehkar') is null then
    raise exception 'suggestion missing for Shri Traders Mehkar';
  end if;
  if (select suggested_customer_id from public.import_parties where ledger_name = 'Totally Different Shop') is not null then
    raise exception 'unrelated name should get no suggestion';
  end if;

  -- re-running is harmless
  r := public.import_process_parties();
  if (r ->> 'created')::int <> 0 or (r ->> 'linked')::int <> 0 then raise exception 're-run changed things: %', r; end if;
end $$;

-- Manual: link the suggestion, create the other, then undo the link.
do $$
declare v_row uuid; v_cust uuid;
begin
  select id into v_row from public.import_parties where ledger_name = 'Shri Traders Mehkar';
  select id into v_cust from public.customers where name = 'Shree Traders';
  perform public.import_decide_party(v_row, 'link', v_cust);
  if (select status from public.import_parties where id = v_row) <> 'linked' then raise exception 'manual link failed'; end if;

  begin
    perform public.import_decide_party(v_row, 'link', v_cust);
    raise exception 'decided twice';
  exception when check_violation then null;
  end;

  perform public.import_decide_party((select id from public.import_parties where ledger_name = 'Totally Different Shop'), 'new');
  if (select c.customer_type from public.customers c where c.name = 'Totally Different Shop') <> 'counter' then
    raise exception 'counter beat should make a counter customer';
  end if;

  perform public.import_decide_party(v_row, 'undo');
  if (select status from public.import_parties where id = v_row) <> 'pending' then raise exception 'undo failed'; end if;
  if exists (select 1 from public.customer_firm_accounts where lower(tally_ledger_name) = 'shri traders mehkar' and deleted_at is null) then
    raise exception 'undo left the firm account';
  end if;
end $$;

-- Items
insert into public.import_items (name, brand, grp, is_tea, hsn, unit, kg_per_unit, gst_rate, last_sale, sales_lines)
values ('Lion No 5  10 Rs', 'Lion No. 5', 1, true, '09023020', 'Pkt', 0.676, 5, date '2026-10-01', 100),
       ('Vinayak  15 Ltr Jar', 'Vinayak', null, false, '15079010', 'Jar', 0, 5, date '2025-06-01', 10),
       ('Brand New Item', 'Brand New Brand', null, false, null, null, null, null, null, 1);
do $$
declare r jsonb;
begin
  r := public.import_process_items();
  if (r ->> 'created')::int <> 3 then raise exception 'items: %', r; end if;
  if (select g.code from public.items i join public.sku_groups g on g.id = i.sku_group_id where i.name = 'Lion No 5 10 Rs') <> 'G1' then
    raise exception 'item group not set';
  end if;
  if (select active from public.items where name = 'Vinayak 15 Ltr Jar') then raise exception 'unsold-this-FY item should be inactive'; end if;
  if (select category from public.items where name = 'Vinayak 15 Ltr Jar') <> 'oil' then raise exception 'oil category'; end if;
  if not exists (select 1 from public.brands where name = 'Brand New Brand') then raise exception 'missing brand not created'; end if;
end $$;

-- Same item twice in Tally (spacing only) → one item, two aliases.
insert into public.import_items (name, brand, is_tea, unit, kg_per_unit, gst_rate, last_sale)
values ('New Sagar Mix  5 Kg  Bag', 'New Sagar', true, 'kg', 1, 5, date '2026-10-01'),
       ('New Sagar Mix 5 Kg Bag',   'New Sagar', true, 'kg', 1, 5, date '2026-09-01');
do $$
begin
  perform public.import_process_items();
  if (select count(*) from public.items where name = 'New Sagar Mix 5 Kg Bag') <> 1 then raise exception 'duplicate item created'; end if;
  if (select count(*) from public.item_aliases a join public.items i on i.id = a.item_id where i.name = 'New Sagar Mix 5 Kg Bag') <> 2 then
    raise exception 'both spellings should be aliases';
  end if;
end $$;
