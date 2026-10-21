-- =============================================================================
-- SA ERP · 0020 Price list and orders (slice 2.1, D-58…D-61)
--   price_list: one rate per firm per item, dated; the current rate is the
--     latest row on or before today. Seeded from the latest Tally sale rate.
--   orders / order_lines / order_events: an order is per firm and customer,
--     in Tally's billing unit. On submit it is credit-checked; a failed check
--     raises an order approval, a rate below the list raises a discount
--     approval. The order is approved once nothing is waiting.
-- =============================================================================

insert into public.permissions (key, category, description)
values ('price.manage', 'Masters', 'Change item rates in the price list')
on conflict (key) do nothing;
insert into public.role_permissions (role, permission_key)
select v.role::public.app_role, 'price.manage'
  from (values ('sales_admin'), ('accounts')) v (role)
 where not exists (select 1 from public.role_permissions rp
                    where rp.role = v.role::public.app_role and rp.permission_key = 'price.manage' and rp.deleted_at is null);

-- Sales beats only (collection beats don't let you take orders).
create or replace function private.my_sales_beat_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ub.beat_id), '{}')
    from public.user_beats ub
   where ub.user_id = private.current_app_user_id() and ub.purpose = 'sales' and ub.deleted_at is null
$$;
grant execute on function private.my_sales_beat_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Price list
-- -----------------------------------------------------------------------------
create table public.price_list (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id),
  item_id         uuid not null references public.items (id),
  rate            numeric(14,4) not null check (rate > 0),  -- per billing unit, before GST (Tally's rate)
  effective_from  date not null,
  source          text not null default 'manual' check (source in ('manual', 'tally')),
  note            text,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid
);
create unique index price_list_uq on public.price_list (firm_id, item_id, effective_from) where deleted_at is null;
select private.standardise_table('public.price_list');
create policy price_list_read on public.price_list for select to authenticated
  using (deleted_at is null and firm_id = any(private.my_firm_ids()));

create or replace view public.v_current_prices
with (security_invoker = true) as
select distinct on (p.firm_id, p.item_id)
       p.firm_id, p.item_id, p.rate, p.effective_from, p.source
  from public.price_list p
 where p.deleted_at is null and p.effective_from <= private.today_ist()
 order by p.firm_id, p.item_id, p.effective_from desc, p.created_at desc;
grant select on public.v_current_prices to authenticated;

-- Set today's rate for one or more items (same day again replaces it).
create or replace function public.set_prices(p_firm_id uuid, p_rates jsonb, p_note text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_rate numeric;
  v_n int := 0;
  v_today date := private.today_ist();
begin
  if not private.has_perm('price.manage') then
    raise exception 'You are not allowed to change rates' using errcode = 'insufficient_privilege';
  end if;
  if not (p_firm_id = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p_rates, '[]'::jsonb)) loop
    v_rate := round((x ->> 'rate')::numeric, 4);
    if v_rate is null or v_rate <= 0 or v_rate > 9999999999 then
      raise exception 'Rate must be more than 0' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.items i where i.id = (x ->> 'item_id')::uuid and i.deleted_at is null) then
      raise exception 'Unknown item' using errcode = 'check_violation';
    end if;
    -- Unchanged rates are skipped so history only holds real changes.
    continue when v_rate = (select c.rate from public.v_current_prices c
                             where c.firm_id = p_firm_id and c.item_id = (x ->> 'item_id')::uuid);
    update public.price_list set rate = v_rate, source = 'manual', note = p_note
     where firm_id = p_firm_id and item_id = (x ->> 'item_id')::uuid and effective_from = v_today and deleted_at is null;
    if not found then
      insert into public.price_list (firm_id, item_id, rate, effective_from, note)
      values (p_firm_id, (x ->> 'item_id')::uuid, v_rate, v_today, p_note);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Seed: each firm's latest Tally sale rate per item (last 120 days).
