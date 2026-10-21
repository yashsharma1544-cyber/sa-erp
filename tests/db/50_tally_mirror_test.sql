-- Tally mirror: not connected → skipped; full pull; incremental with overlap;
-- rewritten lines/allocations marked removed; full re-check; failures logged.
do $$
begin
  if (tally.run_sync() ->> 'status') <> 'skipped' then raise exception 'should skip before connect'; end if;
end;
$$;

-- Stand-in for the foreign tables: same columns as the mirror.
create table tally_src.companies           (like tally.companies including defaults);
create table tally_src.vouchers            (like tally.vouchers including defaults);
create table tally_src.voucher_lines       (like tally.voucher_lines including defaults);
create table tally_src.voucher_allocations (like tally.voucher_allocations including defaults);
create table tally_src.outstandings        (like tally.outstandings including defaults);
create table tally_src.ledger_balances     (like tally.ledger_balances including defaults);

insert into tally_src.companies (id, name, fy_start_date, updated_at) values
  ('00000000-0000-0000-0000-0000000000c1', 'SUSHIL AGENCIES 26-27', '2026-04-01', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000c2', 'Anjali Agency 26-27',   '2026-04-01', now() - interval '2 days');
insert into tally_src.vouchers (id, company_id, company_name, voucher_type, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, updated_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'SUSHIL AGENCIES 26-27', 'Sales', 'sales', 'SA/1', '2026-10-01', 'Govind', 1000.00, false, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c2', 'Anjali Agency 26-27', 'Sales', 'sales', 'AA/1', '2026-10-02', 'Govind', 500.00, false, now() - interval '2 days');
insert into tally_src.voucher_lines (id, voucher_id, line_no, item_name, qty, amount, updated_at) values
  ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000000a1', 1, 'Vikram Kadak 1kg', 2, 1000.00, now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000001a2', '00000000-0000-0000-0000-0000000000a2', 1, 'Vinayak 15L', 1, 500.00, now() - interval '2 days');
insert into tally_src.voucher_allocations (id, voucher_id, seq, party_name, amount, bill_reference, created_at) values
  ('00000000-0000-0000-0000-0000000002a1', '00000000-0000-0000-0000-0000000000a1', 1, 'Govind', 1000.00, 'SA/1', now() - interval '2 days');
insert into tally_src.outstandings (id, company_name, party_name, bill_reference, pending_amount, updated_at) values
  ('00000000-0000-0000-0000-0000000003a1', 'SUSHIL AGENCIES 26-27', 'Govind', 'SA/1', 1000.00, now() - interval '2 days');
insert into tally_src.ledger_balances (id, company_name, ledger_name, closing_balance, updated_at) values
  ('00000000-0000-0000-0000-0000000004a1', 'SUSHIL AGENCIES 26-27', 'Govind', -1000.00, now() - interval '2 days');

do $$
declare r jsonb;
begin
  -- First run is a full pull because the mirror is empty.
  r := tally.run_sync();
  if r ->> 'status' <> 'ok' then raise exception 'full sync failed: %', r; end if;
  if (select full_pull from tally.sync_log order by id desc limit 1) is not true then raise exception 'first run should be full'; end if;
  if (r -> 'counts' ->> 'vouchers')::int <> 2 or (r -> 'counts' ->> 'voucher_lines')::int <> 2 then
    raise exception 'unexpected counts %', r;
  end if;
  if (select count(*) from tally.v_company_firm) <> 2 then raise exception 'companies not mapped to firms'; end if;
  if (select firm_code from tally.v_company_firm where company_name ilike 'anjali%') <> 'AA' then raise exception 'AA mapping'; end if;
end;
$$;

-- TallySync rewrites voucher a1's allocation (new id, same seq) and edits a
-- line without touching the voucher row; adds a new voucher.
delete from tally_src.voucher_allocations where id = '00000000-0000-0000-0000-0000000002a1';
insert into tally_src.voucher_allocations (id, voucher_id, seq, party_name, amount, bill_reference, created_at) values
  ('00000000-0000-0000-0000-0000000002b1', '00000000-0000-0000-0000-0000000000a1', 1, 'Govind', 900.00, 'SA/1', now());
update tally_src.voucher_lines set amount = 900.00, updated_at = now() where id = '00000000-0000-0000-0000-0000000001a1';
insert into tally_src.vouchers (id, company_id, company_name, voucher_type, voucher_kind, voucher_no, voucher_date, party_name, total_amount, is_voided, updated_at) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'SUSHIL AGENCIES 26-27', 'Receipt', 'receipt', 'R/1', '2026-10-03', 'Govind', 100.00, false, now());

