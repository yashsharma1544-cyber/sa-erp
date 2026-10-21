-- Cheques, bounce, alerts and Tally matching, on top of tests 70–90.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set col_auth   '00000000-0000-0000-0000-00000000f001'
\set acct_auth  '00000000-0000-0000-0000-00000000f009'

set role authenticated;
select set_config('request.jwt.claim.sub', :'col_auth', false);
do $$
declare sa uuid := (select id from public.firms where code = 'SA'); ram uuid := '00000000-0000-0000-0000-0000000e0b01';
begin
  perform public.record_collection(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000d0001', 'kind', 'receipt',
    'firm_id', sa, 'customer_id', ram, 'amount', '1200', 'mode', 'cheque', 'cheque_no', '000111',
    'cheque_date', private.today_ist(), 'cheque_bank', 'SBI', 'cheque_photo_path', '2026-10/x/one.jpg'));
  perform public.record_collection(jsonb_build_object('client_op_id', '00000000-0000-0000-0000-0000000d0002', 'kind', 'receipt',
    'firm_id', sa, 'customer_id', ram, 'amount', '800', 'mode', 'cheque', 'cheque_no', '000222',
    'cheque_date', private.today_ist() + 5, 'cheque_bank', 'SBI', 'cheque_photo_path', '2026-10/x/two.jpg'));
  if (select count(*) from public.cheques where status = 'in_hand') <> 2 then raise exception 'cheque rows not created'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare
  sa_bank uuid := (select b.id from public.bank_accounts b join public.firms f on f.id = b.firm_id where f.code = 'SA');
  aa_bank uuid := (select b.id from public.bank_accounts b join public.firms f on f.id = b.firm_id where f.code = 'AA');
  c1 uuid := (select c.id from public.cheques c join public.receipts r on r.id = c.receipt_id where r.cheque_no = '000111');
  c2 uuid := (select c.id from public.cheques c join public.receipts r on r.id = c.receipt_id where r.cheque_no = '000222');
  r jsonb;
  b uuid;
begin
  begin
    perform public.deposit_cheques(array[c1], aa_bank, private.today_ist());
    raise exception 'cheque deposited into another firm''s bank';
  exception when check_violation then null;
  end;
  begin
    perform public.deposit_cheques(array[c2], sa_bank, private.today_ist());
    raise exception 'post-dated cheque deposited early';
  exception when check_violation then null;
  end;
  if public.deposit_cheques(array[c1], sa_bank, private.today_ist()) <> 1 then raise exception 'deposit count'; end if;
  if (select r.status from public.receipts r join public.cheques c on c.receipt_id = r.id where c.id = c1) <> 'deposited' then
    raise exception 'receipt not deposited';
  end if;

  begin
    perform public.bounce_cheque(c1, private.today_ist(), '');
    raise exception 'bounce without a reason';
  exception when check_violation then null;
  end;
  r := public.bounce_cheque(c1, private.today_ist(), 'Funds insufficient');
  if (r ->> 'charge')::numeric <> 500 then raise exception 'bounce charge %', r; end if;
  if (select r.status from public.receipts r join public.cheques c on c.receipt_id = r.id where c.id = c1) <> 'bounced' then
    raise exception 'receipt not bounced';
  end if;
  if exists (select 1 from public.alerts) then raise exception 'accounts must not read owner alerts'; end if;

  b := (select id from public.cheque_bounces);
  begin
    perform public.set_bounce_charge(b, 'waived');
    raise exception 'accounts waived a bounce charge';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_bounce_charge(b, 'raised', '');
    raise exception 'raised without a debit note number';
  exception when check_violation then null;
  end;
  perform public.set_bounce_charge(b, 'raised', 'DN/26-27/14');
  if (select charge_status from public.cheque_bounces where id = b) <> 'raised' then raise exception 'charge status'; end if;

  perform public.return_cheque(c2, 'Customer paid cash instead');
  if (select r.status from public.receipts r join public.cheques c on c.receipt_id = r.id where c.id = c2) <> 'cancelled' then
    raise exception 'returned cheque receipt not cancelled';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare a uuid;
