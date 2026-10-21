-- =============================================================================
-- SA ERP · 0016 Cheques, bounces, owner alerts, Tally matching (Phase 1, 1.4)
--   * cheques: in hand → deposited → cleared, or bounced / returned
--   * a bounce takes the receipt out, books the bounce charge from settings
--     (a Tally debit note to raise; Q-6 decides GST) and alerts the owner
--   * every sync auto-matches ERP receipts to Tally receipt vouchers; accounts
--     matches the rest by hand. A matched receipt no longer counts as
--     "collected, not in Tally yet" (fixes D-43), D-47
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Owner alerts (bounced cheques now; more kinds later). Shown on Home.
-- -----------------------------------------------------------------------------
create table public.alerts (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('cheque_bounced', 'other')),
  firm_id      uuid references public.firms (id),
  customer_id  uuid references public.customers (id),
  receipt_id   uuid references public.receipts (id),
  title        text not null,
  body         text,
  read_at      timestamptz,
  read_by      uuid references public.app_users (id),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create index alerts_unread_idx on public.alerts (created_at desc) where read_at is null and deleted_at is null;
select private.standardise_table('public.alerts');
create policy alerts_read on public.alerts for select to authenticated using (private.is_owner());
revoke insert, update on public.alerts from authenticated;

create or replace function public.mark_alert_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  update public.alerts set read_at = now(), read_by = private.current_app_user_id() where id = p_id and read_at is null;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cheques: one row per cheque receipt, from collection to clearing.
-- -----------------------------------------------------------------------------
create table public.cheques (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null unique references public.receipts (id),
  status           text not null default 'in_hand' check (status in ('in_hand', 'deposited', 'cleared', 'bounced', 'returned')),
  bank_account_id  uuid references public.bank_accounts (id),
  deposited_on     date,
  cleared_on       date,
  bounced_on       date,
  bounce_reason    text,
  note             text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid,
  constraint cheques_deposited check (status = 'in_hand' or status = 'returned' or (bank_account_id is not null and deposited_on is not null)),
  constraint cheques_cleared check (status <> 'cleared' or cleared_on is not null),
  constraint cheques_bounced check (status <> 'bounced' or (bounced_on is not null and bounce_reason is not null))
);
create index cheques_status_idx on public.cheques (status) where deleted_at is null;
select private.standardise_table('public.cheques');

create table public.cheque_bounces (
  id             uuid primary key default gen_random_uuid(),
  cheque_id      uuid not null unique references public.cheques (id),
  firm_id        uuid not null references public.firms (id),
  customer_id    uuid not null references public.customers (id),
  charge_amount  numeric(14,2) not null check (charge_amount >= 0),
  charge_status  text not null default 'pending' check (charge_status in ('pending', 'raised', 'waived')),
  debit_note_ref text,
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  constraint cheque_bounces_raised check (charge_status <> 'raised' or debit_note_ref is not null)
);
select private.standardise_table('public.cheque_bounces');

create policy cheques_read on public.cheques for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id));
create policy cheque_bounces_read on public.cheque_bounces for select to authenticated
  using (private.is_office_user() and firm_id = any(private.my_firm_ids()));
revoke insert, update on public.cheques, public.cheque_bounces from authenticated;

