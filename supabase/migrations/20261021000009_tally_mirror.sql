-- =============================================================================
-- SA ERP · 0009 Tally mirror (read-only copy of TallySync tsv2), D-37
--
-- tally-data stays untouched: sa-erp reads it over postgres_fdw with the
-- SELECT-only role erp_reader. Foreign tables live in tally_src; tally.* are
-- local copies the ERP reads.
--   * tally.run_sync() upserts rows changed since the last pull, with a
--     30-minute overlap so late-committing TallySync writes are not missed.
--     Lines and allocations have their own cursors because TallySync rewrites
--     them without touching the voucher's updated_at.
--   * Rows that disappear from TallySync are marked removed_at, never
--     deleted. tally.run_sync(true) re-checks everything.
--   * tally.* is not readable by app users. Phase 1 adds firm-scoped views.
-- Until tally.connect_source() has been run, the sync does nothing.
-- The schedule (pg_cron) is turned on by hand: docs/RUNBOOK.md.
-- =============================================================================

create extension if not exists postgres_fdw with schema extensions;

create schema if not exists tally;
create schema if not exists tally_src;
revoke all on schema tally, tally_src from public;

create table tally.companies (
  id                 uuid primary key,
  name               text,
  display_name       text,
  fy_start_year      int,
  fy_end_year        int,
  fy_start_date      date,
  fy_end_date        date,
  mode               text,
  frozen_at          timestamptz,
  gstin              text,
  address            text,
  contact_phone      text,
  contact_email      text,
  created_at         timestamptz,
  updated_at         timestamptz,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index companies_cursor_idx on tally.companies (updated_at);

create table tally.vouchers (
  id                 uuid primary key,
  company_id         uuid,
  company_name       text,
  voucher_type       text,
  voucher_kind       text,
  guid               text,
  alter_id           bigint,
  voucher_no         text,
  voucher_date       date,
  party_id           uuid,
  party_name         text,
  party_group        text,
  party_gstin        text,
  total_amount       numeric(18,2),
  cgst               numeric(18,2),
  sgst               numeric(18,2),
  igst               numeric(18,2),
  round_off          numeric(18,2),
  narration          text,
  irn                text,
  irn_ack_no         text,
  irn_ack_date       date,
  irn_qr             text,
  eway_bill_no       text,
  eway_bill_date     date,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  is_voided          boolean,
  voided_at          timestamptz,
  voided_in_run_id   uuid,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index vouchers_cursor_idx on tally.vouchers (updated_at);

create table tally.voucher_lines (
  id                 uuid primary key,
  voucher_id         uuid,
  line_no            int,
  item_id            uuid,
  item_name          text,
  stock_group        text,
  stock_root_group   text,
  hsn                text,
  qty                numeric(18,4),
  qty_kg             numeric(18,4),
  qty_raw_text       text,
  rate               numeric(18,4),
  amount             numeric(18,2),
  created_at         timestamptz,
  updated_at         timestamptz,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index voucher_lines_cursor_idx on tally.voucher_lines (updated_at);
create index voucher_lines_voucher_idx on tally.voucher_lines (voucher_id);

create table tally.voucher_allocations (
  id                 uuid primary key,
  voucher_id         uuid,
  seq                int,
  party_id           uuid,
  party_name         text,
  amount             numeric,
  created_at         timestamptz,
  bill_reference     text,
  bill_type          text,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index voucher_allocations_cursor_idx on tally.voucher_allocations (created_at);
create index voucher_allocations_voucher_idx on tally.voucher_allocations (voucher_id);

create table tally.outstandings (
  id                 uuid primary key,
  company_id         uuid,
  company_name       text,
  party_id           uuid,
  party_name         text,
  category           text,
  bill_date          date,
  bill_reference     text,
  bill_amount        numeric(18,2),
  pending_amount     numeric(18,2),
  days_pending       int,
  credit_period_days int,
  due_date           date,
  overdue            boolean,
  bill_type          text,
  dr_cr              text,
  as_on_date         date,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  is_voided          boolean,
  voided_at          timestamptz,
  voided_in_run_id   uuid,
  refreshed_at       timestamptz,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index outstandings_cursor_idx on tally.outstandings (updated_at);

create table tally.ledger_balances (
  id                 uuid primary key,
  company_id         uuid,
  company_name       text,
  ledger_name        text,
  party_id           uuid,
  "group"            text,
  root_group         text,
  category           text,
  is_party_ledger    boolean,
  opening_balance    numeric(18,2),
  closing_balance    numeric(18,2),
  net_movement       numeric(18,2),
  as_on_date         date,
  first_seen_at      timestamptz,
  last_seen_at       timestamptz,
  created_at         timestamptz,
  updated_at         timestamptz,
  is_voided          boolean,
  voided_at          timestamptz,
  voided_in_run_id   uuid,
  refreshed_at       timestamptz,
  synced_at          timestamptz not null default now(),
  removed_at         timestamptz
);
create index ledger_balances_cursor_idx on tally.ledger_balances (updated_at);
create table tally.sync_log (
  id          bigint generated always as identity primary key,
  full_pull   boolean not null,
  trigger     text not null default 'cron' check (trigger in ('cron', 'manual')),
  started_at  timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  counts      jsonb,
  error       text
);
create index sync_log_started_idx on tally.sync_log (started_at desc);

-- Which ERP firm a Tally company belongs to (one company per firm per FY).
create or replace view tally.v_company_firm as
select c.id as company_id, c.name as company_name, c.fy_start_date, f.id as firm_id, f.code as firm_code
  from tally.companies c
  join public.firms f on f.code = case
    when c.name ilike 'sushil%' then 'SA'
    when c.name ilike 'anjali%' then 'AA'
  end
 where c.removed_at is null;

-- -----------------------------------------------------------------------------
-- Pull functions: upsert rows changed after p_since (all rows when null).
-- -----------------------------------------------------------------------------

create or replace function tally.pull_companies(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.companies (id, name, display_name, fy_start_year, fy_end_year, fy_start_date, fy_end_date, mode, frozen_at, gstin, address, contact_phone, contact_email, created_at, updated_at)
  select id, name, display_name, fy_start_year, fy_end_year, fy_start_date, fy_end_date, mode, frozen_at, gstin, address, contact_phone, contact_email, created_at, updated_at
    from tally_src.companies s
   where p_since is null or s.updated_at > p_since
  on conflict (id) do update
     set (id, name, display_name, fy_start_year, fy_end_year, fy_start_date, fy_end_date, mode, frozen_at, gstin, address, contact_phone, contact_email, created_at, updated_at, synced_at, removed_at) = (excluded.id, excluded.name, excluded.display_name, excluded.fy_start_year, excluded.fy_end_year, excluded.fy_start_date, excluded.fy_end_date, excluded.mode, excluded.frozen_at, excluded.gstin, excluded.address, excluded.contact_phone, excluded.contact_email, excluded.created_at, excluded.updated_at, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function tally.pull_vouchers(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.vouchers (id, company_id, company_name, voucher_type, voucher_kind, guid, alter_id, voucher_no, voucher_date, party_id, party_name, party_group, party_gstin, total_amount, cgst, sgst, igst, round_off, narration, irn, irn_ack_no, irn_ack_date, irn_qr, eway_bill_no, eway_bill_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id)
  select id, company_id, company_name, voucher_type, voucher_kind, guid, alter_id, voucher_no, voucher_date, party_id, party_name, party_group, party_gstin, total_amount, cgst, sgst, igst, round_off, narration, irn, irn_ack_no, irn_ack_date, irn_qr, eway_bill_no, eway_bill_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id
    from tally_src.vouchers s
   where p_since is null or s.updated_at > p_since
  on conflict (id) do update
     set (id, company_id, company_name, voucher_type, voucher_kind, guid, alter_id, voucher_no, voucher_date, party_id, party_name, party_group, party_gstin, total_amount, cgst, sgst, igst, round_off, narration, irn, irn_ack_no, irn_ack_date, irn_qr, eway_bill_no, eway_bill_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, synced_at, removed_at) = (excluded.id, excluded.company_id, excluded.company_name, excluded.voucher_type, excluded.voucher_kind, excluded.guid, excluded.alter_id, excluded.voucher_no, excluded.voucher_date, excluded.party_id, excluded.party_name, excluded.party_group, excluded.party_gstin, excluded.total_amount, excluded.cgst, excluded.sgst, excluded.igst, excluded.round_off, excluded.narration, excluded.irn, excluded.irn_ack_no, excluded.irn_ack_date, excluded.irn_qr, excluded.eway_bill_no, excluded.eway_bill_date, excluded.first_seen_at, excluded.last_seen_at, excluded.created_at, excluded.updated_at, excluded.is_voided, excluded.voided_at, excluded.voided_in_run_id, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function tally.pull_voucher_lines(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.voucher_lines (id, voucher_id, line_no, item_id, item_name, stock_group, stock_root_group, hsn, qty, qty_kg, qty_raw_text, rate, amount, created_at, updated_at)
  select id, voucher_id, line_no, item_id, item_name, stock_group, stock_root_group, hsn, qty, qty_kg, qty_raw_text, rate, amount, created_at, updated_at
    from tally_src.voucher_lines s
   where p_since is null or s.updated_at > p_since
  on conflict (id) do update
     set (id, voucher_id, line_no, item_id, item_name, stock_group, stock_root_group, hsn, qty, qty_kg, qty_raw_text, rate, amount, created_at, updated_at, synced_at, removed_at) = (excluded.id, excluded.voucher_id, excluded.line_no, excluded.item_id, excluded.item_name, excluded.stock_group, excluded.stock_root_group, excluded.hsn, excluded.qty, excluded.qty_kg, excluded.qty_raw_text, excluded.rate, excluded.amount, excluded.created_at, excluded.updated_at, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function tally.pull_voucher_allocations(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.voucher_allocations (id, voucher_id, seq, party_id, party_name, amount, created_at, bill_reference, bill_type)
  select id, voucher_id, seq, party_id, party_name, amount, created_at, bill_reference, bill_type
    from tally_src.voucher_allocations s
   where p_since is null or s.created_at > p_since
  on conflict (id) do update
     set (id, voucher_id, seq, party_id, party_name, amount, created_at, bill_reference, bill_type, synced_at, removed_at) = (excluded.id, excluded.voucher_id, excluded.seq, excluded.party_id, excluded.party_name, excluded.amount, excluded.created_at, excluded.bill_reference, excluded.bill_type, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function tally.pull_outstandings(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.outstandings (id, company_id, company_name, party_id, party_name, category, bill_date, bill_reference, bill_amount, pending_amount, days_pending, credit_period_days, due_date, overdue, bill_type, dr_cr, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at)
  select id, company_id, company_name, party_id, party_name, category, bill_date, bill_reference, bill_amount, pending_amount, days_pending, credit_period_days, due_date, overdue, bill_type, dr_cr, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at
    from tally_src.outstandings s
   where p_since is null or s.updated_at > p_since
  on conflict (id) do update
     set (id, company_id, company_name, party_id, party_name, category, bill_date, bill_reference, bill_amount, pending_amount, days_pending, credit_period_days, due_date, overdue, bill_type, dr_cr, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at, synced_at, removed_at) = (excluded.id, excluded.company_id, excluded.company_name, excluded.party_id, excluded.party_name, excluded.category, excluded.bill_date, excluded.bill_reference, excluded.bill_amount, excluded.pending_amount, excluded.days_pending, excluded.credit_period_days, excluded.due_date, excluded.overdue, excluded.bill_type, excluded.dr_cr, excluded.as_on_date, excluded.first_seen_at, excluded.last_seen_at, excluded.created_at, excluded.updated_at, excluded.is_voided, excluded.voided_at, excluded.voided_in_run_id, excluded.refreshed_at, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function tally.pull_ledger_balances(p_since timestamptz)
returns int
language plpgsql
set search_path = ''
as $$
declare n int;
begin
  insert into tally.ledger_balances (id, company_id, company_name, ledger_name, party_id, "group", root_group, category, is_party_ledger, opening_balance, closing_balance, net_movement, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at)
  select id, company_id, company_name, ledger_name, party_id, "group", root_group, category, is_party_ledger, opening_balance, closing_balance, net_movement, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at
    from tally_src.ledger_balances s
   where p_since is null or s.updated_at > p_since
  on conflict (id) do update
     set (id, company_id, company_name, ledger_name, party_id, "group", root_group, category, is_party_ledger, opening_balance, closing_balance, net_movement, as_on_date, first_seen_at, last_seen_at, created_at, updated_at, is_voided, voided_at, voided_in_run_id, refreshed_at, synced_at, removed_at) = (excluded.id, excluded.company_id, excluded.company_name, excluded.ledger_name, excluded.party_id, excluded."group", excluded.root_group, excluded.category, excluded.is_party_ledger, excluded.opening_balance, excluded.closing_balance, excluded.net_movement, excluded.as_on_date, excluded.first_seen_at, excluded.last_seen_at, excluded.created_at, excluded.updated_at, excluded.is_voided, excluded.voided_at, excluded.voided_in_run_id, excluded.refreshed_at, now(), null);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Mark mirror rows whose id is no longer in TallySync.
--   full: compare every id of every table.
--   incremental: only lines/allocations of vouchers touched in this run.
create or replace function tally.mark_removed(p_full boolean)
returns int
language plpgsql
set search_path = ''
as $$
declare
  n int := 0;
  k int;
  v_ids uuid[];
  v_src uuid[];
begin
  if p_full then
    create temp table src_ids (tbl text, id uuid) on commit drop;
    insert into pg_temp.src_ids select 'companies', id from tally_src.companies;
    insert into pg_temp.src_ids select 'vouchers', id from tally_src.vouchers;
    insert into pg_temp.src_ids select 'voucher_lines', id from tally_src.voucher_lines;
    insert into pg_temp.src_ids select 'voucher_allocations', id from tally_src.voucher_allocations;
    insert into pg_temp.src_ids select 'outstandings', id from tally_src.outstandings;
    insert into pg_temp.src_ids select 'ledger_balances', id from tally_src.ledger_balances;
    create index on pg_temp.src_ids (tbl, id);
    analyze pg_temp.src_ids;

    update tally.companies m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'companies' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    update tally.vouchers m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'vouchers' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    update tally.voucher_lines m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'voucher_lines' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    update tally.voucher_allocations m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'voucher_allocations' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    update tally.outstandings m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'outstandings' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    update tally.ledger_balances m set removed_at = now() where m.removed_at is null
       and not exists (select 1 from pg_temp.src_ids s where s.tbl = 'ledger_balances' and s.id = m.id);
    get diagnostics k = row_count; n := n + k;
    return n;
  end if;

  -- Vouchers touched in this transaction (synced_at = now()), 500 at a time.
  for v_ids in
    select array_agg(voucher_id)
      from (
        select voucher_id, (row_number() over (order by voucher_id) - 1) / 500 as chunk
          from (
            select id as voucher_id from tally.vouchers where synced_at = now()
            union select voucher_id from tally.voucher_lines where synced_at = now()
            union select voucher_id from tally.voucher_allocations where synced_at = now()
          ) t
      ) c
     group by chunk
  loop
    select coalesce(array_agg(id), '{}') into v_src from tally_src.voucher_lines where voucher_id = any(v_ids);
    update tally.voucher_lines m set removed_at = now()
     where m.voucher_id = any(v_ids) and m.removed_at is null and m.id <> all(v_src);
    get diagnostics k = row_count; n := n + k;

    select coalesce(array_agg(id), '{}') into v_src from tally_src.voucher_allocations where voucher_id = any(v_ids);
    update tally.voucher_allocations m set removed_at = now()
     where m.voucher_id = any(v_ids) and m.removed_at is null and m.id <> all(v_src);
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end;
$$;

-- -----------------------------------------------------------------------------
-- The sync. Logged in tally.sync_log; an error is logged, not raised.
-- -----------------------------------------------------------------------------
create or replace function tally.run_sync(p_full boolean default false, p_trigger text default 'cron')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_log bigint;
  v_overlap constant interval := interval '30 minutes';
  v_full boolean := p_full;
  v_counts jsonb;
  v_status text;
begin
  if to_regclass('tally_src.vouchers') is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'TallySync is not connected yet');
  end if;
  if not pg_try_advisory_xact_lock(hashtext('tally.run_sync')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'A sync is already running');
  end if;
  if not exists (select 1 from tally.vouchers) then
    v_full := true;
  end if;

  insert into tally.sync_log (full_pull, trigger) values (v_full, p_trigger) returning id into v_log;
  begin
    v_counts := jsonb_build_object(
      'companies',           tally.pull_companies(case when v_full then null else (select max(updated_at) from tally.companies) - v_overlap end),
      'vouchers',            tally.pull_vouchers(case when v_full then null else (select max(updated_at) from tally.vouchers) - v_overlap end),
      'voucher_lines',       tally.pull_voucher_lines(case when v_full then null else (select max(updated_at) from tally.voucher_lines) - v_overlap end),
      'voucher_allocations', tally.pull_voucher_allocations(case when v_full then null else (select max(created_at) from tally.voucher_allocations) - v_overlap end),
      'outstandings',        tally.pull_outstandings(case when v_full then null else (select max(updated_at) from tally.outstandings) - v_overlap end),
      'ledger_balances',     tally.pull_ledger_balances(case when v_full then null else (select max(updated_at) from tally.ledger_balances) - v_overlap end)
    );
    v_counts := v_counts || jsonb_build_object('removed', tally.mark_removed(v_full));
    update tally.sync_log set status = 'ok', counts = v_counts, finished_at = clock_timestamp() where id = v_log;
    v_status := 'ok';
  exception when others then
    update tally.sync_log set status = 'failed', error = sqlerrm, finished_at = clock_timestamp() where id = v_log;
    v_status := 'failed';
    v_counts := jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('status', v_status, 'counts', v_counts);
end;
$$;

-- -----------------------------------------------------------------------------
-- One-time connection to tally-data, run by hand (credentials never go in the
-- repo):
--   select tally.connect_source('<host>', 5432, 'postgres', 'erp_reader', '<password>');
-- -----------------------------------------------------------------------------
create or replace function tally.connect_source(p_host text, p_port int, p_dbname text, p_user text, p_password text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_foreign_server where srvname = 'tally_source') then
    execute format('create server tally_source foreign data wrapper postgres_fdw options (host %L, port %L, dbname %L, fetch_size %L, updatable %L)',
                   p_host, p_port::text, p_dbname, '5000', 'false');
  else
    execute format('alter server tally_source options (set host %L, set port %L, set dbname %L)', p_host, p_port::text, p_dbname);
  end if;
  if exists (select 1 from pg_user_mappings where srvname = 'tally_source' and usename = current_user) then
    execute format('alter user mapping for current_user server tally_source options (set user %L, set password %L)', p_user, p_password);
  else
    execute format('create user mapping for current_user server tally_source options (user %L, password %L)', p_user, p_password);
  end if;
  if to_regclass('tally_src.vouchers') is null then
    import foreign schema tsv2
      limit to (companies, vouchers, voucher_lines, voucher_allocations, outstandings, ledger_balances)
      from server tally_source into tally_src;
  end if;
end;
$$;

revoke all on all functions in schema tally from public;
revoke all on all tables in schema tally from anon, authenticated;

-- -----------------------------------------------------------------------------
-- App-facing: sync status for office users, "Sync now" for the owner.
-- -----------------------------------------------------------------------------
create or replace function public.tally_sync_status()
returns table (
  connected boolean, started_at timestamptz, finished_at timestamptz, status text,
  full_pull boolean, counts jsonb, error text, last_ok_at timestamptz,
  vouchers bigint, latest_voucher_date date
)
language sql
stable
security definer
set search_path = ''
as $$
  select to_regclass('tally_src.vouchers') is not null,
         l.started_at, l.finished_at, l.status, l.full_pull, l.counts, l.error,
         (select max(s.finished_at) from tally.sync_log s where s.status = 'ok'),
         (select count(*) from tally.vouchers v where v.removed_at is null),
         (select max(v.voucher_date) from tally.vouchers v where v.removed_at is null and not coalesce(v.is_voided, false))
    from (select 1) one
    left join lateral (select * from tally.sync_log s order by s.started_at desc limit 1) l on true
   where private.is_office_user()
$$;

create or replace function public.tally_sync_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Only the owner can start a sync' using errcode = 'insufficient_privilege';
  end if;
  return tally.run_sync(false, 'manual');
end;
$$;

revoke execute on function public.tally_sync_status(), public.tally_sync_now() from public, anon;
grant execute on function public.tally_sync_status(), public.tally_sync_now() to authenticated;
