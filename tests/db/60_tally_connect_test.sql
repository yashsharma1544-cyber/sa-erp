-- connect_source against a real postgres_fdw source that, like tally-data,
-- uses its own enum types (tsv2.company_mode, tsv2.voucher_kind).
create database tsrc;
\c tsrc
create schema tsv2;
create type tsv2.company_mode as enum ('active', 'frozen');
create type tsv2.voucher_kind as enum ('sales', 'receipt');
create table tsv2.companies (id uuid primary key, name text not null, display_name text, fy_start_year int, fy_end_year int,
  fy_start_date date, fy_end_date date, mode tsv2.company_mode not null, frozen_at timestamptz, gstin text, address text,
  contact_phone text, contact_email text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table tsv2.vouchers (id uuid primary key, company_id uuid, company_name text, voucher_type text, voucher_kind tsv2.voucher_kind,
  guid text, alter_id bigint, voucher_no text, voucher_date date, party_id uuid, party_name text, party_group text, party_gstin text,
  total_amount numeric(18,2), cgst numeric(18,2), sgst numeric(18,2), igst numeric(18,2), round_off numeric(18,2), narration text,
  irn text, irn_ack_no text, irn_ack_date date, irn_qr text, eway_bill_no text, eway_bill_date date, first_seen_at timestamptz,
  last_seen_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), is_voided boolean default false,
  voided_at timestamptz, voided_in_run_id uuid);
create table tsv2.voucher_lines (id uuid primary key, voucher_id uuid, line_no int, item_id uuid, item_name text, stock_group text,
  stock_root_group text, hsn text, qty numeric(18,4), qty_kg numeric(18,4), qty_raw_text text, rate numeric(18,4), amount numeric(18,2),
  created_at timestamptz default now(), updated_at timestamptz default now());
create table tsv2.voucher_allocations (id uuid primary key, voucher_id uuid, seq int, party_id uuid, party_name text, amount numeric,
  created_at timestamptz default now(), bill_reference text, bill_type text);
create table tsv2.outstandings (id uuid primary key, company_id uuid, company_name text, party_id uuid, party_name text, category text,
  bill_date date, bill_reference text, bill_amount numeric(18,2), pending_amount numeric(18,2), days_pending int, credit_period_days int,
  due_date date, overdue boolean, bill_type text, dr_cr text, as_on_date date, first_seen_at timestamptz, last_seen_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now(), is_voided boolean, voided_at timestamptz,
  voided_in_run_id uuid, refreshed_at timestamptz);
create table tsv2.ledger_balances (id uuid primary key, company_id uuid, company_name text, ledger_name text, party_id uuid,
  "group" text, root_group text, category text, is_party_ledger boolean, opening_balance numeric(18,2), closing_balance numeric(18,2),
  net_movement numeric(18,2), as_on_date date, first_seen_at timestamptz, last_seen_at timestamptz, created_at timestamptz default now(),
  updated_at timestamptz default now(), is_voided boolean, voided_at timestamptz, voided_in_run_id uuid, refreshed_at timestamptz);
insert into tsv2.companies (id, name, mode) values (gen_random_uuid(), 'SUSHIL AGENCIES 26-27', 'active');
insert into tsv2.vouchers (id, company_name, voucher_kind, voucher_no) values (gen_random_uuid(), 'SUSHIL AGENCIES 26-27', 'sales', 'SA/9');
\c postgres

-- Swap out the stand-in tables from the previous test.
alter schema tally_src rename to tally_src_stub;
create schema tally_src;
select tally.connect_source(current_setting('unix_socket_directories'), current_setting('port')::int, 'tsrc', 'postgres', 'unused');

do $$
declare r jsonb;
begin
  if (select mode from tally_src.companies limit 1) <> 'active' then raise exception 'enum column not read as text'; end if;
  r := tally.run_sync(true);
  if r ->> 'status' <> 'ok' then raise exception 'sync over fdw failed: %', r; end if;
  if not exists (select 1 from tally.vouchers where voucher_no = 'SA/9' and voucher_kind = 'sales') then
    raise exception 'voucher not mirrored over fdw';
  end if;
  -- Running it again only updates the login.
  perform tally.connect_source(current_setting('unix_socket_directories'), current_setting('port')::int, 'tsrc', 'postgres', 'unused2');
end;
$$;