insert into public.price_list (firm_id, item_id, rate, effective_from, source, note)
select distinct on (cf.firm_id, a.item_id)
       cf.firm_id, a.item_id, round(l.rate, 4), private.today_ist(), 'tally', 'Latest Tally rate ' || v.voucher_date
  from tally.voucher_lines l
  join tally.vouchers v on v.id = l.voucher_id and v.voucher_kind = 'sales' and v.removed_at is null and not coalesce(v.is_voided, false)
  join tally.v_company_firm cf on cf.company_id = v.company_id
  join public.item_aliases a on a.source = 'tally' and lower(a.alias_name) = lower(l.item_name) and a.deleted_at is null
  join public.items i on i.id = a.item_id and i.deleted_at is null
 where l.removed_at is null and l.rate > 0 and l.qty > 0 and v.voucher_date >= private.today_ist() - 120
 order by cf.firm_id, a.item_id, v.voucher_date desc, v.first_seen_at desc, l.line_no
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Orders
-- -----------------------------------------------------------------------------
create table public.orders (
  id                   uuid primary key default gen_random_uuid(),
  firm_id              uuid not null references public.firms (id),
  order_no             text not null unique,
  customer_id          uuid not null references public.customers (id),
  source               text not null check (source in ('salesman', 'office', 'whatsapp_paste', 'counter')),
  salesman_id          uuid references public.app_users (id),
  order_date           date not null,
  status               text not null default 'pending_approval' check (status in (
                         'pending_approval', 'approved', 'rejected', 'loading', 'invoiced',
                         'dispatched', 'delivered', 'closed', 'cancelled')),
  taxable              numeric(14,2) not null default 0,
  gst                  numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  discount             numeric(14,2) not null default 0,  -- below list, before GST
  total_kg             numeric(12,3) not null default 0,
  credit_check         jsonb,
  note                 text,
  lat                  numeric(9,6),
  lng                  numeric(9,6),
  client_op_id         uuid not null unique,
  created_at           timestamptz not null default now(),
  created_by           uuid default auth.uid(),
  updated_at           timestamptz not null default now(),
  updated_by           uuid,
  deleted_at           timestamptz,
  deleted_by           uuid
);
create index orders_firm_date_idx on public.orders (firm_id, order_date) where deleted_at is null;
create index orders_customer_idx on public.orders (customer_id) where deleted_at is null;
create index orders_status_idx on public.orders (status) where deleted_at is null;
create index orders_salesman_idx on public.orders (salesman_id, order_date) where deleted_at is null;
select private.standardise_table('public.orders');

create table public.order_lines (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders (id),
  line_no       int not null,
  item_id       uuid not null references public.items (id),
  unit          text not null,
  qty           numeric(12,3) not null check (qty > 0),
  kg            numeric(12,3) not null default 0,
  list_rate     numeric(14,4),
  rate          numeric(14,4) not null check (rate > 0),
  gst_rate      numeric(5,2) not null default 0,
  taxable       numeric(14,2) not null,
  gst           numeric(14,2) not null,
  amount        numeric(14,2) not null,
  qty_invoiced  numeric(12,3) not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid,
  unique (order_id, line_no)
);
create index order_lines_item_idx on public.order_lines (item_id) where deleted_at is null;
select private.standardise_table('public.order_lines');

create table public.order_events (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id),
  from_status  text,
  to_status    text not null,
  note         text,
  by_user      uuid references public.app_users (id) default private.current_app_user_id(),
  at           timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create index order_events_order_idx on public.order_events (order_id, at);
select private.standardise_table('public.order_events');

-- Read: office users in their firms; salesmen their own orders and their beats' customers.
create policy orders_read on public.orders for select to authenticated
  using (deleted_at is null and firm_id = any(private.my_firm_ids()) and (
    private.is_office_user()
    or salesman_id = private.current_app_user_id()
    or exists (select 1 from public.customers c where c.id = customer_id and c.beat_id = any(private.my_sales_beat_ids()))
  ));
create policy order_lines_read on public.order_lines for select to authenticated
  using (deleted_at is null and exists (select 1 from public.orders o where o.id = order_id));
create policy order_events_read on public.order_events for select to authenticated
  using (deleted_at is null and exists (select 1 from public.orders o where o.id = order_id));

-- Status changes always leave an event.
create or replace function private.order_status_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, from_status, to_status) values (new.id, null, new.status);
  elsif new.status is distinct from old.status then
    insert into public.order_events (order_id, from_status, to_status, note)
    values (new.id, old.status, new.status, nullif(current_setting('sa.order_note', true), ''));
  end if;
  return new;
