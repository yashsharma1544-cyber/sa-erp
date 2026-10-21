-- =============================================================================
-- SA ERP · 0028 Oil switched off; dispatch planning and loading (slice 2.4)
--   D-70 oil is not handled in the ERP: oil items are made inactive.
--   D-71 every order gets a planned delivery date from its beat's route:
--        city → the order date, outstation → the next route weekday after it,
--        Mondha counter → no delivery (picked up).
--   D-72 a dispatch is one vehicle trip on a date (it may carry both firms'
--        orders; the loading sheet keeps them apart). Orders move
--        approved → loading → dispatched with it.
-- =============================================================================

-- D-70: no oil anywhere in the ERP (items stay, inactive; switch back by hand if ever needed).
update public.items set active = false where category = 'oil' and active and deleted_at is null;
update public.brands set active = false where category = 'oil' and active and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Planned delivery date
-- -----------------------------------------------------------------------------
alter table public.orders add column if not exists planned_date date;

create or replace function private.route_date(p_customer_id uuid, p_order_date date)
returns date
language sql
stable
set search_path = ''
as $$
  select case
           when b.route_kind = 'counter' then null
           when b.route_kind = 'outstation' and b.route_weekday is not null
             then p_order_date + 1 + ((b.route_weekday - extract(dow from p_order_date + 1)::int + 7) % 7)
           else p_order_date
         end
    from public.customers c
    left join public.beats b on b.id = c.beat_id
   where c.id = p_customer_id
$$;

create or replace function private.order_planned_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.planned_date is null and new.source <> 'counter' then
    new.planned_date := private.route_date(new.customer_id, new.order_date);
  end if;
  return new;
end;
$$;
create trigger order_planned_date before insert on public.orders
  for each row execute function private.order_planned_date();
update public.orders set planned_date = private.route_date(customer_id, order_date)
 where planned_date is null and source <> 'counter';

