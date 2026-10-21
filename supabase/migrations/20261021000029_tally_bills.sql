-- =============================================================================
-- SA ERP · 0029 Tally bills linked back to orders (slice 2.5, D-73, D-74)
-- Both firms keep billing in Tally (owner). After every Tally sync each new
-- sales bill is linked to the open ERP order of the same firm and customer
-- that has an item in common, ordered up to 10 days before the bill. The bill
-- and its lines are kept as an invoice; billed quantities go on the order
-- lines; an approved or loading order becomes "invoiced". Bills the ERP can't
-- place stay unlinked and can be linked by hand on the order.
-- =============================================================================

insert into public.app_settings (key, value, description)
values ('order_link_from', '"2026-10-21"'::jsonb, 'Tally bills from this date are linked to ERP orders (D-73)')
on conflict (key) do nothing;

create table public.invoices (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms (id),
  invoice_no        text not null,
  invoice_date      date not null,
  customer_id       uuid references public.customers (id),
  order_id          uuid references public.orders (id),
  source            text not null default 'tally' check (source in ('tally', 'erp')),
  tally_voucher_id  uuid,
  party_name        text,
  taxable           numeric(14,2) not null default 0,
  gst               numeric(14,2) not null default 0,
  round_off         numeric(14,2) not null default 0,
  total             numeric(14,2) not null default 0,
  link_method       text check (link_method in ('auto', 'manual')),
  linked_by         uuid references public.app_users (id),
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid
);
create unique index invoices_tally_uq on public.invoices (tally_voucher_id) where deleted_at is null;
create index invoices_order_idx on public.invoices (order_id) where deleted_at is null;
select private.standardise_table('public.invoices');
create policy invoices_read on public.invoices for select to authenticated
  using (deleted_at is null and firm_id = any(private.my_firm_ids())
         and (private.is_office_user() or exists (select 1 from public.orders o where o.id = order_id)));

create table public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id),
  line_no     int not null,
  item_id     uuid references public.items (id),
  item_name   text not null,
  qty         numeric(12,3) not null default 0,
  qty_text    text,
  kg          numeric(12,3),
  rate        numeric(14,4),
  amount      numeric(14,2) not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create index invoice_lines_invoice_idx on public.invoice_lines (invoice_id) where deleted_at is null;
select private.standardise_table('public.invoice_lines');
create policy invoice_lines_read on public.invoice_lines for select to authenticated
  using (deleted_at is null and exists (select 1 from public.invoices i where i.id = invoice_id));

-- The ERP customer of a Tally bill: the firm account's ledger name, else the receivables link.
create or replace function tally.bill_customer(p_firm_id uuid, p_party text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select a.customer_id from public.customer_firm_accounts a
      where a.firm_id = p_firm_id and a.deleted_at is null and a.tally_ledger_name is not null
        and private.ledger_key(a.tally_ledger_name) = private.ledger_key(p_party)
      limit 1),
    (select b.customer_id from tally.mv_ar_balances b where b.firm_id = p_firm_id and b.nm = private.ledger_key(p_party))
  )
$$;