end;
$$;
create trigger order_status_event after insert or update of status on public.orders
  for each row execute function private.order_status_event();

-- -----------------------------------------------------------------------------
-- Create an order. Idempotent on client_op_id (the field app may resend).
-- p = {client_op_id, firm_id, customer_id, source, order_date?, note?, lat?, lng?,
--      lines: [{item_id, qty, rate?}]}  — rate defaults to the list rate.
-- -----------------------------------------------------------------------------
create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := private.current_app_user_id();
  v_op       uuid := (p ->> 'client_op_id')::uuid;
  v_firm     uuid := (p ->> 'firm_id')::uuid;
  v_cust     uuid := (p ->> 'customer_id')::uuid;
  v_source   text := coalesce(p ->> 'source', 'office');
  v_date     date := coalesce((p ->> 'order_date')::date, private.today_ist());
  v_gstfirm  boolean;
  c          public.customers;
  o          public.orders;
  x          jsonb;
  it         public.items;
  v_list     numeric;
  v_rate     numeric;
  v_qty      numeric;
  v_taxable  numeric;
  v_gst      numeric;
  v_line     int := 0;
  v_credit   jsonb;
  v_disc     numeric := 0;
  v_reasons  text;
  v_pending  int := 0;
  v_seen     uuid[] := '{}';
