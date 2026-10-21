-- =============================================================================
-- SA ERP · 0012 Field collections (Phase 1, slice 1.2), D-41
--   receipts (+ allocations to bills, oldest first, D-12), promises, visits.
--   The phone writes only through public.record_collection(), which is
--   idempotent on client_op_id so an offline queue can safely resend.
--   Field staff may only collect from customers in their *collection* beats
--   (D-31) and firms; office users from any customer of their firms.
-- =============================================================================

-- Beats a user may collect in (user_beats.purpose = 'collection').
create or replace function private.my_collection_beat_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ub.beat_id), '{}')
    from public.user_beats ub
   where ub.user_id = private.current_app_user_id()
     and ub.purpose = 'collection'
     and ub.deleted_at is null
$$;
grant execute on function private.my_collection_beat_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Document numbers: one running series per firm, kind and financial year.
-- -----------------------------------------------------------------------------
create table private.doc_counters (
  firm_id   uuid not null references public.firms (id),
  kind      text not null,
  fy_label  text not null,
  last_no   int  not null default 0,
  primary key (firm_id, kind, fy_label)
);

create or replace function private.next_doc_no(p_firm_id uuid, p_kind text, p_date date)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_fy text;
  v_prefix text;
  v_no int;
begin
  select label into v_fy from public.fiscal_years
   where p_date between start_date and end_date and deleted_at is null;
  if v_fy is null then
    raise exception 'No financial year set up for %', p_date using errcode = 'check_violation';
  end if;
  select invoice_prefix into v_prefix from public.firms where id = p_firm_id;
  insert into private.doc_counters (firm_id, kind, fy_label, last_no) values (p_firm_id, p_kind, v_fy, 1)
  on conflict (firm_id, kind, fy_label) do update set last_no = private.doc_counters.last_no + 1
  returning last_no into v_no;
  return v_prefix || '/' || p_kind || '/' || v_fy || '/' || lpad(v_no::text, 5, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- Receipts
-- -----------------------------------------------------------------------------
create table public.receipts (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references public.firms (id),
  customer_id        uuid not null references public.customers (id),
  receipt_no         text not null unique,
  collected_on       date not null,
  collected_at       timestamptz not null,
  collected_by       uuid not null references public.app_users (id),
  mode               text not null check (mode in ('cash', 'upi', 'cheque', 'bank')),
  amount             numeric(14,2) not null check (amount > 0),
  upi_ref            text,
  cheque_no          text,
  cheque_date        date,
  cheque_bank        text,
  cheque_photo_path  text,
  lat                numeric(9,6),
  lng                numeric(9,6),
  note               text,
  status             text not null default 'recorded' check (status in (
                       'recorded', 'handed_over', 'counted', 'deposited', 'cleared', 'tally_matched', 'cancelled', 'bounced')),
  tally_voucher_id   uuid,
  client_op_id       uuid not null unique,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  deleted_by         uuid,
  constraint receipts_upi_ref check (mode <> 'upi' or upi_ref is not null),
  constraint receipts_cheque check (mode <> 'cheque' or (cheque_no is not null and cheque_date is not null and cheque_bank is not null))
);
create index receipts_customer_idx on public.receipts (customer_id, firm_id) where deleted_at is null;
create index receipts_collector_idx on public.receipts (collected_by, collected_on) where deleted_at is null;
create index receipts_firm_date_idx on public.receipts (firm_id, collected_on) where deleted_at is null;
select private.standardise_table('public.receipts');

create table public.receipt_allocations (
  id          uuid primary key default gen_random_uuid(),
  receipt_id  uuid not null references public.receipts (id),
  bill_key    text,          -- tally voucher id, 'older', or null = on account
  bill_no     text,
  bill_date   date,
  amount      numeric(14,2) not null check (amount > 0),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create index receipt_allocations_receipt_idx on public.receipt_allocations (receipt_id) where deleted_at is null;
create index receipt_allocations_bill_idx on public.receipt_allocations (bill_key) where deleted_at is null;
select private.standardise_table('public.receipt_allocations');

-- -----------------------------------------------------------------------------
-- Promises and visits
-- -----------------------------------------------------------------------------
create table public.promises (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms (id),
  customer_id   uuid not null references public.customers (id),
  promise_date  date not null,
  amount        numeric(14,2) not null check (amount > 0),
  made_to       uuid not null references public.app_users (id),
  status        text not null default 'open' check (status in ('open', 'kept', 'partly_kept', 'broken', 'cancelled')),
  note          text,
  client_op_id  uuid not null unique,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid
);
create index promises_customer_idx on public.promises (customer_id, firm_id, status) where deleted_at is null;
create index promises_due_idx on public.promises (promise_date) where deleted_at is null and status = 'open';
select private.standardise_table('public.promises');

create table public.collection_visits (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.app_users (id),
  customer_id   uuid not null references public.customers (id),
  firm_id       uuid references public.firms (id),
  visited_at    timestamptz not null,
  outcome       text not null check (outcome in ('paid', 'promised', 'not_available', 'refused', 'closed')),
  note          text,
  lat           numeric(9,6),
  lng           numeric(9,6),
  receipt_id    uuid references public.receipts (id),
  promise_id    uuid references public.promises (id),
  client_op_id  uuid not null unique,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid
);
create index collection_visits_user_idx on public.collection_visits (user_id, visited_at) where deleted_at is null;
create index collection_visits_customer_idx on public.collection_visits (customer_id, visited_at) where deleted_at is null;
select private.standardise_table('public.collection_visits');

-- -----------------------------------------------------------------------------
-- Read access. No direct writes: everything goes through record_collection().
--   field staff: their own rows
--   office users: rows of their firms
-- -----------------------------------------------------------------------------
create policy receipts_read on public.receipts for select to authenticated
  using (collected_by = private.current_app_user_id()
         or (private.is_office_user() and firm_id = any(private.my_firm_ids())));
create policy receipt_allocations_read on public.receipt_allocations for select to authenticated
  using (exists (select 1 from public.receipts r where r.id = receipt_id));
create policy promises_read on public.promises for select to authenticated
  using (made_to = private.current_app_user_id()
         or (private.is_office_user() and firm_id = any(private.my_firm_ids())));
create policy collection_visits_read on public.collection_visits for select to authenticated
  using (user_id = private.current_app_user_id()
         or (private.is_office_user() and (firm_id is null or firm_id = any(private.my_firm_ids()))));

revoke insert, update on public.receipts, public.receipt_allocations, public.promises, public.collection_visits from authenticated;

-- -----------------------------------------------------------------------------
-- record_collection(payload)
--   kind 'receipt': firm_id, customer_id, amount, mode, upi_ref | cheque_*,
--                   cheque_photo_path (cheque), note
--   kind 'promise': firm_id, customer_id, amount, promise_date, note
--   kind 'visit'  : customer_id, firm_id (optional), outcome, note
--   always        : client_op_id, happened_at (phone time), lat, lng
-- Returns {status: 'created' | 'duplicate', kind, id, receipt_no?}.
-- -----------------------------------------------------------------------------
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
                  and r.status not in ('cancelled', 'bounced', 'tally_matched')), 0) as open_amt
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

