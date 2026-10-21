-- =============================================================================
-- SA ERP · 0014 Cash handover and bank deposits (Phase 1, slice 1.3), D-46
--
--   1. A collector hands over all their cash receipts not yet handed over,
--      saying how many notes of each kind they are giving (phone or office).
--   2. Accounts counts the notes, and the difference against the receipts is
--      that person's short / excess. Accepting it puts the receipts in the
--      office pool (receipt status 'counted').
--   3. Counted cash is deposited per firm into one of that firm's bank
--      accounts. The slip amount against the receipts gives the deposit
--      variance.
-- Everything goes through the functions below; tables are read-only to users.
-- =============================================================================

-- Cash denominations as a JSON object, e.g. {"500": 4, "200": 1, "coins": 35}.
create or replace function private.cash_total(p jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    coalesce((p ->> '500')::int, 0) * 500 + coalesce((p ->> '200')::int, 0) * 200
  + coalesce((p ->> '100')::int, 0) * 100 + coalesce((p ->> '50')::int, 0) * 50
  + coalesce((p ->> '20')::int, 0) * 20 + coalesce((p ->> '10')::int, 0) * 10
  + coalesce((p ->> 'coins')::numeric, 0), 0)::numeric(14,2)
$$;

create or replace function private.valid_notes(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and jsonb_typeof(p) = 'object'
     and not exists (select 1 from jsonb_object_keys(p) k where k not in ('500', '200', '100', '50', '20', '10', 'coins'))
     and not exists (select 1 from jsonb_each_text(p) e
                      where e.key <> 'coins' and (e.value !~ '^\d{1,5}$'))
     and coalesce(p ->> 'coins', '0') ~ '^\d{1,6}(\.\d{1,2})?$'
$$;

-- -----------------------------------------------------------------------------
-- Handovers
-- -----------------------------------------------------------------------------
create table public.cash_handovers (
  id              uuid primary key default gen_random_uuid(),
  handover_no     text not null unique,
  collector_id    uuid not null references public.app_users (id),
  handed_at       timestamptz not null default now(),
  expected_cash   numeric(14,2) not null check (expected_cash >= 0),
  declared        jsonb,                          -- what the collector said they are handing over
  declared_total  numeric(14,2),
  counted         jsonb,                          -- what accounts counted
  counted_total   numeric(14,2),
  variance        numeric(14,2) generated always as (counted_total - expected_cash) stored,
  counted_by      uuid references public.app_users (id),
  counted_at      timestamptz,
  status          text not null default 'submitted' check (status in ('submitted', 'accepted', 'cancelled')),
  note            text,
  submitted_by    uuid not null references public.app_users (id),
  client_op_id    uuid unique,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  constraint cash_handovers_declared check (declared is null or private.valid_notes(declared)),
  constraint cash_handovers_counted check (counted is null or private.valid_notes(counted)),
  constraint cash_handovers_accepted check (status <> 'accepted' or (counted is not null and counted_by is not null))
);
create index cash_handovers_collector_idx on public.cash_handovers (collector_id, handed_at desc) where deleted_at is null;
create index cash_handovers_status_idx on public.cash_handovers (status) where deleted_at is null;
select private.standardise_table('public.cash_handovers');

create table public.cash_handover_receipts (
  id           uuid primary key default gen_random_uuid(),
  handover_id  uuid not null references public.cash_handovers (id),
  receipt_id   uuid not null references public.receipts (id),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
-- A receipt is in at most one live handover.
create unique index cash_handover_receipts_uq on public.cash_handover_receipts (receipt_id) where deleted_at is null;
create index cash_handover_receipts_handover_idx on public.cash_handover_receipts (handover_id) where deleted_at is null;
select private.standardise_table('public.cash_handover_receipts');

-- -----------------------------------------------------------------------------
-- Deposits
-- -----------------------------------------------------------------------------
create table public.deposits (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid not null references public.firms (id),
  bank_account_id  uuid not null references public.bank_accounts (id),
  deposited_on     date not null,
  slip_no          text,
  slip_photo_path  text,
  amount           numeric(14,2) not null check (amount > 0),
  expected_amount  numeric(14,2) not null,
  variance         numeric(14,2) generated always as (amount - expected_amount) stored,
  note             text,
  recorded_by      uuid not null references public.app_users (id),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid
);
create index deposits_firm_idx on public.deposits (firm_id, deposited_on desc) where deleted_at is null;
select private.standardise_table('public.deposits');

create table public.deposit_receipts (
  id          uuid primary key default gen_random_uuid(),
  deposit_id  uuid not null references public.deposits (id),
  receipt_id  uuid not null references public.receipts (id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index deposit_receipts_uq on public.deposit_receipts (receipt_id) where deleted_at is null;
create index deposit_receipts_deposit_idx on public.deposit_receipts (deposit_id) where deleted_at is null;
select private.standardise_table('public.deposit_receipts');

-- -----------------------------------------------------------------------------
-- Read access (writes only through the functions below)
-- -----------------------------------------------------------------------------
create policy cash_handovers_read on public.cash_handovers for select to authenticated
  using (collector_id = private.current_app_user_id() or private.has_perm('handover.count') or private.is_owner());
create policy cash_handover_receipts_read on public.cash_handover_receipts for select to authenticated
  using (exists (select 1 from public.cash_handovers h where h.id = handover_id));
create policy deposits_read on public.deposits for select to authenticated
  using ((private.has_perm('deposit.record') or private.has_perm('handover.count') or private.is_owner())
         and firm_id = any(private.my_firm_ids()));
create policy deposit_receipts_read on public.deposit_receipts for select to authenticated
  using (exists (select 1 from public.deposits d where d.id = deposit_id));
revoke insert, update on public.cash_handovers, public.cash_handover_receipts, public.deposits, public.deposit_receipts from authenticated;

-- Bank accounts keep the access rules from 0004 (masters.manage edits).

-- -----------------------------------------------------------------------------
-- Hand over: all of a collector's cash receipts not yet handed over.
--   Collector (receipt.record) for themselves; accounts (handover.count) for
--   anyone. p = {client_op_id?, collector_id?, declared?: notes, note?}
-- -----------------------------------------------------------------------------
create or replace function public.submit_handover(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := private.current_app_user_id();
  v_collector uuid := coalesce(nullif(p ->> 'collector_id', '')::uuid, v_me);
  v_op uuid := nullif(p ->> 'client_op_id', '')::uuid;
  v_declared jsonb := case when jsonb_typeof(p -> 'declared') = 'object' then p -> 'declared' end;
  v_id uuid;
  v_no text;
  v_expected numeric(14,2);
  v_count int;
begin
  if v_me is null or not private.is_active_user() then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  if v_collector = v_me then
    if not private.has_perm('receipt.record') then
      raise exception 'You are not allowed to hand over cash' using errcode = 'insufficient_privilege';
    end if;
  elsif not private.has_perm('handover.count') then
    raise exception 'Only accounts can hand over cash for someone else' using errcode = 'insufficient_privilege';
  end if;
  if v_op is not null then
    select id, handover_no into v_id, v_no from public.cash_handovers where client_op_id = v_op;
    if found then return jsonb_build_object('status', 'duplicate', 'id', v_id, 'handover_no', v_no); end if;
  end if;
  if v_declared is not null and not private.valid_notes(v_declared) then
    raise exception 'Note counts must be whole numbers' using errcode = 'check_violation';
  end if;

  -- Lock the receipts so two handovers can't take the same ones.
  perform 1 from public.receipts r
   where r.collected_by = v_collector and r.mode = 'cash' and r.status = 'recorded' and r.deleted_at is null
   for update;
  select coalesce(sum(r.amount), 0), count(*) into v_expected, v_count
    from public.receipts r
   where r.collected_by = v_collector and r.mode = 'cash' and r.status = 'recorded' and r.deleted_at is null;
  if v_count = 0 then
    raise exception 'No cash to hand over' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtext('cash_handover_no'));
  v_no := 'H/' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '/' ||
          lpad((select count(*) + 1 from public.cash_handovers
                 where (handed_at at time zone 'Asia/Kolkata')::date = private.today_ist())::text, 3, '0');
  insert into public.cash_handovers (handover_no, collector_id, expected_cash, declared, declared_total, note, submitted_by, client_op_id)
  values (v_no, v_collector, v_expected, v_declared,
          case when v_declared is not null then private.cash_total(v_declared) end,
          nullif(trim(p ->> 'note'), ''), v_me, v_op)
  returning id into v_id;

  insert into public.cash_handover_receipts (handover_id, receipt_id)
  select v_id, r.id from public.receipts r
   where r.collected_by = v_collector and r.mode = 'cash' and r.status = 'recorded' and r.deleted_at is null;
  update public.receipts r set status = 'handed_over'
   where r.id in (select receipt_id from public.cash_handover_receipts where handover_id = v_id and deleted_at is null);

  return jsonb_build_object('status', 'created', 'id', v_id, 'handover_no', v_no, 'expected', v_expected, 'receipts', v_count);
end;
$$;

-- Accounts counts the notes and accepts. A difference needs a note.
create or replace function public.accept_handover(p_id uuid, p_counted jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.cash_handovers;
  v_total numeric(14,2);
begin
  if not private.has_perm('handover.count') then
    raise exception 'You are not allowed to count cash' using errcode = 'insufficient_privilege';
  end if;
  select * into h from public.cash_handovers where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Handover not found' using errcode = 'no_data_found'; end if;
  if h.status <> 'submitted' then raise exception 'This handover is already %', h.status using errcode = 'check_violation'; end if;
  if h.collector_id = private.current_app_user_id() and not private.is_owner() then
    raise exception 'Someone else must count your cash' using errcode = 'insufficient_privilege';
  end if;
  if not private.valid_notes(p_counted) then
    raise exception 'Note counts must be whole numbers' using errcode = 'check_violation';
  end if;
  v_total := private.cash_total(p_counted);
  if v_total <> h.expected_cash and nullif(trim(p_note), '') is null then
    raise exception 'The count is % against % expected. Write a note about the difference.', v_total, h.expected_cash
      using errcode = 'check_violation';
  end if;

  update public.cash_handovers
     set counted = p_counted, counted_total = v_total, counted_by = private.current_app_user_id(),
         counted_at = now(), status = 'accepted',
         note = concat_ws(' · ', note, nullif(trim(p_note), ''))
   where id = p_id;
  update public.receipts r set status = 'counted'
   where r.id in (select receipt_id from public.cash_handover_receipts where handover_id = p_id and deleted_at is null);
  return jsonb_build_object('status', 'accepted', 'counted', v_total, 'variance', v_total - h.expected_cash);
end;
$$;

-- Undo a handover that hasn't been accepted: receipts go back to the collector.
create or replace function public.cancel_handover(p_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.cash_handovers;
begin
  select * into h from public.cash_handovers where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Handover not found' using errcode = 'no_data_found'; end if;
  if not (private.has_perm('handover.count') or h.submitted_by = private.current_app_user_id()) then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if h.status <> 'submitted' then raise exception 'Only a handover not yet counted can be cancelled' using errcode = 'check_violation'; end if;
  update public.receipts r set status = 'recorded'
   where r.id in (select receipt_id from public.cash_handover_receipts where handover_id = p_id and deleted_at is null);
  update public.cash_handover_receipts set deleted_at = now(), deleted_by = auth.uid() where handover_id = p_id and deleted_at is null;
  update public.cash_handovers set status = 'cancelled', note = concat_ws(' · ', note, 'Cancelled: ' || coalesce(nullif(trim(p_note), ''), '—'))
   where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deposit counted cash of one firm. p = {firm_id, bank_account_id,
-- deposited_on, slip_no, amount, receipt_ids[], slip_photo_path?, note?}
-- -----------------------------------------------------------------------------
create or replace function public.record_deposit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_firm uuid := nullif(p ->> 'firm_id', '')::uuid;
  v_bank uuid := nullif(p ->> 'bank_account_id', '')::uuid;
  v_amount numeric(14,2) := nullif(p ->> 'amount', '')::numeric(14,2);
  v_ids uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'receipt_ids', '[]'))::uuid);
  v_expected numeric(14,2);
  v_ok int;
  v_id uuid;
begin
  if not private.has_perm('deposit.record') then
    raise exception 'You are not allowed to record deposits' using errcode = 'insufficient_privilege';
  end if;
  if v_firm is null or not (v_firm = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from public.bank_accounts b where b.id = v_bank and b.firm_id = v_firm and b.active and b.deleted_at is null) then
    raise exception 'Choose one of this firm''s bank accounts' using errcode = 'check_violation';
  end if;
  if v_amount is null or v_amount <= 0 then raise exception 'Enter the slip amount' using errcode = 'check_violation'; end if;
  if cardinality(v_ids) = 0 then raise exception 'Choose the cash to deposit' using errcode = 'check_violation'; end if;
  if nullif(p ->> 'deposited_on', '')::date is null or (p ->> 'deposited_on')::date > private.today_ist() then
    raise exception 'Enter the deposit date (not in the future)' using errcode = 'check_violation';
  end if;

  select count(*), coalesce(sum(r.amount), 0) into v_ok, v_expected
    from public.receipts r
   where r.id = any(v_ids) and r.firm_id = v_firm and r.mode = 'cash' and r.status = 'counted' and r.deleted_at is null;
  if v_ok <> cardinality(v_ids) then
    raise exception 'Some of the chosen cash is not counted yet, is another firm''s, or is already deposited' using errcode = 'check_violation';
  end if;
  perform 1 from public.receipts where id = any(v_ids) for update;

  insert into public.deposits (firm_id, bank_account_id, deposited_on, slip_no, slip_photo_path, amount, expected_amount, note, recorded_by)
  values (v_firm, v_bank, (p ->> 'deposited_on')::date, nullif(trim(p ->> 'slip_no'), ''), nullif(p ->> 'slip_photo_path', ''),
          v_amount, v_expected, nullif(trim(p ->> 'note'), ''), private.current_app_user_id())
  returning id into v_id;
  insert into public.deposit_receipts (deposit_id, receipt_id) select v_id, unnest(v_ids);
  update public.receipts set status = 'deposited' where id = any(v_ids);
  return jsonb_build_object('status', 'created', 'id', v_id, 'expected', v_expected, 'variance', v_amount - v_expected);
end;
$$;

-- -----------------------------------------------------------------------------
-- Office overview: per collector, cash not yet handed over, handovers waiting
-- for a count, and their running short/excess.
-- -----------------------------------------------------------------------------
create or replace function public.cash_position(p_from date default null)
returns table (
  collector_id uuid, collector_name text,
  in_hand numeric, in_hand_receipts bigint, oldest_in_hand date,
  waiting_handovers bigint, waiting_amount numeric,
  short_excess numeric, handovers_counted bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.full_name,
         coalesce(sum(r.amount) filter (where r.status = 'recorded'), 0),
         count(r.id) filter (where r.status = 'recorded'),
         min(r.collected_on) filter (where r.status = 'recorded'),
         (select count(*) from public.cash_handovers h where h.collector_id = u.id and h.status = 'submitted' and h.deleted_at is null),
         (select coalesce(sum(h.expected_cash), 0) from public.cash_handovers h where h.collector_id = u.id and h.status = 'submitted' and h.deleted_at is null),
         (select coalesce(sum(h.variance), 0) from public.cash_handovers h
           where h.collector_id = u.id and h.status = 'accepted' and h.deleted_at is null
             and (p_from is null or (h.counted_at at time zone 'Asia/Kolkata')::date >= p_from)),
         (select count(*) from public.cash_handovers h
           where h.collector_id = u.id and h.status = 'accepted' and h.deleted_at is null
             and (p_from is null or (h.counted_at at time zone 'Asia/Kolkata')::date >= p_from))
    from public.app_users u
    left join public.receipts r on r.collected_by = u.id and r.mode = 'cash' and r.deleted_at is null
   where (private.has_perm('handover.count') or private.is_owner())
     and u.deleted_at is null
     and (exists (select 1 from public.receipts x where x.collected_by = u.id and x.mode = 'cash')
          or exists (select 1 from public.cash_handovers x where x.collector_id = u.id))
   group by u.id, u.full_name
   order by 3 desc, 2
$$;

revoke execute on function public.submit_handover(jsonb), public.accept_handover(uuid, jsonb, text),
  public.cancel_handover(uuid, text), public.record_deposit(jsonb), public.cash_position(date) from public, anon;
grant execute on function public.submit_handover(jsonb), public.accept_handover(uuid, jsonb, text),
  public.cancel_handover(uuid, text), public.record_deposit(jsonb), public.cash_position(date) to authenticated;