begin
  if v_me is null or not private.has_perm('order.create') then
    raise exception 'You are not allowed to take orders' using errcode = 'insufficient_privilege';
  end if;
  if v_op is null then
    raise exception 'Missing client_op_id' using errcode = 'check_violation';
  end if;
  select * into o from public.orders where client_op_id = v_op;
  if found then
    return jsonb_build_object('status', 'duplicate', 'id', o.id, 'order_no', o.order_no, 'order_status', o.status);
  end if;

  if v_source not in ('salesman', 'office', 'whatsapp_paste', 'counter') then
    raise exception 'Unknown order source' using errcode = 'check_violation';
  end if;
  if not (v_firm = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  select * into c from public.customers where id = v_cust and deleted_at is null;
  if not found then
    raise exception 'Customer not found' using errcode = 'no_data_found';
  end if;
  if not private.is_office_user() and not (c.beat_id = any(private.my_sales_beat_ids())) then
    raise exception 'This customer is not in your beats' using errcode = 'insufficient_privilege';
  end if;
  if c.status = 'ignore' then
    raise exception 'This customer is marked ignore' using errcode = 'check_violation';
  end if;
  if v_date < private.today_ist() - 7 or v_date > private.today_ist() + 7 then
    raise exception 'Order date must be within a week of today' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then
    raise exception 'Add at least one item' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p -> 'lines') > 100 then
    raise exception 'At most 100 lines per order' using errcode = 'check_violation';
  end if;
  select gst_registered into v_gstfirm from public.firms where id = v_firm;

  insert into public.orders (firm_id, order_no, customer_id, source, salesman_id, order_date, note, lat, lng, client_op_id)
  values (v_firm, private.next_doc_no(v_firm, 'O', v_date), v_cust, v_source,
          case when v_source = 'salesman' then v_me end, v_date,
          nullif(trim(p ->> 'note'), ''), (p ->> 'lat')::numeric, (p ->> 'lng')::numeric, v_op)
  returning * into o;

  for x in select * from jsonb_array_elements(p -> 'lines') loop
    select * into it from public.items where id = (x ->> 'item_id')::uuid and deleted_at is null and active;
    if not found then
      raise exception 'Item not found or not active' using errcode = 'check_violation';
    end if;
    if it.id = any(v_seen) then
      raise exception '% is on the order twice', it.name using errcode = 'check_violation';
    end if;
    v_seen := v_seen || it.id;
    v_qty := round((x ->> 'qty')::numeric, 3);
    if v_qty is null or v_qty <= 0 or v_qty > 100000 then
      raise exception 'Quantity for % must be more than 0', it.name using errcode = 'check_violation';
    end if;
    select cp.rate into v_list from public.v_current_prices cp where cp.firm_id = v_firm and cp.item_id = it.id;
    v_rate := round(coalesce((x ->> 'rate')::numeric, v_list), 4);
    if v_rate is null or v_rate <= 0 then
      raise exception '% has no rate in the price list; enter a rate', it.name using errcode = 'check_violation';
    end if;
    v_line := v_line + 1;
    v_taxable := round(v_qty * v_rate, 2);
    v_gst := case when v_gstfirm then round(v_taxable * it.gst_rate / 100, 2) else 0 end;
    if v_list is not null and v_rate < v_list then
      v_disc := v_disc + round(v_qty * (v_list - v_rate), 2);
    end if;
    insert into public.order_lines (order_id, line_no, item_id, unit, qty, kg, list_rate, rate, gst_rate, taxable, gst, amount)
    values (o.id, v_line, it.id, it.unit, v_qty, round(v_qty * it.kg_per_unit, 3), v_list, v_rate,
            case when v_gstfirm then it.gst_rate else 0 end, v_taxable, v_gst, v_taxable + v_gst);
  end loop;

  update public.orders s
     set taxable = t.taxable, gst = t.gst, total = t.taxable + t.gst, total_kg = t.kg, discount = v_disc
    from (select sum(l.taxable) taxable, sum(l.gst) gst, sum(l.kg) kg from public.order_lines l where l.order_id = o.id) t
   where s.id = o.id
  returning s.* into o;

  -- Credit check (counter cash sales skip it, D-09).
  v_credit := private.credit_eval(v_firm, v_cust, o.total, case when v_source = 'counter' then 'counter_cash' else 'credit' end);
  update public.orders set credit_check = v_credit where id = o.id;

  if not (v_credit ->> 'ok')::boolean then
    v_reasons := (select string_agg(r ->> 'text', '; ') from jsonb_array_elements(v_credit -> 'reasons') r);
    insert into public.approval_requests (firm_id, kind, permission_key, subject_table, subject_id, subject_label,
                                          amount, is_bad_debt, reason, details)
    values (v_firm, 'order', 'order.approve', 'orders', o.id, format('Order %s · %s', o.order_no, c.name),
            o.total, c.status = 'bad_debt', v_reasons, jsonb_build_object('credit', v_credit));
    v_pending := v_pending + 1;
  end if;
  if v_disc > 0 then
    insert into public.approval_requests (firm_id, kind, permission_key, subject_table, subject_id, subject_label,
                                          amount, is_bad_debt, reason, details)
    values (v_firm, 'discount', 'discount.approve', 'orders', o.id, format('Order %s · %s', o.order_no, c.name),
            v_disc, c.status = 'bad_debt',
            (select string_agg(format('%s at %s (list %s)', i.name, trim(to_char(l.rate, 'FM9999999990.00')),
                                      trim(to_char(l.list_rate, 'FM9999999990.00'))), '; ' order by l.line_no)
               from public.order_lines l join public.items i on i.id = l.item_id
              where l.order_id = o.id and l.rate < l.list_rate),
            jsonb_build_object('discount', v_disc));
    v_pending := v_pending + 1;
  end if;
  if v_pending = 0 then
    perform set_config('sa.order_note', 'Passed the credit check', true);
    update public.orders set status = 'approved' where id = o.id;
    perform set_config('sa.order_note', '', true);
  end if;

  select * into o from public.orders where id = o.id;
  return jsonb_build_object('status', 'created', 'id', o.id, 'order_no', o.order_no, 'order_status', o.status,
                            'total', o.total, 'credit', v_credit, 'discount', v_disc);
end;
$$;

-- An approval decision moves the order on: approved once nothing is waiting,
-- rejected as soon as one request is rejected.
create or replace function private.approval_settles_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subject_table <> 'orders' or old.status <> 'pending' or new.status = 'pending' then
    return new;
  end if;
  if new.status = 'rejected' then
    perform set_config('sa.order_note', coalesce(format('%s rejected: %s', new.kind, new.decision_note), new.kind || ' rejected'), true);
    update public.orders set status = 'rejected' where id = new.subject_id and status = 'pending_approval';
  elsif new.status = 'approved'
        and not exists (select 1 from public.approval_requests r
                         where r.subject_table = 'orders' and r.subject_id = new.subject_id
                           and r.status = 'pending' and r.id <> new.id and r.deleted_at is null) then
    perform set_config('sa.order_note', coalesce('Approved: ' || new.decision_note, 'Approved'), true);
    update public.orders set status = 'approved' where id = new.subject_id and status = 'pending_approval';
  end if;
  perform set_config('sa.order_note', '', true);
  return new;