revoke execute on function public.record_collection(jsonb) from public, anon;
grant execute on function public.record_collection(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Collector day list: customers in the caller's collection beats (office
-- users: any beat) with Tally outstanding per firm, plus what the ERP has
-- collected that Tally may not show yet, open promises and today's visit.
-- -----------------------------------------------------------------------------
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
             and r.status not in ('cancelled', 'bounced', 'tally_matched')
             and r.collected_on >= coalesce(ar.snapshot_date, '1900-01-01')),
         p.promise_date, p.amount,
         (select v.outcome from public.collection_visits v
           where v.customer_id = c.id and v.deleted_at is null
             and (v.visited_at at time zone 'Asia/Kolkata')::date = private.today_ist()
           order by v.visited_at desc limit 1)
    from public.customers c
    join public.customer_firm_accounts a on a.customer_id = c.id and a.deleted_at is null and a.active
    join public.firms f on f.id = a.firm_id
    join public.v_ar_customers ar on ar.firm_id = a.firm_id and ar.customer_id = c.id
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

revoke execute on function public.field_collect_list(uuid) from public, anon;
grant execute on function public.field_collect_list(uuid) to authenticated;

-- Field staff read the bills of customers they may collect from.
create or replace function public.field_customer_bills(p_customer_id uuid, p_firm_id uuid)
returns table (bill_key text, bill_no text, bill_date date, kind text, bill_amount numeric, pending numeric, days int, overdue boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select b.bill_key, b.bill_no, b.bill_date, b.kind, b.bill_amount, b.pending, b.days, b.overdue
    from public.v_ar_bills b
    join public.customers c on c.id = b.customer_id
   where b.customer_id = p_customer_id and b.firm_id = p_firm_id
     and (private.is_office_user() or c.beat_id = any(private.my_collection_beat_ids()))
   order by b.bill_date asc nulls first
$$;

revoke execute on function public.field_customer_bills(uuid, uuid) from public, anon;
grant execute on function public.field_customer_bills(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Cheque photos: private bucket, uploaded by the server after checking the
-- user (Supabase only; skipped in plain-Postgres tests).
-- -----------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('cheques', 'cheques', false, 3145728, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;
  end if;
end;
$$;