-- -----------------------------------------------------------------------------
-- Dispatches
-- -----------------------------------------------------------------------------
create table public.dispatches (
  id           uuid primary key default gen_random_uuid(),
  dispatch_no  text not null unique,
  route_date   date not null,
  vehicle_id   uuid references public.vehicles (id),
  driver_id    uuid references public.app_users (id),
  helpers      text,
  status       text not null default 'planned'
               check (status in ('planned', 'loading', 'departed', 'returned', 'cancelled')),
  note         text,
  loading_at   timestamptz,
  departed_at  timestamptz,
  returned_at  timestamptz,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create index dispatches_date_idx on public.dispatches (route_date) where deleted_at is null;
select private.standardise_table('public.dispatches');

create table public.dispatch_orders (
  id           uuid primary key default gen_random_uuid(),
  dispatch_id  uuid not null references public.dispatches (id),
  order_id     uuid not null references public.orders (id),
  seq          int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
-- An order rides on one dispatch at a time.
create unique index dispatch_orders_order_uq on public.dispatch_orders (order_id) where deleted_at is null;
create index dispatch_orders_dispatch_idx on public.dispatch_orders (dispatch_id) where deleted_at is null;
select private.standardise_table('public.dispatch_orders');

create policy dispatches_read on public.dispatches for select to authenticated
  using (deleted_at is null and (private.is_office_user() or driver_id = private.current_app_user_id()));
create policy dispatch_orders_read on public.dispatch_orders for select to authenticated
  using (deleted_at is null and exists (select 1 from public.dispatches d where d.id = dispatch_id));

create or replace function private.require_dispatch()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('dispatch.manage') then
    raise exception 'You are not allowed to plan dispatches' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- Orders waiting for a vehicle: approved, not on a dispatch, due on or before the date.
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
     and ((o.status = 'approved' and d.dispatch_id is null and coalesce(o.planned_date, o.order_date) <= p_date)
          or exists (select 1 from public.dispatches x where x.id = d.dispatch_id and x.route_date = p_date and x.deleted_at is null))
$$;

create or replace function public.create_dispatch(p_route_date date, p_vehicle_id uuid, p_driver_id uuid, p_helpers text, p_order_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_n int;
begin
  perform private.require_dispatch();
  if p_route_date < private.today_ist() - 1 or p_route_date > private.today_ist() + 14 then
    raise exception 'Route date must be from yesterday to two weeks ahead' using errcode = 'check_violation';
  end if;
  if p_vehicle_id is not null and not exists (select 1 from public.vehicles where id = p_vehicle_id and active and deleted_at is null) then
    raise exception 'Vehicle not found' using errcode = 'check_violation';
  end if;
  if p_driver_id is not null and not exists (select 1 from public.app_users u join public.user_roles r on r.user_id = u.id
                                              where u.id = p_driver_id and r.role = 'driver' and r.deleted_at is null and u.active) then
    raise exception 'Pick a driver (a user with the driver role)' using errcode = 'check_violation';
  end if;
  select count(*) + 1 into v_n from public.dispatches where route_date = p_route_date;
  insert into public.dispatches (dispatch_no, route_date, vehicle_id, driver_id, helpers)
  values ('D-' || to_char(p_route_date, 'DDMMYY') || '-' || v_n, p_route_date, p_vehicle_id, p_driver_id, nullif(trim(p_helpers), ''))
  returning id into v_id;
  if coalesce(array_length(p_order_ids, 1), 0) > 0 then
    perform public.dispatch_add_orders(v_id, p_order_ids);
  end if;
  return v_id;
end;
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
    if o.status <> 'approved' then
      raise exception 'Order % is %; only approved orders can be loaded', o.order_no, o.status using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.dispatch_orders where order_id = o.id and deleted_at is null) then
      raise exception 'Order % is already on a dispatch', o.order_no using errcode = 'check_violation';
    end if;
    v_seq := v_seq + 1;
    insert into public.dispatch_orders (dispatch_id, order_id, seq) values (d.id, o.id, v_seq);
    if d.status = 'loading' then
      perform set_config('sa.order_note', 'Loading on ' || d.dispatch_no, true);
      update public.orders set status = 'loading' where id = o.id;
    end if;
    v_n := v_n + 1;
  end loop;
  perform set_config('sa.order_note', '', true);
  return v_n;
end;
$$;

create or replace function public.dispatch_remove_order(p_dispatch_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare d public.dispatches;
begin
  perform private.require_dispatch();
  select * into d from public.dispatches where id = p_dispatch_id and deleted_at is null for update;
  if not found or d.status not in ('planned', 'loading') then
    raise exception 'Orders can only be taken off before the vehicle leaves' using errcode = 'check_violation';
  end if;
  update public.dispatch_orders set deleted_at = now(), deleted_by = auth.uid()
   where dispatch_id = d.id and order_id = p_order_id and deleted_at is null;
  if not found then
    raise exception 'That order is not on this dispatch' using errcode = 'no_data_found';
  end if;
  perform set_config('sa.order_note', 'Taken off ' || d.dispatch_no, true);
  update public.orders set status = 'approved' where id = p_order_id and status = 'loading';
  perform set_config('sa.order_note', '', true);
end;
$$;

create or replace function public.dispatch_update(p_dispatch_id uuid, p_vehicle_id uuid, p_driver_id uuid, p_helpers text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_dispatch();
  if p_driver_id is not null and not exists (select 1 from public.user_roles r where r.user_id = p_driver_id and r.role = 'driver' and r.deleted_at is null) then
    raise exception 'Pick a driver (a user with the driver role)' using errcode = 'check_violation';
  end if;
  update public.dispatches
     set vehicle_id = p_vehicle_id, driver_id = p_driver_id, helpers = nullif(trim(p_helpers), ''), note = nullif(trim(p_note), '')
   where id = p_dispatch_id and deleted_at is null and status in ('planned', 'loading');
  if not found then
    raise exception 'Only a dispatch that has not left can be changed' using errcode = 'check_violation';
  end if;
end;
$$;

-- planned → loading → departed → returned; planned/loading → cancelled (orders back to approved).
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
       and o.status in ('approved', 'loading');
    perform set_config('sa.order_note', '', true);
  end if;
  if p_status = 'cancelled' then
    update public.dispatch_orders set deleted_at = now(), deleted_by = auth.uid() where dispatch_id = d.id and deleted_at is null;
  end if;
end;
$$;

-- Move an order to another delivery date (e.g. city order to tomorrow).
create or replace function public.set_order_planned_date(p_order_id uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_dispatch();
  if p_date < private.today_ist() - 1 or p_date > private.today_ist() + 30 then
    raise exception 'Pick a date from yesterday to a month ahead' using errcode = 'check_violation';
  end if;
  update public.orders set planned_date = p_date
   where id = p_order_id and deleted_at is null and status in ('pending_approval', 'approved') and firm_id = any(private.my_firm_ids());
  if not found then
    raise exception 'Only orders not yet loaded can be moved' using errcode = 'check_violation';
  end if;
end;
$$;

-- Loading sheet: item totals by firm, with bags and loose packets (D-72).
create or replace function public.dispatch_loading_items(p_dispatch_id uuid)
returns table (firm_code text, item_id uuid, item_name text, unit text, qty numeric, kg numeric,
               pack_size_g numeric, units_per_case numeric, packets numeric, full_cases numeric, loose_packets numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select f.code, i.id, i.name, i.unit, sum(l.qty) qty, sum(l.kg) kg, i.pack_size_g, i.units_per_case,
           case
             when i.pack_size_g > 0 and i.unit = 'kg' then round(sum(l.qty) * 1000 / i.pack_size_g)
             when i.unit in ('pkt', 'pc', 'box', 'jar', 'tin') then sum(l.qty)
           end as packets
      from public.dispatch_orders x
      join public.orders o on o.id = x.order_id
      join public.firms f on f.id = o.firm_id
      join public.order_lines l on l.order_id = o.id and l.deleted_at is null
      join public.items i on i.id = l.item_id
     where x.dispatch_id = p_dispatch_id and x.deleted_at is null and private.is_office_user()
     group by f.code, i.id, i.name, i.unit, i.pack_size_g, i.units_per_case
  )
  select code, id, name, unit, qty, kg, pack_size_g, units_per_case, packets,
         case when units_per_case > 0 and packets is not null then floor(packets / units_per_case) end,
         case when units_per_case > 0 and packets is not null then packets - floor(packets / units_per_case) * units_per_case end
    from t
   order by code, name
$$;

insert into public.role_permissions (role, permission_key)
select 'sales_admin', 'dispatch.manage'
 where not exists (select 1 from public.role_permissions where role = 'sales_admin' and permission_key = 'dispatch.manage' and deleted_at is null);

revoke execute on function private.route_date(uuid, date), private.order_planned_date(), private.require_dispatch() from public, anon, authenticated;
revoke execute on function public.dispatch_board(date), public.create_dispatch(date, uuid, uuid, text, uuid[]),
  public.dispatch_add_orders(uuid, uuid[]), public.dispatch_remove_order(uuid, uuid),
  public.dispatch_update(uuid, uuid, uuid, text, text), public.dispatch_set_status(uuid, text),
  public.set_order_planned_date(uuid, date), public.dispatch_loading_items(uuid) from public, anon;
grant execute on function public.dispatch_board(date), public.create_dispatch(date, uuid, uuid, text, uuid[]),
  public.dispatch_add_orders(uuid, uuid[]), public.dispatch_remove_order(uuid, uuid),
  public.dispatch_update(uuid, uuid, uuid, text, text), public.dispatch_set_status(uuid, text),
  public.set_order_planned_date(uuid, date), public.dispatch_loading_items(uuid) to authenticated;