-- Record a Tally bill against an order: invoice + lines, billed quantities, status.
create or replace function private.attach_bill(p_voucher_id uuid, p_order_id uuid, p_method text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v  tally.vouchers;
  o  public.orders;
  v_id uuid;
begin
  select * into v from tally.vouchers where id = p_voucher_id;
  select * into o from public.orders where id = p_order_id for update;
  insert into public.invoices (firm_id, invoice_no, invoice_date, customer_id, order_id, source, tally_voucher_id, party_name,
                               taxable, gst, round_off, total, link_method, linked_by)
  values (o.firm_id, v.voucher_no, v.voucher_date, o.customer_id, o.id, 'tally', v.id, v.party_name,
          coalesce((select sum(l.amount) from tally.voucher_lines l where l.voucher_id = v.id and l.removed_at is null), 0),
          coalesce(v.cgst, 0) + coalesce(v.sgst, 0) + coalesce(v.igst, 0), coalesce(v.round_off, 0), coalesce(v.total_amount, 0),
          p_method, p_actor)
  returning id into v_id;
  insert into public.invoice_lines (invoice_id, line_no, item_id, item_name, qty, qty_text, kg, rate, amount)
  select v_id, row_number() over (order by l.line_no, l.id),
         (select a.item_id from public.item_aliases a where a.source = 'tally' and lower(a.alias_name) = lower(l.item_name) and a.deleted_at is null limit 1),
         l.item_name, coalesce(l.qty, 0), l.qty_raw_text, l.qty_kg, l.rate, coalesce(l.amount, 0)
    from tally.voucher_lines l
   where l.voucher_id = v.id and l.removed_at is null;
  perform private.refresh_billed(o.id);
  return v_id;
end;
$$;

-- Billed quantity per order line from its linked bills; status follows.
create or replace function private.refresh_billed(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders;
begin
  update public.order_lines ol
     set qty_invoiced = coalesce((select sum(il.qty) from public.invoice_lines il
                                   join public.invoices i on i.id = il.invoice_id and i.deleted_at is null
                                  where i.order_id = p_order_id and il.item_id = ol.item_id and il.deleted_at is null), 0)
   where ol.order_id = p_order_id and ol.deleted_at is null;
  select * into o from public.orders where id = p_order_id;
  if exists (select 1 from public.invoices where order_id = p_order_id and deleted_at is null) then
    if o.status in ('approved', 'loading') then
      perform set_config('sa.order_note', 'Tally bill ' || (select string_agg(invoice_no, ', ') from public.invoices where order_id = p_order_id and deleted_at is null), true);
      update public.orders set status = 'invoiced' where id = p_order_id;
      perform set_config('sa.order_note', '', true);
    end if;
  elsif o.status = 'invoiced' then
    perform set_config('sa.order_note', 'Tally bill unlinked', true);
    update public.orders set status = case when exists (select 1 from public.dispatch_orders x join public.dispatches d on d.id = x.dispatch_id
                                                          where x.order_id = p_order_id and x.deleted_at is null and d.status = 'loading')
                                           then 'loading' else 'approved' end
     where id = p_order_id;
    perform set_config('sa.order_note', '', true);
  end if;
end;
$$;

-- Automatic linking, run after every Tally sync.
create or replace function tally.link_sales_orders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_from date := coalesce((select (value #>> '{}')::date from public.app_settings where key = 'order_link_from' and deleted_at is null), private.today_ist());
  r record;
  v_cust uuid;
  v_order uuid;
  v_n int := 0;
begin
  for r in
    select v.id, v.voucher_date, v.party_name, cf.firm_id
      from tally.vouchers v
      join tally.v_company_firm cf on cf.company_id = v.company_id
     where v.voucher_kind = 'sales' and v.removed_at is null and not coalesce(v.is_voided, false)
       and v.voucher_date >= greatest(v_from, private.today_ist() - 30)
       and not exists (select 1 from public.invoices i where i.tally_voucher_id = v.id and i.deleted_at is null)
     order by v.voucher_date, v.first_seen_at
  loop
    v_cust := tally.bill_customer(r.firm_id, r.party_name);
    continue when v_cust is null;
    select o.id into v_order
      from public.orders o
     where o.firm_id = r.firm_id and o.customer_id = v_cust and o.deleted_at is null
       and o.status in ('pending_approval', 'approved', 'loading', 'invoiced', 'dispatched', 'delivered')
       and o.order_date between r.voucher_date - 10 and r.voucher_date + 1
       -- not yet fully billed
       and exists (select 1 from public.order_lines ol where ol.order_id = o.id and ol.deleted_at is null and ol.qty_invoiced < ol.qty)
       -- has an item in common with the bill
       and exists (select 1 from public.order_lines ol
                     join public.item_aliases a on a.item_id = ol.item_id and a.source = 'tally' and a.deleted_at is null
                     join tally.voucher_lines vl on vl.voucher_id = r.id and vl.removed_at is null and lower(vl.item_name) = lower(a.alias_name)
                    where ol.order_id = o.id and ol.deleted_at is null)
     order by o.order_date, o.created_at
     limit 1;
    continue when v_order is null;
    perform private.attach_bill(r.id, v_order, 'auto', null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Office: Tally bills that could belong to an order (same firm and customer, near its date, not linked).
create or replace function public.order_bill_candidates(p_order_id uuid)
returns table (voucher_id uuid, voucher_no text, voucher_date date, party_name text, total numeric, lines text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.voucher_no, v.voucher_date, v.party_name, v.total_amount,
         (select string_agg(l.item_name || ' ' || coalesce(l.qty_raw_text, l.qty::text), '; ' order by l.line_no)
            from tally.voucher_lines l where l.voucher_id = v.id and l.removed_at is null)
    from public.orders o
    join tally.v_company_firm cf on cf.firm_id = o.firm_id
    join tally.vouchers v on v.company_id = cf.company_id and v.voucher_kind = 'sales' and v.removed_at is null
         and not coalesce(v.is_voided, false)
         and v.voucher_date between o.order_date - 3 and o.order_date + 15
   where o.id = p_order_id and private.is_office_user() and o.firm_id = any(private.my_firm_ids())
     and not exists (select 1 from public.invoices i where i.tally_voucher_id = v.id and i.deleted_at is null)
     and (tally.bill_customer(o.firm_id, v.party_name) = o.customer_id
          or extensions.similarity(lower(v.party_name), lower((select c.name from public.customers c where c.id = o.customer_id))) > 0.4)
   order by (tally.bill_customer(o.firm_id, v.party_name) = o.customer_id) desc, abs(v.voucher_date - o.order_date), v.voucher_no
   limit 20
$$;

create or replace function public.link_bill(p_order_id uuid, p_voucher_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare o public.orders;
begin
  if not (private.is_office_user() and (private.has_perm('order.create') or private.has_perm('dispatch.manage'))) then
    raise exception 'You are not allowed to link bills' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.orders where id = p_order_id and deleted_at is null;
  if not found or not (o.firm_id = any(private.my_firm_ids())) then
    raise exception 'Order not found' using errcode = 'no_data_found';
  end if;
  if o.status in ('cancelled', 'rejected') then
    raise exception 'This order is %', o.status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from tally.vouchers v join tally.v_company_firm cf on cf.company_id = v.company_id
                  where v.id = p_voucher_id and cf.firm_id = o.firm_id and v.voucher_kind = 'sales' and v.removed_at is null) then
    raise exception 'That Tally bill is not a % sale', (select code from public.firms where id = o.firm_id) using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.invoices where tally_voucher_id = p_voucher_id and deleted_at is null) then
    raise exception 'That bill is already linked to an order' using errcode = 'check_violation';
  end if;
  return private.attach_bill(p_voucher_id, p_order_id, 'manual', private.current_app_user_id());
end;
$$;

create or replace function public.unlink_bill(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare i public.invoices;
begin
  if not (private.is_office_user() and (private.has_perm('order.create') or private.has_perm('dispatch.manage'))) then
    raise exception 'You are not allowed to unlink bills' using errcode = 'insufficient_privilege';
  end if;
  select * into i from public.invoices where id = p_invoice_id and deleted_at is null and firm_id = any(private.my_firm_ids());
  if not found then
    raise exception 'Bill not found' using errcode = 'no_data_found';
  end if;
  update public.invoice_lines set deleted_at = now(), deleted_by = auth.uid() where invoice_id = i.id and deleted_at is null;
  update public.invoices set deleted_at = now(), deleted_by = auth.uid() where id = i.id;
  if i.order_id is not null then
    perform private.refresh_billed(i.order_id);
  end if;
end;
$$;

create or replace function public.dispatch_board(p_date date)
returns table (
  order_id uuid, order_no text, firm_code text, order_date date, planned_date date, status text,
  customer_id uuid, customer_name text, beat_id uuid, beat_name text, route_kind text, territory_name text,
  total numeric, total_kg numeric, lines bigint, dispatch_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_no, f.code, o.order_date, o.planned_date, o.status,
         c.id, c.name, b.id, b.name, b.route_kind, t.name,
         o.total, o.total_kg, (select count(*) from public.order_lines l where l.order_id = o.id and l.deleted_at is null),
         d.dispatch_id
    from public.orders o
    join public.firms f on f.id = o.firm_id
    join public.customers c on c.id = o.customer_id
    left join public.beats b on b.id = c.beat_id
    left join public.territories t on t.id = b.territory_id
    left join public.dispatch_orders d on d.order_id = o.id and d.deleted_at is null
   where o.deleted_at is null
     and private.is_office_user() and o.firm_id = any(private.my_firm_ids())
     and o.source <> 'counter'
     and ((o.status in ('approved', 'invoiced') and d.dispatch_id is null and coalesce(o.planned_date, o.order_date) <= p_date)
          or exists (select 1 from public.dispatches x where x.id = d.dispatch_id and x.route_date = p_date and x.deleted_at is null))
$$;

create or replace function public.dispatch_add_orders(p_dispatch_id uuid, p_order_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dispatches;
  o public.orders;
  v_seq int;
  v_n int := 0;
  x uuid;
begin
  perform private.require_dispatch();
  select * into d from public.dispatches where id = p_dispatch_id and deleted_at is null for update;
  if not found or d.status not in ('planned', 'loading') then
    raise exception 'Orders can only be added before the vehicle leaves' using errcode = 'check_violation';
  end if;
  select coalesce(max(seq), 0) into v_seq from public.dispatch_orders where dispatch_id = d.id and deleted_at is null;
  foreach x in array p_order_ids loop
    select * into o from public.orders where id = x and deleted_at is null for update;
    if not found or not (o.firm_id = any(private.my_firm_ids())) then
      raise exception 'Order not found' using errcode = 'no_data_found';
    end if;
    if o.status not in ('approved', 'invoiced') then
      raise exception 'Order % is %; only approved or billed orders can be loaded', o.order_no, o.status using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.dispatch_orders where order_id = o.id and deleted_at is null) then
      raise exception 'Order % is already on a dispatch', o.order_no using errcode = 'check_violation';
    end if;
    v_seq := v_seq + 1;
    insert into public.dispatch_orders (dispatch_id, order_id, seq) values (d.id, o.id, v_seq);
    if d.status = 'loading' then
      perform set_config('sa.order_note', 'Loading on ' || d.dispatch_no, true);
      update public.orders set status = 'loading' where id = o.id and status = 'approved';
    end if;
    v_n := v_n + 1;
  end loop;
  perform set_config('sa.order_note', '', true);
  return v_n;
end;
$$;

create or replace function public.dispatch_set_status(p_dispatch_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.dispatches;
  v_to_order text;
begin
  perform private.require_dispatch();
  select * into d from public.dispatches where id = p_dispatch_id and deleted_at is null for update;
  if not found then
    raise exception 'Dispatch not found' using errcode = 'no_data_found';
  end if;
  if not ((d.status = 'planned' and p_status in ('loading', 'cancelled'))
          or (d.status = 'loading' and p_status in ('departed', 'cancelled', 'planned'))
          or (d.status = 'departed' and p_status = 'returned')) then
    raise exception 'A % dispatch cannot become %', d.status, p_status using errcode = 'check_violation';
  end if;
  if p_status = 'departed' then
    if d.vehicle_id is null or d.driver_id is null then
      raise exception 'Set the vehicle and the driver before it leaves' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from public.dispatch_orders where dispatch_id = d.id and deleted_at is null) then
      raise exception 'There are no orders on this dispatch' using errcode = 'check_violation';
    end if;
  end if;

  update public.dispatches
     set status = p_status,
         loading_at = case when p_status = 'loading' then now() else loading_at end,
         departed_at = case when p_status = 'departed' then now() else departed_at end,
         returned_at = case when p_status = 'returned' then now() else returned_at end
   where id = d.id;

  v_to_order := case p_status when 'loading' then 'loading' when 'departed' then 'dispatched'
                              when 'cancelled' then 'approved' when 'planned' then 'approved' end;
  if v_to_order is not null then
    perform set_config('sa.order_note', format('%s %s', d.dispatch_no, p_status), true);
    update public.orders o set status = v_to_order
      from public.dispatch_orders x
     where x.dispatch_id = d.id and x.deleted_at is null and x.order_id = o.id
       and (o.status in ('approved', 'loading') or (o.status = 'invoiced' and v_to_order = 'dispatched'));
    perform set_config('sa.order_note', '', true);
  end if;
  if p_status = 'cancelled' then
    update public.dispatch_orders set deleted_at = now(), deleted_by = auth.uid() where dispatch_id = d.id and deleted_at is null;
  end if;
end;
$$;

-- Tally sync: link new bills to orders after matching receipts (a failure here never fails the sync).
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
    begin
      v_counts := v_counts || jsonb_build_object('orders_billed', tally.link_sales_orders());
    exception when others then
      v_counts := v_counts || jsonb_build_object('orders_billed_error', sqlerrm);
    end;
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

revoke all on all functions in schema tally from public;
revoke execute on function private.attach_bill(uuid, uuid, text, uuid), private.refresh_billed(uuid) from public, anon, authenticated;
revoke execute on function public.order_bill_candidates(uuid), public.link_bill(uuid, uuid), public.unlink_bill(uuid) from public, anon;
grant execute on function public.order_bill_candidates(uuid), public.link_bill(uuid, uuid), public.unlink_bill(uuid) to authenticated;
