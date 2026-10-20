-- PIN login, delegations, approval queue.
\set owner_auth  '00000000-0000-0000-0000-00000000b001'
\set admin_auth  '00000000-0000-0000-0000-00000000b002'
\set field_auth  '00000000-0000-0000-0000-00000000b003'
\set acct_auth   '00000000-0000-0000-0000-00000000b004'

insert into auth.users (id, email) values
  (:'owner_auth', 'owner2@example.com'),
  (:'admin_auth', 'salesadmin@example.com'),
  (:'acct_auth',  'acct2@example.com'),
  (:'field_auth', 'f1@field.invalid');
select private.bootstrap_owner('owner2@example.com', 'Owner Two');

insert into public.app_users (full_name, email, login_kind, auth_user_id)
values ('Sales Admin', 'salesadmin@example.com', 'email', :'admin_auth'),
       ('Accounts Two', 'acct2@example.com', 'email', :'acct_auth');
insert into public.app_users (full_name, login_kind, auth_user_id, locale)
values ('Ramesh Collector', 'pin', :'field_auth', 'mr');

insert into public.user_roles (user_id, role)
select id, 'sales_admin'::public.app_role from public.app_users where full_name = 'Sales Admin'
union all select id, 'accounts' from public.app_users where full_name = 'Accounts Two'
union all select id, 'collector' from public.app_users where full_name = 'Ramesh Collector';
insert into public.user_firms (user_id, firm_id)
select u.id, f.id from public.app_users u cross join public.firms f
 where u.full_name in ('Sales Admin', 'Accounts Two');

-- ---------- PIN ----------
do $$
declare v uuid := (select id from public.app_users where full_name = 'Ramesh Collector');
begin
  begin perform public.set_user_pin(v, '12a4'); raise exception 'bad pin accepted';
  exception when check_violation then null; end;
  begin perform public.set_user_pin(v, '1234'); raise exception 'easy pin accepted';
  exception when check_violation then null; end;
  perform public.set_user_pin(v, '4826');
  if (select pin_hash from public.app_users where id = v) like '%4826%' then raise exception 'pin stored in clear'; end if;
  if exists (select 1 from audit.change_log where new_data ? 'pin_hash' or old_data ? 'pin_hash') then
    raise exception 'pin_hash leaked into audit log';
  end if;
end $$;

-- verify_pin is for the server only
set role authenticated;
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
begin
  begin
    perform public.verify_pin((select id from public.app_users where full_name = 'Ramesh Collector'), '4826');
    raise exception 'authenticated could call verify_pin';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_user_pin((select id from public.app_users where full_name = 'Ramesh Collector'), '9182');
    raise exception 'accounts could set a PIN';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

set role service_role;
do $$
declare
  v uuid := (select id from public.pin_login_users() where full_name = 'Ramesh Collector');
  r jsonb;
  i int;
begin
  if v is null then raise exception 'field user missing from pin_login_users'; end if;
  r := public.verify_pin(v, '4826');
  if not (r ->> 'ok')::boolean then raise exception 'correct pin rejected: %', r; end if;

  for i in 1..4 loop
    r := public.verify_pin(v, '0001');
    if r ->> 'reason' <> 'wrong_pin' or (r ->> 'attempts_left')::int <> 5 - i then
      raise exception 'attempt % unexpected: %', i, r;
    end if;
  end loop;
  r := public.verify_pin(v, '0001');
  if r ->> 'reason' <> 'locked' then raise exception '5th wrong pin should lock: %', r; end if;
  r := public.verify_pin(v, '4826');
  if r ->> 'reason' <> 'locked' then raise exception 'locked account accepted correct pin: %', r; end if;
end $$;
reset role;
update public.app_users set locked_until = now() - interval '1 minute' where full_name = 'Ramesh Collector';
set role service_role;
do $$
begin
  if not (public.verify_pin((select id from public.app_users where full_name = 'Ramesh Collector'), '4826') ->> 'ok')::boolean then
    raise exception 'pin should work after lock expires';
  end if;
