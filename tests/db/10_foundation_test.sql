-- Foundation tests. Each block raises on failure.
\set owner_auth  '00000000-0000-0000-0000-00000000a001'
\set acct_auth   '00000000-0000-0000-0000-00000000a002'
\set stranger    '00000000-0000-0000-0000-00000000a003'

-- ---------- Journey cycles ----------
do $$
declare r record;
begin
  if (select count(*) from public.journey_cycles) <> 26 then
    raise exception 'expected 26 JCs after seed (incl. re-run), got %', (select count(*) from public.journey_cycles);
  end if;
  select * into r from public.v_journey_cycles where fy_label = '26-27' and jc_number = 13;
  if r.start_date <> date '2027-03-03' or r.end_date <> date '2027-03-31' or r.days <> 29 then
    raise exception 'JC13 26-27 wrong: % % %', r.start_date, r.end_date, r.days;
  end if;
  select * into r from public.v_journey_cycles where date '2026-10-20' between start_date and end_date;
  if r.jc_number <> 8 or r.start_date <> date '2026-10-14' then
    raise exception '2026-10-20 should be JC8 starting 2026-10-14, got % %', r.jc_number, r.start_date;
  end if;
  perform public.generate_journey_cycles(2027);
  if (select days from public.v_journey_cycles where fy_label = '27-28' and jc_number = 13) <> 30 then
    raise exception 'leap FY 27-28 JC13 should have 30 days';
  end if;
  if (select sum(days) from public.v_journey_cycles where fy_label = '26-27') <> 365 then
    raise exception 'FY 26-27 JC days should sum to 365';
  end if;
end $$;

-- ---------- Every public table follows the conventions ----------
do $$
declare t record;
begin
  for t in
    select c.oid, c.relname, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind = 'r'
  loop
    if not t.relrowsecurity then raise exception 'RLS off on %', t.relname; end if;
    if not exists (select 1 from pg_trigger where tgrelid = t.oid and tgname = 'forbid_delete') then
      raise exception 'no forbid_delete trigger on %', t.relname;
    end if;
    if not exists (select 1 from pg_trigger where tgrelid = t.oid and tgname = 'audit_change') then
      raise exception 'no audit trigger on %', t.relname;
    end if;
    if has_table_privilege('authenticated', t.oid, 'DELETE') then
      raise exception 'authenticated has DELETE on %', t.relname;
    end if;
    if has_table_privilege('anon', t.oid, 'SELECT') then
      raise exception 'anon can read %', t.relname;
    end if;
  end loop;
end $$;

-- ---------- Hard delete is refused even for the superuser ----------
do $$
begin
  begin
    delete from public.godowns where name = 'City Office';
    raise exception 'delete should have failed';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Users: owner bootstrap, linking by email ----------
insert into auth.users (id, email) values (:'owner_auth', 'owner@example.com');
select private.bootstrap_owner('owner@example.com', 'Owner');

insert into public.app_users (full_name, email, login_kind) values ('Accounts One', 'acct@example.com', 'email');
insert into public.user_roles (user_id, role)
  select id, 'accounts' from public.app_users where email = 'acct@example.com';
insert into public.user_firms (user_id, firm_id)
  select u.id, f.id from public.app_users u, public.firms f where u.email = 'acct@example.com' and f.code = 'SA';
insert into auth.users (id, email) values (:'acct_auth', 'ACCT@example.com');

do $$
begin
  if (select auth_user_id from public.app_users where email = 'acct@example.com')
     is distinct from '00000000-0000-0000-0000-00000000a002' then
    raise exception 'auth user was not linked to app_users by email';
  end if;
end $$;

-- ---------- Owner session ----------
set role authenticated;
select set_config('request.jwt.claim.sub', :'owner_auth', false);

do $$
begin
  if not private.is_owner() then raise exception 'owner not recognised'; end if;
  if (select count(*) from public.firms) <> 2 then raise exception 'owner should see 2 firms'; end if;
  if cardinality(private.my_firm_ids()) <> 2 then raise exception 'owner my_firm_ids should be 2'; end if;
  update public.firms set phone = '9800000000' where code = 'AA';
end $$;

do $$
declare r record;
begin
  select * into r from public.audit_log('firms', null, 5) where action = 'UPDATE' limit 1;
  if r is null then raise exception 'firm update not in audit log'; end if;
  if r.changed_fields <> array['phone'] then raise exception 'changed_fields wrong: %', r.changed_fields; end if;
  if r.new_data ->> 'phone' <> '9800000000' or (r.old_data ->> 'phone') is not null then
    raise exception 'old/new values wrong';
  end if;
  if r.changed_by_name <> 'Owner' then raise exception 'changed_by_name wrong: %', r.changed_by_name; end if;
end $$;

-- soft delete is logged as SOFT_DELETE with deleted_by stamped
do $$
begin
  insert into public.godowns (name) values ('Temp Godown');
  update public.godowns set deleted_at = now() where name = 'Temp Godown';
  if not exists (select 1 from public.audit_log('godowns') where action = 'SOFT_DELETE') then
    raise exception 'soft delete not logged';
  end if;
end $$;

-- ---------- Accounts session: limited ----------
select set_config('request.jwt.claim.sub', :'acct_auth', false);

do $$
declare n int;
begin
  if private.is_owner() then raise exception 'accounts must not be owner'; end if;
  if not private.has_perm('receipt.cancel') then raise exception 'accounts should have receipt.cancel'; end if;
  if private.has_perm('users.manage') then raise exception 'accounts must not manage users'; end if;
  if cardinality(private.my_firm_ids()) <> 1 then raise exception 'accounts should see only SA'; end if;
  if exists (select 1 from public.godowns where name = 'Temp Godown') then
    raise exception 'soft-deleted godown visible to accounts';
  end if;

  update public.firms set phone = 'hacked' where code = 'SA';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'accounts updated a firm'; end if;

  begin
    insert into public.user_roles (user_id, role) select id, 'owner' from public.app_users where email = 'acct@example.com';
    raise exception 'accounts granted itself owner';
  exception when insufficient_privilege then null;
  end;

  begin
    perform pin_hash from public.app_users limit 1;
    raise exception 'pin_hash readable';
  exception when insufficient_privilege then null;
  end;

  begin
    perform * from public.audit_log();
    raise exception 'accounts read the audit log';
  exception when insufficient_privilege then null;
  end;

  begin
    perform public.generate_journey_cycles(2030);
    raise exception 'accounts generated JCs';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------- Signed in but no app user: sees nothing ----------
select set_config('request.jwt.claim.sub', :'stranger', false);
do $$
begin
  if (select count(*) from public.firms) <> 0 then raise exception 'stranger sees firms'; end if;
  if (select count(*) from public.app_users) <> 0 then raise exception 'stranger sees users'; end if;
end $$;

-- ---------- anon: nothing ----------
reset role;
set role anon;
do $$
begin
  begin
    perform 1 from public.firms;
    raise exception 'anon read firms';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- audit log is append-only and unreadable to API roles
do $$
begin
  if has_table_privilege('authenticated', 'audit.change_log', 'SELECT') then
    raise exception 'authenticated can read audit.change_log directly';
  end if;
end $$;