end;
$$;
create trigger approval_settles_order
  after update of status on public.approval_requests
  for each row execute function private.approval_settles_order();

-- Cancel before loading. The order taker, or office staff with order.create.
create or replace function public.cancel_order(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders;
begin
  select * into o from public.orders where id = p_id and deleted_at is null for update;
  if not found or not (o.firm_id = any(private.my_firm_ids())) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if not (private.is_owner()
          or (private.has_perm('order.create') and (private.is_office_user() or o.created_by = auth.uid()))) then
    raise exception 'You cannot cancel this order' using errcode = 'insufficient_privilege';
  end if;
  if o.status not in ('pending_approval', 'approved', 'rejected') then
    raise exception 'An order that is % cannot be cancelled', o.status using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason' using errcode = 'check_violation';
  end if;
  perform set_config('sa.order_note', trim(p_reason), true);
  update public.orders set status = 'cancelled' where id = p_id;
  perform set_config('sa.order_note', '', true);
  update public.approval_requests
     set status = 'cancelled', decided_at = now(), decided_by = private.current_app_user_id(), decision_note = 'Order cancelled'
   where subject_table = 'orders' and subject_id = p_id and status = 'pending';
end;
$$;

-- What a customer usually buys: items from the last 90 days of Tally sales and
-- ERP orders, most frequent first, with the last quantity and today's rate.
create or replace function public.customer_usual_items(p_firm_id uuid, p_customer_id uuid)
returns table (item_id uuid, item_name text, unit text, kg_per_unit numeric, times bigint,
               last_qty numeric, last_date date, rate numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with ok as (
    select p_firm_id = any(private.my_firm_ids())
           and (private.is_office_user()
                or exists (select 1 from public.customers c where c.id = p_customer_id and c.beat_id = any(private.my_sales_beat_ids())))
           as allowed
  ),
  acct as (
    select private.ledger_key(coalesce(a.tally_ledger_name, c.name)) as nm
      from public.customers c
      left join public.customer_firm_accounts a on a.customer_id = c.id and a.firm_id = p_firm_id and a.deleted_at is null
     where c.id = p_customer_id
  ),
  hist as (
    select a.item_id, v.voucher_date as d, l.qty
      from tally.voucher_lines l
      join tally.vouchers v on v.id = l.voucher_id and v.voucher_kind = 'sales' and v.removed_at is null and not coalesce(v.is_voided, false)
      join tally.v_company_firm cf on cf.company_id = v.company_id and cf.firm_id = p_firm_id
      join acct on private.ledger_key(v.party_name) = acct.nm
      join public.item_aliases a on a.source = 'tally' and lower(a.alias_name) = lower(l.item_name) and a.deleted_at is null
     where l.removed_at is null and l.qty > 0 and v.voucher_date >= private.today_ist() - 90
    union all
    select l.item_id, o.order_date, l.qty
      from public.orders o join public.order_lines l on l.order_id = o.id and l.deleted_at is null
     where o.firm_id = p_firm_id and o.customer_id = p_customer_id and o.deleted_at is null
       and o.status not in ('cancelled', 'rejected') and o.order_date >= private.today_ist() - 90
  )
  select i.id, i.name, i.unit, i.kg_per_unit, count(*),
         (array_agg(h.qty order by h.d desc))[1], max(h.d), cp.rate
    from hist h
    cross join ok
    join public.items i on i.id = h.item_id and i.deleted_at is null and i.active
    left join public.v_current_prices cp on cp.firm_id = p_firm_id and cp.item_id = i.id
   where ok.allowed
   group by i.id, i.name, i.unit, i.kg_per_unit, cp.rate
   order by count(*) desc, max(h.d) desc
$$;

revoke execute on function private.order_status_event(), private.approval_settles_order() from public, anon, authenticated;
revoke execute on function public.set_prices(uuid, jsonb, text), public.create_order(jsonb),
  public.cancel_order(uuid, text), public.customer_usual_items(uuid, uuid) from public, anon;
grant execute on function public.set_prices(uuid, jsonb, text), public.create_order(jsonb),
  public.cancel_order(uuid, text), public.customer_usual_items(uuid, uuid) to authenticated;
