-- =============================================================================
-- SA ERP · 0010 connect_source: declare the foreign tables explicitly.
-- IMPORT FOREIGN SCHEMA copied TallySync's own enum types (company_mode,
-- voucher_kind), which don't exist here. Declaring the columns ourselves reads
-- those two as text, so tally-data needs no change.
-- =============================================================================

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
    create foreign table tally_src.companies (
          id uuid,
          name text,
          display_name text,
          fy_start_year int,
          fy_end_year int,
          fy_start_date date,
          fy_end_date date,
          mode text,
          frozen_at timestamptz,
          gstin text,
          address text,
          contact_phone text,
          contact_email text,
          created_at timestamptz,
          updated_at timestamptz
    ) server tally_source options (schema_name 'tsv2', table_name 'companies');
    create foreign table tally_src.vouchers (
          id uuid,
          company_id uuid,
          company_name text,
          voucher_type text,
          voucher_kind text,
          guid text,
          alter_id bigint,
          voucher_no text,
          voucher_date date,
          party_id uuid,
          party_name text,
          party_group text,
          party_gstin text,
          total_amount numeric(18,2),
          cgst numeric(18,2),
          sgst numeric(18,2),
          igst numeric(18,2),
          round_off numeric(18,2),
          narration text,
          irn text,
          irn_ack_no text,
          irn_ack_date date,
          irn_qr text,
          eway_bill_no text,
          eway_bill_date date,
          first_seen_at timestamptz,
          last_seen_at timestamptz,
          created_at timestamptz,
          updated_at timestamptz,
          is_voided boolean,
          voided_at timestamptz,
          voided_in_run_id uuid
    ) server tally_source options (schema_name 'tsv2', table_name 'vouchers');
    create foreign table tally_src.voucher_lines (
          id uuid,
          voucher_id uuid,
          line_no int,
          item_id uuid,
          item_name text,
          stock_group text,
          stock_root_group text,
          hsn text,
          qty numeric(18,4),
          qty_kg numeric(18,4),
          qty_raw_text text,
          rate numeric(18,4),
          amount numeric(18,2),
          created_at timestamptz,
          updated_at timestamptz
    ) server tally_source options (schema_name 'tsv2', table_name 'voucher_lines');
    create foreign table tally_src.voucher_allocations (
          id uuid,
          voucher_id uuid,
          seq int,
          party_id uuid,
          party_name text,
          amount numeric,
          created_at timestamptz,
          bill_reference text,
          bill_type text
    ) server tally_source options (schema_name 'tsv2', table_name 'voucher_allocations');
    create foreign table tally_src.outstandings (
          id uuid,
          company_id uuid,
          company_name text,
          party_id uuid,
          party_name text,
          category text,
          bill_date date,
          bill_reference text,
          bill_amount numeric(18,2),
          pending_amount numeric(18,2),
          days_pending int,
          credit_period_days int,
          due_date date,
          overdue boolean,
          bill_type text,
          dr_cr text,
          as_on_date date,
          first_seen_at timestamptz,
          last_seen_at timestamptz,
          created_at timestamptz,
          updated_at timestamptz,
          is_voided boolean,
          voided_at timestamptz,
          voided_in_run_id uuid,
          refreshed_at timestamptz
    ) server tally_source options (schema_name 'tsv2', table_name 'outstandings');
    create foreign table tally_src.ledger_balances (
          id uuid,
          company_id uuid,
          company_name text,
          ledger_name text,
          party_id uuid,
          "group" text,
          root_group text,
          category text,
          is_party_ledger boolean,
          opening_balance numeric(18,2),
          closing_balance numeric(18,2),
          net_movement numeric(18,2),
          as_on_date date,
          first_seen_at timestamptz,
          last_seen_at timestamptz,
          created_at timestamptz,
          updated_at timestamptz,
          is_voided boolean,
          voided_at timestamptz,
          voided_in_run_id uuid,
          refreshed_at timestamptz
    ) server tally_source options (schema_name 'tsv2', table_name 'ledger_balances');
  end if;
end;
$$;

revoke all on function tally.connect_source(text, int, text, text, text) from public;