-- Every cheque receipt gets its cheque row.
create or replace function private.receipt_cheque_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.mode = 'cheque' then
    insert into public.cheques (receipt_id) values (new.id) on conflict (receipt_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger receipt_cheque_row after insert on public.receipts
  for each row execute function private.receipt_cheque_row();
insert into public.cheques (receipt_id)
select r.id from public.receipts r where r.mode = 'cheque' on conflict (receipt_id) do nothing;

create or replace function private.require_cheque_rights()
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not private.has_perm('cheque.manage') then
    raise exception 'You are not allowed to manage cheques' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Deposit cheques (in hand) into a bank account of their firm.
create or replace function public.deposit_cheques(p_ids uuid[], p_bank_account_id uuid, p_date date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bad int;
  n int;
begin
  perform private.require_cheque_rights();
  if p_date is null or p_date > private.today_ist() then
    raise exception 'Enter the deposit date (not in the future)' using errcode = 'check_violation';
  end if;
  select count(*) into v_bad
    from public.cheques c join public.receipts r on r.id = c.receipt_id
   where c.id = any(p_ids)
     and (c.status <> 'in_hand' or not (r.firm_id = any(private.my_firm_ids()))
          or not exists (select 1 from public.bank_accounts b where b.id = p_bank_account_id and b.firm_id = r.firm_id and b.active and b.deleted_at is null)
          or r.cheque_date > p_date);
  if v_bad > 0 or cardinality(p_ids) <> (select count(*) from public.cheques where id = any(p_ids)) then
    raise exception 'Some cheques are already deposited, dated later than the deposit, or belong to another firm''s bank' using errcode = 'check_violation';
  end if;
  update public.cheques set status = 'deposited', bank_account_id = p_bank_account_id, deposited_on = p_date where id = any(p_ids);
  get diagnostics n = row_count;
  update public.receipts set status = 'deposited' where id in (select receipt_id from public.cheques where id = any(p_ids));
  return n;
end;
$$;

create or replace function public.clear_cheque(p_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.cheques;
begin
  perform private.require_cheque_rights();
  select * into c from public.cheques where id = p_id for update;
  if not found or c.status <> 'deposited' then raise exception 'Only a deposited cheque can clear' using errcode = 'check_violation'; end if;
  if p_date is null or p_date < c.deposited_on or p_date > private.today_ist() then
    raise exception 'The clearing date must be between the deposit date and today' using errcode = 'check_violation';
  end if;
  update public.cheques set status = 'cleared', cleared_on = p_date where id = p_id;
  update public.receipts set status = 'cleared' where id = c.receipt_id;
end;
$$;

-- Bounce: the receipt no longer counts, the ₹ charge from settings is raised
-- against the customer (as a Tally debit note to be made), and the owner is alerted.
create or replace function public.bounce_cheque(p_id uuid, p_date date, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.cheques;
  r public.receipts;
  v_charge numeric(14,2) := coalesce((select (value #>> '{}')::numeric from public.app_settings where key = 'cheque_bounce_charge' and deleted_at is null), 0);
  v_name text;
begin
  perform private.require_cheque_rights();
  if nullif(trim(p_reason), '') is null then raise exception 'Give the bounce reason' using errcode = 'check_violation'; end if;
  select * into c from public.cheques where id = p_id for update;
  if not found or c.status not in ('deposited', 'cleared') then
    raise exception 'Only a deposited cheque can bounce' using errcode = 'check_violation';
  end if;
  if p_date is null or p_date < c.deposited_on or p_date > private.today_ist() then
    raise exception 'The bounce date must be between the deposit date and today' using errcode = 'check_violation';
  end if;
  select * into r from public.receipts where id = c.receipt_id;
  select name into v_name from public.customers where id = r.customer_id;

  update public.cheques set status = 'bounced', bounced_on = p_date, bounce_reason = trim(p_reason) where id = p_id;
  update public.receipts set status = 'bounced' where id = r.id;
  insert into public.cheque_bounces (cheque_id, firm_id, customer_id, charge_amount)
  values (p_id, r.firm_id, r.customer_id, v_charge);
  insert into public.alerts (kind, firm_id, customer_id, receipt_id, title, body)
  values ('cheque_bounced', r.firm_id, r.customer_id, r.id,
          'Cheque bounced: ' || v_name || ' · ₹' || r.amount,
          'Cheque ' || r.cheque_no || ' (' || r.cheque_bank || ', receipt ' || r.receipt_no || ') bounced on ' ||
          to_char(p_date, 'DD Mon YYYY') || ': ' || trim(p_reason) || '. Charge ₹' || v_charge || ' to be raised in Tally.');
  return jsonb_build_object('status', 'bounced', 'charge', v_charge);
end;
$$;

-- Cheque handed back before it was deposited: the receipt is cancelled.
create or replace function public.return_cheque(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.cheques;
begin
  perform private.require_cheque_rights();
  if nullif(trim(p_note), '') is null then raise exception 'Say why the cheque is returned' using errcode = 'check_violation'; end if;
  select * into c from public.cheques where id = p_id for update;
  if not found or c.status <> 'in_hand' then raise exception 'Only a cheque in hand can be returned' using errcode = 'check_violation'; end if;
  update public.cheques set status = 'returned', note = trim(p_note) where id = p_id;
  update public.receipts set status = 'cancelled', note = concat_ws(' · ', note, 'Cheque returned: ' || trim(p_note)) where id = c.receipt_id;
end;
$$;

-- Bounce charge: raised in Tally (with the debit note number), or waived (owner only).
create or replace function public.set_bounce_charge(p_id uuid, p_status text, p_ref text default null, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_cheque_rights();
  if p_status = 'waived' and not private.is_owner() then
    raise exception 'Only the owner can waive a bounce charge' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('raised', 'waived', 'pending') then raise exception 'Unknown status' using errcode = 'check_violation'; end if;
  if p_status = 'raised' and nullif(trim(p_ref), '') is null then
    raise exception 'Enter the Tally debit note number' using errcode = 'check_violation';
  end if;
  update public.cheque_bounces
     set charge_status = p_status, debit_note_ref = nullif(trim(p_ref), ''), note = coalesce(nullif(trim(p_note), ''), note)
   where id = p_id and firm_id = any(private.my_firm_ids());
  if not found then raise exception 'Bounce not found' using errcode = 'no_data_found'; end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Matching ERP receipts to Tally receipt vouchers (D-03, D-47)
-- -----------------------------------------------------------------------------
create table public.receipt_tally_matches (
  id                uuid primary key default gen_random_uuid(),
  receipt_id        uuid not null references public.receipts (id),
  tally_voucher_id  uuid not null,
  ledger_key        text not null,
  method            text not null check (method in ('auto', 'manual')),
  matched_by        uuid references public.app_users (id),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid
);
create unique index receipt_tally_matches_receipt_uq on public.receipt_tally_matches (receipt_id) where deleted_at is null;
create unique index receipt_tally_matches_voucher_uq on public.receipt_tally_matches (tally_voucher_id, ledger_key) where deleted_at is null;
select private.standardise_table('public.receipt_tally_matches');
create policy receipt_tally_matches_read on public.receipt_tally_matches for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id));
revoke insert, update on public.receipt_tally_matches from authenticated;

-- Tally receipt lines per party, last 90 days (a receipt split between
-- parties gives one line each).
create type tally.receipt_line as (voucher_id uuid, firm_id uuid, nm text, ledger_name text, voucher_no text, voucher_date date, amount numeric);

create or replace function tally.recent_receipt_lines()
returns setof tally.receipt_line
language sql
stable
set search_path = ''
as $$
  select e.voucher_id, e.firm_id, e.nm, e.ledger_name, e.voucher_no, e.voucher_date, e.cr
    from tally.v_ledger_entries e
   where e.voucher_kind = 'receipt' and e.cr > 0 and e.voucher_date >= private.today_ist() - 90
$$;

-- Auto-match: same firm, same customer ledger, same amount, Tally date from
-- 3 days before to 15 days after the ERP receipt. Oldest first on both sides,
-- so repeated equal payments pair up in order. Returns how many matched.
create or replace function tally.match_receipts()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_lines tally.receipt_line[];
  v_taken text[] := '{}';
  e record;
  v_voucher uuid;
  n int := 0;
begin
  select coalesce(array_agg(l), '{}') into v_lines
    from tally.recent_receipt_lines() l
   where not exists (select 1 from public.receipt_tally_matches m
                      where m.tally_voucher_id = l.voucher_id and m.ledger_key = l.nm and m.deleted_at is null);
  if cardinality(v_lines) = 0 then return 0; end if;

  for e in
    select r.id, r.firm_id, r.amount, r.collected_on, private.ledger_key(a.tally_ledger_name) as nm
      from public.receipts r
      join public.customer_firm_accounts a
        on a.customer_id = r.customer_id and a.firm_id = r.firm_id and a.deleted_at is null and a.tally_ledger_name is not null
     where r.deleted_at is null and r.status <> 'cancelled' and r.tally_voucher_id is null
       and r.collected_on >= private.today_ist() - 75
     order by r.collected_at, r.id
  loop
    select x.voucher_id into v_voucher
      from unnest(v_lines) x
     where x.firm_id = e.firm_id and x.nm = e.nm and x.amount = e.amount
       and x.voucher_date between e.collected_on - 3 and e.collected_on + 15
       and not ((x.voucher_id::text || '|' || x.nm) = any(v_taken))
     order by x.voucher_date, x.voucher_id
     limit 1;
    continue when v_voucher is null;
    v_taken := v_taken || (v_voucher::text || '|' || e.nm);
    insert into public.receipt_tally_matches (receipt_id, tally_voucher_id, ledger_key, method)
    values (e.id, v_voucher, e.nm, 'auto');
    update public.receipts set tally_voucher_id = v_voucher where id = e.id;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Manual match / unmatch (accounts).
create or replace function public.match_receipt(p_receipt_id uuid, p_voucher_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.receipts;
  v_nm text;
begin
  if not private.has_perm('receipt.reallocate') then
    raise exception 'You are not allowed to match receipts' using errcode = 'insufficient_privilege';
  end if;
  select * into r from public.receipts where id = p_receipt_id and deleted_at is null for update;
  if not found or not (r.firm_id = any(private.my_firm_ids())) then raise exception 'Receipt not found' using errcode = 'no_data_found'; end if;
  if r.tally_voucher_id is not null then raise exception 'Already matched. Unmatch it first.' using errcode = 'check_violation'; end if;
  select private.ledger_key(a.tally_ledger_name) into v_nm from public.customer_firm_accounts a
   where a.customer_id = r.customer_id and a.firm_id = r.firm_id and a.deleted_at is null;
  if not exists (select 1 from tally.recent_receipt_lines() l where l.voucher_id = p_voucher_id and l.firm_id = r.firm_id) then
    raise exception 'That Tally receipt is not in this firm or is older than 90 days' using errcode = 'check_violation';
  end if;
  -- A voucher for another party is allowed (the customer may have paid under another ledger); the key records which line.
  insert into public.receipt_tally_matches (receipt_id, tally_voucher_id, ledger_key, method, matched_by)
  values (p_receipt_id, p_voucher_id,
          coalesce((select l.nm from tally.recent_receipt_lines() l where l.voucher_id = p_voucher_id and l.nm = v_nm limit 1),
                   (select l.nm from tally.recent_receipt_lines() l where l.voucher_id = p_voucher_id limit 1)),
          'manual', private.current_app_user_id());
  update public.receipts set tally_voucher_id = p_voucher_id where id = p_receipt_id;
end;
$$;

create or replace function public.unmatch_receipt(p_receipt_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('receipt.reallocate') then
    raise exception 'You are not allowed to match receipts' using errcode = 'insufficient_privilege';
  end if;
  update public.receipt_tally_matches set deleted_at = now(), deleted_by = auth.uid()
   where receipt_id = p_receipt_id and deleted_at is null
     and exists (select 1 from public.receipts r where r.id = p_receipt_id and r.firm_id = any(private.my_firm_ids()));
  if not found then raise exception 'This receipt is not matched' using errcode = 'no_data_found'; end if;
  update public.receipts set tally_voucher_id = null where id = p_receipt_id;
end;
$$;

-- For the match screen: Tally receipts that could be this ERP receipt
-- (same firm, same customer ledger first, ±20 days), not taken by another.
create or replace function public.receipt_match_candidates(p_receipt_id uuid)
returns table (voucher_id uuid, voucher_no text, voucher_date date, ledger_name text, amount numeric, same_party boolean, same_amount boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select r.*, private.ledger_key(a.tally_ledger_name) as nm
      from public.receipts r
      left join public.customer_firm_accounts a on a.customer_id = r.customer_id and a.firm_id = r.firm_id and a.deleted_at is null
     where r.id = p_receipt_id and r.firm_id = any(private.my_firm_ids()) and private.is_office_user()
  )
  select l.voucher_id, l.voucher_no, l.voucher_date, l.ledger_name, l.amount, l.nm = r.nm, l.amount = r.amount
    from r
    join tally.recent_receipt_lines() l on l.firm_id = r.firm_id
   where l.voucher_date between r.collected_on - 20 and r.collected_on + 20
     and (l.nm = r.nm or l.amount = r.amount)
     and not exists (select 1 from public.receipt_tally_matches m
                      where m.tally_voucher_id = l.voucher_id and m.ledger_key = l.nm and m.deleted_at is null)
   order by (l.nm = r.nm and l.amount = r.amount) desc, (l.nm = r.nm) desc, abs(l.amount - r.amount), abs(l.voucher_date - r.collected_on)
   limit 20
$$;

-- What a matched receipt is matched to.
create or replace function public.receipt_tally_voucher(p_receipt_id uuid)
returns table (voucher_id uuid, voucher_no text, voucher_date date, ledger_name text, amount numeric, method text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.voucher_no, v.voucher_date, m.ledger_key, v.total_amount, m.method
    from public.receipt_tally_matches m
    join public.receipts r on r.id = m.receipt_id
    join tally.vouchers v on v.id = m.tally_voucher_id
   where m.receipt_id = p_receipt_id and m.deleted_at is null
     and r.firm_id = any(private.my_firm_ids()) and private.is_office_user()
$$;

revoke execute on function public.mark_alert_read(uuid), public.deposit_cheques(uuid[], uuid, date), public.clear_cheque(uuid, date),
  public.bounce_cheque(uuid, date, text), public.return_cheque(uuid, text), public.set_bounce_charge(uuid, text, text, text),
  public.match_receipt(uuid, uuid), public.unmatch_receipt(uuid), public.receipt_match_candidates(uuid),
  public.receipt_tally_voucher(uuid) from public, anon;
grant execute on function public.mark_alert_read(uuid), public.deposit_cheques(uuid[], uuid, date), public.clear_cheque(uuid, date),
  public.bounce_cheque(uuid, date, text), public.return_cheque(uuid, text), public.set_bounce_charge(uuid, text, text, text),
  public.match_receipt(uuid, uuid), public.unmatch_receipt(uuid), public.receipt_match_candidates(uuid),
  public.receipt_tally_voucher(uuid) to authenticated;
revoke all on function tally.match_receipts(), tally.recent_receipt_lines() from public;

-- Receipts matched to Tally are already in Tally's balance and bills.
create or replace function public.record_collection(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_app_user_id();
  v_op uuid := nullif(p ->> 'client_op_id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_firm uuid := nullif(p ->> 'firm_id', '')::uuid;
  v_customer uuid := nullif(p ->> 'customer_id', '')::uuid;
  v_at timestamptz := coalesce(nullif(p ->> 'happened_at', '')::timestamptz, now());
  v_amount numeric(14,2) := nullif(p ->> 'amount', '')::numeric(14,2);
  v_lat numeric(9,6) := nullif(p ->> 'lat', '')::numeric(9,6);
  v_lng numeric(9,6) := nullif(p ->> 'lng', '')::numeric(9,6);
  v_note text := nullif(trim(p ->> 'note'), '');
  v_beat uuid;
  v_ledger text;
  v_id uuid;
  v_no text;
  v_left numeric(14,2);
  v_take numeric(14,2);
  b record;
begin
  if v_me is null or not private.is_active_user() then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if v_op is null then raise exception 'client_op_id is required' using errcode = 'check_violation'; end if;

  -- Resent from an offline queue: hand back what was created the first time.
  select id, receipt_no into v_id, v_no from public.receipts where client_op_id = v_op;
  if found then return jsonb_build_object('status', 'duplicate', 'kind', 'receipt', 'id', v_id, 'receipt_no', v_no); end if;
  select id into v_id from public.promises where client_op_id = v_op;
  if found then return jsonb_build_object('status', 'duplicate', 'kind', 'promise', 'id', v_id); end if;
  select id into v_id from public.collection_visits where client_op_id = v_op;
  if found then return jsonb_build_object('status', 'duplicate', 'kind', 'visit', 'id', v_id); end if;

  -- Phone clocks drift; never accept a time in the future or older than a week.
  if v_at > now() + interval '10 minutes' then v_at := now(); end if;
  if v_at < now() - interval '7 days' then
    raise exception 'This entry is more than 7 days old. Ask the office to record it.' using errcode = 'check_violation';
  end if;

  select c.beat_id into v_beat from public.customers c where c.id = v_customer and c.deleted_at is null;
  if not found then raise exception 'Customer not found' using errcode = 'no_data_found'; end if;
  if not private.is_office_user() and not (v_beat = any(private.my_collection_beat_ids())) then
    raise exception 'This customer is not in your collection beats' using errcode = 'insufficient_privilege';
  end if;

  if v_kind in ('receipt', 'promise') then
    if not private.has_perm('receipt.record') then
      raise exception 'You are not allowed to record collections' using errcode = 'insufficient_privilege';
    end if;
    if v_firm is null or not (v_firm = any(private.my_firm_ids())) then
      raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
    end if;
    select a.tally_ledger_name into v_ledger from public.customer_firm_accounts a
     where a.customer_id = v_customer and a.firm_id = v_firm and a.deleted_at is null;
    if not found then raise exception 'This customer has no account in this firm' using errcode = 'check_violation'; end if;
    if v_amount is null or v_amount <= 0 then raise exception 'Enter the amount' using errcode = 'check_violation'; end if;
    if v_amount > 10000000 then raise exception 'Amount looks wrong' using errcode = 'check_violation'; end if;
  end if;

  if v_kind = 'receipt' then
    if (p ->> 'mode') not in ('cash', 'upi', 'cheque') then
      raise exception 'Choose cash, UPI or cheque' using errcode = 'check_violation';
    end if;
    if p ->> 'mode' = 'cheque' and nullif(p ->> 'cheque_photo_path', '') is null then
      raise exception 'Take a photo of the cheque' using errcode = 'check_violation';
    end if;
    v_no := private.next_doc_no(v_firm, 'R', (v_at at time zone 'Asia/Kolkata')::date);
    insert into public.receipts (firm_id, customer_id, receipt_no, collected_on, collected_at, collected_by, mode, amount,
                                 upi_ref, cheque_no, cheque_date, cheque_bank, cheque_photo_path, lat, lng, note, client_op_id)
    values (v_firm, v_customer, v_no, (v_at at time zone 'Asia/Kolkata')::date, v_at, v_me, p ->> 'mode', v_amount,
            nullif(trim(p ->> 'upi_ref'), ''), nullif(trim(p ->> 'cheque_no'), ''), nullif(p ->> 'cheque_date', '')::date,
            nullif(trim(p ->> 'cheque_bank'), ''), nullif(p ->> 'cheque_photo_path', ''), v_lat, v_lng, v_note, v_op)
    returning id into v_id;

    -- Settle the oldest open bills first, net of what earlier ERP receipts
    -- (not cancelled) already put against them. Any rest is on account.
    v_left := v_amount;
    for b in
      select ob.bill_key, ob.bill_no, ob.bill_date,
             ob.pending - coalesce((
               select sum(ra.amount) from public.receipt_allocations ra
                 join public.receipts r on r.id = ra.receipt_id
                where ra.bill_key = ob.bill_key and ra.deleted_at is null and r.deleted_at is null
                  and r.firm_id = v_firm and r.customer_id = v_customer
                  and r.status not in ('cancelled', 'bounced') and r.tally_voucher_id is null), 0) as open_amt
        from tally.mv_ar_bills ob
       where ob.firm_id = v_firm and ob.nm = private.ledger_key(v_ledger)
       order by ob.bill_date asc nulls first, ob.bill_no
    loop
      exit when v_left <= 0;
      continue when b.open_amt <= 0;
      v_take := least(v_left, b.open_amt);
      insert into public.receipt_allocations (receipt_id, bill_key, bill_no, bill_date, amount)
      values (v_id, b.bill_key, b.bill_no, b.bill_date, v_take);
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      insert into public.receipt_allocations (receipt_id, bill_key, amount) values (v_id, null, v_left);
    end if;

    insert into public.collection_visits (user_id, customer_id, firm_id, visited_at, outcome, note, lat, lng, receipt_id, client_op_id)
    values (v_me, v_customer, v_firm, v_at, 'paid', v_note, v_lat, v_lng, v_id, gen_random_uuid());
    return jsonb_build_object('status', 'created', 'kind', 'receipt', 'id', v_id, 'receipt_no', v_no);

  elsif v_kind = 'promise' then
    if nullif(p ->> 'promise_date', '') is null then raise exception 'Choose the promise date' using errcode = 'check_violation'; end if;
    if (p ->> 'promise_date')::date < (v_at at time zone 'Asia/Kolkata')::date
       or (p ->> 'promise_date')::date > (v_at at time zone 'Asia/Kolkata')::date + 60 then
      raise exception 'The promise date must be within the next 60 days' using errcode = 'check_violation';
    end if;
    insert into public.promises (firm_id, customer_id, promise_date, amount, made_to, note, client_op_id)
    values (v_firm, v_customer, (p ->> 'promise_date')::date, v_amount, v_me, v_note, v_op)
    returning id into v_id;
    insert into public.collection_visits (user_id, customer_id, firm_id, visited_at, outcome, note, lat, lng, promise_id, client_op_id)
    values (v_me, v_customer, v_firm, v_at, 'promised', v_note, v_lat, v_lng, v_id, gen_random_uuid());
    return jsonb_build_object('status', 'created', 'kind', 'promise', 'id', v_id);

  elsif v_kind = 'visit' then
    if (p ->> 'outcome') not in ('not_available', 'refused', 'closed') then
      raise exception 'Choose what happened' using errcode = 'check_violation';
    end if;
    if v_firm is not null and not (v_firm = any(private.my_firm_ids())) then
      raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
    end if;
    insert into public.collection_visits (user_id, customer_id, firm_id, visited_at, outcome, note, lat, lng, client_op_id)
    values (v_me, v_customer, v_firm, v_at, p ->> 'outcome', v_note, v_lat, v_lng, v_op)
    returning id into v_id;
    return jsonb_build_object('status', 'created', 'kind', 'visit', 'id', v_id);
  end if;

  raise exception 'Unknown entry type %', v_kind using errcode = 'check_violation';
end;
$$;

create or replace function public.field_collect_list(p_beat_id uuid)
returns table (
  customer_id uuid, customer_name text, beat_id uuid, whatsapp text, phone text, address text,
  firm_id uuid, firm_code text, ledger_key text, balance numeric, overdue numeric, b60_plus numeric,
  oldest_bill_date date, last_receipt_date date, credit_days int,
  erp_collected_since_snapshot numeric, open_promise_date date, open_promise_amount numeric,
  visited_today text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.name, c.beat_id, c.whatsapp, c.phone, c.address,
         a.firm_id, f.code, ar.ledger_key, ar.balance, ar.overdue, ar.b60_plus,
         ar.oldest_bill_date, ar.last_receipt_date, a.credit_days,
         (select coalesce(sum(r.amount), 0) from public.receipts r
           where r.customer_id = c.id and r.firm_id = a.firm_id and r.deleted_at is null
             and r.status not in ('cancelled', 'bounced')
             and r.tally_voucher_id is null
             and r.collected_on >= private.today_ist() - 45),
         p.promise_date, p.amount,
         (select v.outcome from public.collection_visits v
           where v.customer_id = c.id and v.deleted_at is null
             and (v.visited_at at time zone 'Asia/Kolkata')::date = private.today_ist()
           order by v.visited_at desc limit 1)
    from public.customers c
    join public.customer_firm_accounts a on a.customer_id = c.id and a.deleted_at is null and a.active
    join public.firms f on f.id = a.firm_id
    join tally.v_ar_customers ar on ar.firm_id = a.firm_id and ar.customer_id = c.id
    left join lateral (
      select pr.promise_date, pr.amount from public.promises pr
       where pr.customer_id = c.id and pr.firm_id = a.firm_id and pr.status = 'open' and pr.deleted_at is null
       order by pr.promise_date limit 1
    ) p on true
   where c.deleted_at is null
     and c.status = 'active'
     and c.beat_id = p_beat_id
     and (private.is_office_user() or p_beat_id = any(private.my_collection_beat_ids()))
     and a.firm_id = any(private.my_firm_ids())
     and ar.balance > 0
$$;

-- Sync: match after every refresh.
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
    perform tally.refresh_receivables();
    v_counts := v_counts || jsonb_build_object('matched', tally.match_receipts());
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
revoke all on function tally.run_sync(boolean, text) from public;