do $$
declare r jsonb;
begin
  r := tally.run_sync();
  if r ->> 'status' <> 'ok' then raise exception 'incremental failed: %', r; end if;
  if (select full_pull from tally.sync_log order by id desc limit 1) then raise exception 'second run should be incremental'; end if;
  -- The cursor is the newest row already mirrored (2 days back), so this run
  -- re-reads everything after it.
  if (r -> 'counts' ->> 'vouchers')::int <> 3 then raise exception 'expected 3 vouchers, got %', r; end if;
  if (select amount from tally.voucher_lines where id = '00000000-0000-0000-0000-0000000001a1') <> 900.00 then
    raise exception 'edited line not pulled';
  end if;
  if (select removed_at from tally.voucher_allocations where id = '00000000-0000-0000-0000-0000000002a1') is null then
    raise exception 'rewritten allocation should be marked removed';
  end if;
  if (select removed_at from tally.voucher_allocations where id = '00000000-0000-0000-0000-0000000002b1') is not null then
    raise exception 'new allocation must be live';
  end if;
  if (select count(*) from tally.vouchers) <> 3 then raise exception 'mirror should have 3 vouchers'; end if;
end;
$$;

-- Nothing changed: only rows inside the 30-minute overlap are re-read.
do $$
declare r jsonb;
begin
  r := tally.run_sync();
  if (r -> 'counts' ->> 'vouchers')::int <> 1 then raise exception 'expected only the recent voucher, got %', r; end if;
  if (r -> 'counts' ->> 'removed')::int <> 0 then raise exception 'nothing should be removed, got %', r; end if;
end;
$$;

-- A voucher deleted in TallySync is found by the full re-check, not deleted.
delete from tally_src.voucher_lines where voucher_id = '00000000-0000-0000-0000-0000000000a2';
delete from tally_src.vouchers where id = '00000000-0000-0000-0000-0000000000a2';
do $$
declare r jsonb;
begin
  r := tally.run_sync(true);
  if r ->> 'status' <> 'ok' then raise exception 'full re-check failed: %', r; end if;
  if (r -> 'counts' ->> 'removed')::int <> 2 then raise exception 'expected 2 removed, got %', r; end if;
  if (select removed_at from tally.vouchers where id = '00000000-0000-0000-0000-0000000000a2') is null then
    raise exception 'deleted voucher should be marked removed';
  end if;
  if (select count(*) from tally.vouchers) <> 3 then raise exception 'mirror rows must never be deleted'; end if;
end;
$$;

-- A failing source is logged, not raised.
alter table tally_src.voucher_lines rename to voucher_lines_gone;
do $$
declare r jsonb;
begin
  r := tally.run_sync();
  if r ->> 'status' <> 'failed' then raise exception 'expected failed, got %', r; end if;
  if (select status from tally.sync_log order by id desc limit 1) <> 'failed' then raise exception 'failure not logged'; end if;
end;
$$;
alter table tally_src.voucher_lines_gone rename to voucher_lines;

-- App users cannot read the mirror directly.
do $$
begin
  if has_table_privilege('authenticated', 'tally.vouchers', 'select') then raise exception 'mirror readable by app users'; end if;
  if has_function_privilege('authenticated', 'tally.run_sync(boolean, text)', 'execute') then raise exception 'run_sync callable by app users'; end if;
end;
$$;