end $$;
reset role;

-- ---------- Approvals ----------
set role authenticated;

-- Accounts raises two requests (accounts cannot decide).
select set_config('request.jwt.claim.sub', :'acct_auth', false);
select public.request_approval((select id from public.firms where code = 'SA'), 'credit', 'order.approve',
  'Order for Shree Kirana', 'Over credit limit', 75000, false) as req_normal \gset
select public.request_approval((select id from public.firms where code = 'SA'), 'credit', 'order.approve',
  'Order for Bad Payer', 'Bad-debt customer', 1000, true) as req_bad \gset
do $$
begin
  if private.has_perm('order.approve') then raise exception 'accounts must not approve orders (D-19 withdrawn)'; end if;
  begin
    perform public.decide_approval((select id from public.approval_requests where subject_label = 'Order for Shree Kirana'), true);
    raise exception 'accounts decided an approval';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.approval_requests (firm_id, kind, permission_key, subject_label, reason)
    values ((select id from public.firms where code = 'SA'), 'other', 'order.approve', 'x', 'y');
    raise exception 'direct insert into approval_requests allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Sales admin: no cap yet (D-21) but never bad debt.
select set_config('request.jwt.claim.sub', :'admin_auth', false);
do $$
begin
  if private.approval_cap('order.approve') is not null then raise exception 'sales admin should have no cap by default'; end if;
  if (select count(*) from public.approval_requests where status = 'pending') <> 2 then
    raise exception 'sales admin should see 2 pending';
  end if;
  begin
    perform public.decide_approval((select id from public.approval_requests where subject_label = 'Order for Bad Payer'), true);
    raise exception 'sales admin approved a bad-debt request';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Owner sets a ₹50,000 cap for the sales admin.
select set_config('request.jwt.claim.sub', :'owner_auth', false);
insert into public.approval_delegations (delegate_user_id, permission_key, max_amount, note)
select id, 'order.approve', 50000, 'Cap while owner away' from public.app_users where full_name = 'Sales Admin';

select set_config('request.jwt.claim.sub', :'admin_auth', false);
do $$
declare r public.approval_requests;
begin
  if private.approval_cap('order.approve') <> 50000 then raise exception 'cap not applied'; end if;
  begin
    perform public.decide_approval((select id from public.approval_requests where subject_label = 'Order for Shree Kirana'), true);
    raise exception 'approved above cap';
  exception when insufficient_privilege then null;
  end;
  -- rejecting is always allowed
  r := public.decide_approval((select id from public.approval_requests where subject_label = 'Order for Shree Kirana'), false, 'Collect first');
  if r.status <> 'rejected' or r.decided_at is null then raise exception 'reject failed'; end if;
  begin
    perform public.decide_approval(r.id, true);
    raise exception 'decided twice';
  exception when check_violation then null;
  end;
end $$;

-- Owner can approve bad debt.
select set_config('request.jwt.claim.sub', :'owner_auth', false);
do $$
declare r public.approval_requests;
begin
  r := public.decide_approval((select id from public.approval_requests where subject_label = 'Order for Bad Payer'), true, 'OK this once');
  if r.status <> 'approved' then raise exception 'owner approval failed'; end if;
end $$;

-- Temporary delegation: give the accounts person order.approve for a past
-- window only → no permission today.
insert into public.approval_delegations (delegate_user_id, permission_key, valid_from, valid_to)
select id, 'order.approve', date '2026-01-01', date '2026-01-05' from public.app_users where full_name = 'Accounts Two';
select set_config('request.jwt.claim.sub', :'acct_auth', false);
do $$
begin
  if private.has_perm('order.approve') then raise exception 'expired delegation still active'; end if;
  if 'order.approve' = any (public.my_permissions()) then raise exception 'my_permissions shows expired delegation'; end if;
  if not ('receipt.cancel' = any (public.my_permissions())) then raise exception 'my_permissions missing role perm'; end if;
end $$;
reset role;
