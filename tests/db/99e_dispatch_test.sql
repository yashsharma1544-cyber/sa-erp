-- Planned dates by route, dispatch life cycle, loading sheet, oil switched off.
\set owner_auth '00000000-0000-0000-0000-00000000e001'
\set drv_auth   '00000000-0000-0000-0000-0000000d0001'

insert into auth.users (id, email) values (:'drv_auth', 'drv@field.invalid');
insert into public.app_users (full_name, login_kind, auth_user_id) values ('Driver One', 'pin', :'drv_auth');
insert into public.user_roles (user_id, role) select id, 'driver' from public.app_users where full_name = 'Driver One';
insert into public.vehicles (id, reg_no, capacity_kg) values ('00000000-0000-0000-0000-0000000d0e01', 'MH21 X 1234', 1000);
update public.items set pack_size_g = 250, units_per_case = 80 where id = '00000000-0000-0000-0000-0000000a0001';

do $$
declare d date := private.today_ist(); r date;
begin
  -- Outstation (Mehkar, Tuesday): the next Tuesday after the order date.
  r := private.route_date('00000000-0000-0000-0000-0000000a0b01', d);
  if extract(dow from r) <> 2 or r <= d or r > d + 7 then raise exception 'Mehkar route date % for %', r, d; end if;
  if exists (select 1 from public.items where category = 'oil' and active and name not like 'Test %') then raise exception 'oil still active'; end if;
  if exists (select 1 from public.orders where source <> 'counter' and planned_date is null) then raise exception 'order without planned date'; end if;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare
  far date := private.today_ist() + 8;
  o1 uuid; o2 uuid; o_pending uuid; dsp uuid; dsp2 uuid; r record;
begin
  select order_id into o1 from public.dispatch_board(far) where status = 'approved' and firm_code = 'SA' and total_kg > 0 order by order_no limit 1;
  select order_id into o2 from public.dispatch_board(far) where status = 'approved' and order_id <> o1 order by order_no limit 1;
  if o1 is null or o2 is null then raise exception 'board has no approved orders'; end if;
  if exists (select 1 from public.dispatch_board(far) b join public.orders o on o.id = b.order_id where o.source = 'counter') then
    raise exception 'counter order on the board';
  end if;

  dsp := public.create_dispatch(private.today_ist() + 1, null, null, 'Ramu', array[o1, o2]);
  if (select count(*) from public.dispatch_orders where dispatch_id = dsp and deleted_at is null) <> 2 then raise exception 'orders not added'; end if;
  begin
    perform public.create_dispatch(private.today_ist() + 1, null, null, null, array[o1]);
    raise exception 'order put on two dispatches';
  exception when check_violation then null;
  end;
  select id into o_pending from public.orders where status = 'pending_approval' limit 1;
  if o_pending is not null then
    begin
      perform public.dispatch_add_orders(dsp, array[o_pending]);
      raise exception 'unapproved order loaded';
    exception when check_violation then null;
    end;
  end if;

  perform public.dispatch_set_status(dsp, 'loading');
  if (select status from public.orders where id = o1) <> 'loading' then raise exception 'order not loading'; end if;
  perform public.dispatch_remove_order(dsp, o2);
  if (select status from public.orders where id = o2) <> 'approved' then raise exception 'removed order not back to approved'; end if;
  begin
    perform public.dispatch_set_status(dsp, 'departed');
    raise exception 'left without vehicle and driver';
  exception when check_violation then null;
  end;
  perform public.dispatch_update(dsp, '00000000-0000-0000-0000-0000000d0e01',
    (select id from public.app_users where full_name = 'Driver One'), 'Ramu', null);
  perform public.dispatch_set_status(dsp, 'departed');
  if (select status from public.orders where id = o1) <> 'dispatched' then raise exception 'order not dispatched'; end if;
  begin
    perform public.dispatch_add_orders(dsp, array[o2]);
    raise exception 'added after departure';
  exception when check_violation then null;
  end;
  perform public.dispatch_set_status(dsp, 'returned');

  -- Loading sheet: Test Tea in 250 g packs, 80 to a bag.
  select * into r from public.dispatch_loading_items(dsp) where item_id = '00000000-0000-0000-0000-0000000a0001';
  if r.packets <> r.qty * 4 or r.full_cases * 80 + r.loose_packets <> r.packets then raise exception 'loading sheet %', row_to_json(r); end if;

  -- Cancelling a dispatch frees its orders.
  dsp2 := public.create_dispatch(private.today_ist() + 1, null, null, null, array[o2]);
  perform public.dispatch_set_status(dsp2, 'loading');
  perform public.dispatch_set_status(dsp2, 'cancelled');
  if (select status from public.orders where id = o2) <> 'approved'
     or exists (select 1 from public.dispatch_orders where order_id = o2 and deleted_at is null) then
    raise exception 'cancel did not free the order';
  end if;
  perform public.set_order_planned_date(o2, private.today_ist() + 2);
  if (select planned_date from public.orders where id = o2) <> private.today_ist() + 2 then raise exception 'move date'; end if;
end;
$$;

-- A collector can't plan dispatches.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f001', false);
do $$
begin
  perform public.create_dispatch(private.today_ist(), null, null, null, '{}');
  raise exception 'collector planned a dispatch';
exception when insufficient_privilege then null;
end;
$$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