begin
  select id into a from public.alerts where kind = 'cheque_bounced' and read_at is null;
  if a is null then raise exception 'owner got no bounce alert'; end if;
  if (select body from public.alerts where id = a) not like '%000111%Funds insufficient%' then raise exception 'alert text'; end if;
  perform public.mark_alert_read(a);
  if exists (select 1 from public.alerts where read_at is null) then raise exception 'alert not marked read'; end if;
end;
$$;
reset role;

-- Tally now shows two ₹300 receipts for Ram (the ERP has one ₹300 cash receipt)
-- and a ₹2,000 receipt split between Ram (1,500) and Old Party (500).
insert into tally.vouchers (id, company_id, company_name, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, first_seen_at, updated_at) values
  ('00000000-0000-0000-0000-0000000e0f01', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'receipt', 'TR/1', private.today_ist(),     'Ram Kirana', 300,  false, now(), now()),
  ('00000000-0000-0000-0000-0000000e0f02', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'receipt', 'TR/2', private.today_ist(),     'Ram Kirana', 300,  false, now(), now()),
  ('00000000-0000-0000-0000-0000000e0f03', '00000000-0000-0000-0000-0000000e0c01', 'SUSHIL AGENCIES CUR', 'receipt', 'TR/3', private.today_ist() - 10, 'Ram Kirana', 2000, false, now(), now());
insert into tally.voucher_allocations (id, voucher_id, seq, party_name, amount, created_at) values
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0f03', 1, 'Ram Kirana', 1500, now()),
  (gen_random_uuid(), '00000000-0000-0000-0000-0000000e0f03', 2, 'Old Party', 500, now());

do $$
declare n int;
begin
  n := tally.match_receipts();
  -- Only the ERP ₹300 cash receipt matches (first Tally ₹300); the ₹2,000 UPI
  -- receipt has no same-amount line for Ram in the window.
  if n <> 1 then raise exception 'auto matched %', n; end if;
  if (select tally_voucher_id from public.receipts where amount = 300 and mode = 'cash') <> '00000000-0000-0000-0000-0000000e0f01' then
    raise exception 'matched to the wrong voucher';
  end if;
  if tally.match_receipts() <> 0 then raise exception 'second run matched again'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
declare
  upi uuid := (select id from public.receipts where mode = 'upi');
  cash300 uuid := (select id from public.receipts where amount = 300 and mode = 'cash');
begin
  -- Candidates for the UPI receipt: the split voucher's Ram line comes first (same party).
  if (select voucher_no from public.receipt_match_candidates(upi) limit 1) <> 'TR/3' then
    raise exception 'candidates: %', (select json_agg(c) from public.receipt_match_candidates(upi) c);
  end if;
  if exists (select 1 from public.receipt_match_candidates(upi) where voucher_no = 'TR/1') then
    raise exception 'an already matched voucher offered again';
  end if;
  perform public.match_receipt(upi, '00000000-0000-0000-0000-0000000e0f03');
  if (select method from public.receipt_tally_voucher(upi)) <> 'manual' then raise exception 'manual match not shown'; end if;
  begin
    perform public.match_receipt(upi, '00000000-0000-0000-0000-0000000e0f02');
    raise exception 'matched twice';
  exception when check_violation then null;
  end;
  perform public.unmatch_receipt(cash300);
  if (select tally_voucher_id from public.receipts where id = cash300) is not null then raise exception 'unmatch'; end if;
end;
$$;

-- Matched receipts no longer count as "collected, not in Tally yet".
select set_config('request.jwt.claim.sub', :'col_auth', false);
do $$
declare v numeric;
begin
  select erp_collected_since_snapshot into v from public.field_collect_list((select id from public.beats where name = 'Lonar'))
   where customer_id = '00000000-0000-0000-0000-0000000e0b01';
  -- unmatched, not cancelled/bounced: cash 500 + cash 300 = 800 (UPI 2,000 matched, cheques bounced/cancelled)
  if v <> 800 then raise exception 'erp collected %', v; end if;
end;
$$;
reset role;
