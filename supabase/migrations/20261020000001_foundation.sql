-- =============================================================================
-- SA ERP · 0001 Foundation
--   schemas, standard triggers (updated_at, audit, no hard delete),
--   firms, fiscal years, journey cycles, godowns, users, roles, permissions,
--   settings, RLS helpers and policies.
--
-- Conventions (see docs/ARCHITECTURE.md §3):
--   * every table: id, created_at/by, updated_at/by, deleted_at/by
--   * nothing is hard-deleted: a BEFORE DELETE trigger raises
--   * every change is written to audit.change_log with old and new values
--   * RLS on every table; anon gets nothing
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
create schema if not exists audit;

revoke all on schema private from public;
revoke all on schema audit from public;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Standard trigger functions
-- -----------------------------------------------------------------------------

create or replace function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  if tg_op = 'UPDATE' then
    -- created_* never change after insert
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    -- stamp who soft-deleted
    if old.deleted_at is null and new.deleted_at is not null then
      new.deleted_by := coalesce(auth.uid(), new.deleted_by);
    end if;
  end if;
  return new;
end;
$$;

create or replace function private.forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Hard delete is not allowed on %. Set deleted_at instead.', tg_table_name
    using errcode = 'insufficient_privilege';
end;
$$;

create table audit.change_log (
  id             bigint generated always as identity primary key,
  table_schema   text        not null,
  table_name     text        not null,
  row_id         text,
  action         text        not null check (action in ('INSERT', 'UPDATE', 'SOFT_DELETE', 'RESTORE')),
  old_data       jsonb,
  new_data       jsonb,
  changed_fields text[],
  changed_by     uuid,
  changed_at     timestamptz not null default now()
);

create index change_log_row_idx on audit.change_log (table_name, row_id, changed_at desc);
create index change_log_at_idx  on audit.change_log (changed_at desc);
create index change_log_by_idx  on audit.change_log (changed_by, changed_at desc);

alter table audit.change_log enable row level security;
revoke all on audit.change_log from public, anon, authenticated;

create or replace function audit.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb;
  v_new     jsonb;
  v_fields  text[];
  v_action  text;
  v_row_id  text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_action := 'INSERT';
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select array_agg(k order by k)
      into v_fields
      from jsonb_object_keys(v_new) as k
     where k not in ('updated_at', 'updated_by')
       and (v_old -> k) is distinct from (v_new -> k);
    if v_fields is null then
      return new; -- no real change
    end if;
    v_action := case
      when (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then 'SOFT_DELETE'
      when (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then 'RESTORE'
      else 'UPDATE'
    end;
  end if;

  v_row_id := coalesce(v_new ->> 'id', v_new ->> 'key');

  -- Never copy secrets into the log; the field name still shows in changed_fields.
  v_old := v_old - 'pin_hash';
  v_new := v_new - 'pin_hash';

  insert into audit.change_log (table_schema, table_name, row_id, action, old_data, new_data, changed_fields, changed_by)
  values (tg_table_schema, tg_table_name, v_row_id, v_action, v_old, v_new, v_fields, auth.uid());

  return new;
end;
$$;

-- Attach touch + audit + no-delete triggers and enable RLS on a table.
create or replace function private.standardise_table(p_table regclass)
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create trigger touch_row before insert or update on %s for each row execute function private.touch_row()', p_table);
  execute format('create trigger audit_change after insert or update on %s for each row execute function audit.log_change()', p_table);
  execute format('create trigger forbid_delete before delete on %s for each row execute function private.forbid_delete()', p_table);
  execute format('revoke delete, truncate on %s from public, anon, authenticated', p_table);
  execute format('revoke all on %s from anon', p_table);
end;
$$;

-- Nothing in public is ever available to anon, and nobody gets DELETE/TRUNCATE.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke delete, truncate on tables from authenticated;
alter default privileges in schema public revoke execute on functions from anon, public;

-- -----------------------------------------------------------------------------
-- Roles
-- -----------------------------------------------------------------------------

create type public.app_role as enum (
  'owner', 'sales_admin', 'accounts', 'stores', 'dispatch', 'driver', 'salesman', 'collector'
);

-- -----------------------------------------------------------------------------
-- Firms, fiscal years, journey cycles, godowns
-- -----------------------------------------------------------------------------

create table public.firms (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^[A-Z]{2,4}$'),
  name            text not null,
  gst_registered  boolean not null,
  gstin           text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  address         text,
  phone           text,
  invoice_prefix  text not null,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  constraint firms_gstin_only_if_registered check (gst_registered or gstin is null)
);
select private.standardise_table('public.firms');

create table public.fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  start_year  int  not null unique check (start_year between 2000 and 2100),
  label       text not null unique,          -- '26-27'
  start_date  date not null,
  end_date    date not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid,
  constraint fiscal_years_april_march check (
    start_date = make_date(start_year, 4, 1) and end_date = make_date(start_year + 1, 3, 31)
  )
);
select private.standardise_table('public.fiscal_years');

create table public.journey_cycles (
  id              uuid primary key default gen_random_uuid(),
  fiscal_year_id  uuid not null references public.fiscal_years (id),
  jc_number       int  not null check (jc_number between 1 and 13),
  start_date      date not null unique,
  end_date        date not null unique,
  days            int  generated always as (end_date - start_date + 1) stored,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  unique (fiscal_year_id, jc_number),
  check (end_date >= start_date)
);
select private.standardise_table('public.journey_cycles');

create table public.godowns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_counter  boolean not null default false,  -- Mondha sales counter
  address     text,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
select private.standardise_table('public.godowns');

-- -----------------------------------------------------------------------------
-- Users, roles, firm access, permissions, settings
-- -----------------------------------------------------------------------------

create table public.app_users (
  id                uuid primary key default gen_random_uuid(),
  auth_user_id      uuid unique references auth.users (id),
  full_name         text not null,
  email             text,
  login_kind        text not null check (login_kind in ('email', 'pin')),
  phone             text,
  whatsapp          text,
  pin_hash          text,
  pin_failed_count  int  not null default 0,
  locked_until      timestamptz,
  locale            text not null default 'en' check (locale in ('en', 'mr')),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  constraint app_users_email_login check (login_kind <> 'email' or email is not null)
);
create unique index app_users_email_uq on public.app_users (lower(email)) where deleted_at is null and email is not null;
create unique index app_users_pin_name_uq on public.app_users (lower(full_name)) where deleted_at is null and login_kind = 'pin';
select private.standardise_table('public.app_users');

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users (id),
  role        public.app_role not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index user_roles_uq on public.user_roles (user_id, role) where deleted_at is null;
select private.standardise_table('public.user_roles');

create table public.user_firms (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users (id),
  firm_id     uuid not null references public.firms (id),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index user_firms_uq on public.user_firms (user_id, firm_id) where deleted_at is null;
select private.standardise_table('public.user_firms');

create table public.permissions (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique check (key ~ '^[a-z_]+\.[a-z_]+$'),
  category     text not null,
  description  text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
select private.standardise_table('public.permissions');

create table public.role_permissions (
  id              uuid primary key default gen_random_uuid(),
  role            public.app_role not null check (role <> 'owner'), -- owner has everything implicitly
  permission_key  text not null references public.permissions (key),
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid
);
create unique index role_permissions_uq on public.role_permissions (role, permission_key) where deleted_at is null;
select private.standardise_table('public.role_permissions');

create table public.app_settings (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  value        jsonb not null,
  description  text not null,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
select private.standardise_table('public.app_settings');

-- -----------------------------------------------------------------------------
-- RLS helper functions (security definer so they can read the role tables
-- without recursing through RLS)
-- -----------------------------------------------------------------------------

create or replace function private.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
    from public.app_users u
   where u.auth_user_id = auth.uid()
     and u.active
     and u.deleted_at is null
$$;

create or replace function private.has_role(p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_roles r
     where r.user_id = private.current_app_user_id()
       and r.role = p_role
       and r.deleted_at is null
  )
$$;

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_role('owner')
$$;

create or replace function private.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_app_user_id() is not null
$$;

create or replace function private.has_perm(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_owner()
      or exists (
        select 1
          from public.user_roles ur
          join public.role_permissions rp
            on rp.role = ur.role
           and rp.deleted_at is null
         where ur.user_id = private.current_app_user_id()
           and ur.deleted_at is null
           and rp.permission_key = p_key
      )
$$;

-- Firms an office user may see. Owner sees all. Field users get their firm
-- visibility from beats (Phase 0.3+), not from this list.
create or replace function private.my_firm_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_owner() then (select coalesce(array_agg(f.id), '{}') from public.firms f where f.deleted_at is null)
    else (
      select coalesce(array_agg(uf.firm_id), '{}')
        from public.user_firms uf
       where uf.user_id = private.current_app_user_id()
         and uf.deleted_at is null
    )
  end
$$;

grant execute on function
  private.current_app_user_id(),
  private.has_role(public.app_role),
  private.is_owner(),
  private.is_active_user(),
  private.has_perm(text),
  private.my_firm_ids()
to authenticated;

-- -----------------------------------------------------------------------------
-- RLS policies
-- -----------------------------------------------------------------------------

-- Pattern for every table: soft-deleted rows stay visible to whoever may
-- write the table (so they can restore, and because Postgres checks the
-- updated row against SELECT policies when soft-deleting); everyone else
-- never sees them.
--
-- Reference data: any active user reads; owner writes.
do $$
declare t text;
begin
  foreach t in array array['firms', 'fiscal_years', 'journey_cycles', 'godowns', 'permissions', 'app_settings'] loop
    execute format($p$create policy %1$s_read on public.%1$s for select to authenticated
                     using (private.is_active_user() and (deleted_at is null or private.is_owner()))$p$, t);
  end loop;
  foreach t in array array['firms', 'godowns', 'app_settings'] loop
    execute format($p$create policy %1$s_owner_insert on public.%1$s for insert to authenticated
                     with check (private.is_owner())$p$, t);
    execute format($p$create policy %1$s_owner_update on public.%1$s for update to authenticated
                     using (private.is_owner()) with check (private.is_owner())$p$, t);
  end loop;
end $$;
-- fiscal_years / journey_cycles are written only by generate_journey_cycles();
-- permissions only by migrations.

create policy role_permissions_read on public.role_permissions for select to authenticated
  using (private.is_active_user() and (deleted_at is null or private.is_owner()));
create policy role_permissions_owner_insert on public.role_permissions for insert to authenticated
  with check (private.is_owner());
create policy role_permissions_owner_update on public.role_permissions for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- app_users: every active user can see names (needed on receipts, dispatches);
-- secrets are hidden by column grants below. users.manage writes.
create policy app_users_read on public.app_users for select to authenticated
  using (private.is_active_user() and (deleted_at is null or private.has_perm('users.manage')));
create policy app_users_insert on public.app_users for insert to authenticated
  with check (private.has_perm('users.manage'));
create policy app_users_update on public.app_users for update to authenticated
  using (private.has_perm('users.manage')) with check (private.has_perm('users.manage'));

revoke select, insert, update on public.app_users from authenticated;
grant select (id, auth_user_id, full_name, email, login_kind, phone, whatsapp, locale, active,
              locked_until, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
  on public.app_users to authenticated;
grant insert (full_name, email, login_kind, phone, whatsapp, locale, active)
  on public.app_users to authenticated;
grant update (full_name, email, phone, whatsapp, locale, active, deleted_at)
  on public.app_users to authenticated;

-- user_roles / user_firms: self or users.manage reads; users.manage writes;
-- only the owner can grant or revoke the owner role.
create policy user_roles_read on public.user_roles for select to authenticated
  using ((deleted_at is null and user_id = private.current_app_user_id()) or private.has_perm('users.manage'));
create policy user_roles_insert on public.user_roles for insert to authenticated
  with check (private.has_perm('users.manage') and (role <> 'owner' or private.is_owner()));
create policy user_roles_update on public.user_roles for update to authenticated
  using (private.has_perm('users.manage') and (role <> 'owner' or private.is_owner()))
  with check (private.has_perm('users.manage') and (role <> 'owner' or private.is_owner()));

create policy user_firms_read on public.user_firms for select to authenticated
  using ((deleted_at is null and user_id = private.current_app_user_id()) or private.has_perm('users.manage'));
create policy user_firms_insert on public.user_firms for insert to authenticated
  with check (private.has_perm('users.manage'));
create policy user_firms_update on public.user_firms for update to authenticated
  using (private.has_perm('users.manage')) with check (private.has_perm('users.manage'));

-- -----------------------------------------------------------------------------
-- Journey cycle generator (D-07) and lookups
-- -----------------------------------------------------------------------------

create or replace function public.generate_journey_cycles(p_start_year int)
returns setof public.journey_cycles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fy_id    uuid;
  v_fy_start date := make_date(p_start_year, 4, 1);
  v_fy_end   date := make_date(p_start_year + 1, 3, 31);
  n          int;
begin
  -- SQL editor / service role (no auth.uid()) or the owner may generate.
  if auth.uid() is not null and not private.is_owner() then
    raise exception 'Only the owner can generate journey cycles' using errcode = 'insufficient_privilege';
  end if;

  insert into public.fiscal_years (start_year, label, start_date, end_date)
  values (
    p_start_year,
    lpad((p_start_year % 100)::text, 2, '0') || '-' || lpad(((p_start_year + 1) % 100)::text, 2, '0'),
    v_fy_start,
    v_fy_end
  )
  on conflict (start_year) do nothing;

  select id into v_fy_id from public.fiscal_years where start_year = p_start_year;

  for n in 1..13 loop
    insert into public.journey_cycles (fiscal_year_id, jc_number, start_date, end_date)
    values (
      v_fy_id,
      n,
      v_fy_start + (n - 1) * 28,
      case when n = 13 then v_fy_end else v_fy_start + n * 28 - 1 end
    )
    on conflict (fiscal_year_id, jc_number) do nothing;
  end loop;

  return query
    select * from public.journey_cycles where fiscal_year_id = v_fy_id order by jc_number;
end;
$$;

revoke execute on function public.generate_journey_cycles(int) from public, anon;
grant execute on function public.generate_journey_cycles(int) to authenticated;

create or replace view public.v_journey_cycles
with (security_invoker = true)
as
select jc.id,
       jc.fiscal_year_id,
       fy.label  as fy_label,
       fy.start_year,
       jc.jc_number,
       'JC' || jc.jc_number || ' ' || fy.label as jc_label,
       jc.start_date,
       jc.end_date,
       jc.days
  from public.journey_cycles jc
  join public.fiscal_years fy on fy.id = jc.fiscal_year_id
 where jc.deleted_at is null;

grant select on public.v_journey_cycles to authenticated;

-- -----------------------------------------------------------------------------
-- Audit log reader (owner, or audit.view)
-- -----------------------------------------------------------------------------

create or replace function public.audit_log(
  p_table   text default null,
  p_row_id  text default null,
  p_limit   int  default 200,
  p_before  timestamptz default null
)
returns table (
  id             bigint,
  table_name     text,
  row_id         text,
  action         text,
  changed_fields text[],
  old_data       jsonb,
  new_data       jsonb,
  changed_by     uuid,
  changed_by_name text,
  changed_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.has_perm('audit.view') then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
    select l.id, l.table_name, l.row_id, l.action, l.changed_fields, l.old_data, l.new_data,
           l.changed_by, u.full_name, l.changed_at
      from audit.change_log l
      left join public.app_users u on u.auth_user_id = l.changed_by
     where (p_table is null or l.table_name = p_table)
       and (p_row_id is null or l.row_id = p_row_id)
       and (p_before is null or l.changed_at < p_before)
     order by l.changed_at desc, l.id desc
     limit least(greatest(p_limit, 1), 1000);
end;
$$;

revoke execute on function public.audit_log(text, text, int, timestamptz) from public, anon;
grant execute on function public.audit_log(text, text, int, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Link auth users to pre-created app_users by email
-- -----------------------------------------------------------------------------

create or replace function private.link_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null then
    update public.app_users
       set auth_user_id = new.id
     where auth_user_id is null
       and login_kind = 'email'
       and deleted_at is null
       and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

create trigger link_app_user
  after insert on auth.users
  for each row execute function private.link_auth_user();

-- Run once from the Supabase SQL editor to make yourself the owner:
--   select private.bootstrap_owner('you@example.com', 'Your Name');
create or replace function private.bootstrap_owner(p_email text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_auth_id uuid;
begin
  select id into v_auth_id from auth.users where lower(email) = lower(p_email) limit 1;

  select id into v_user_id
    from public.app_users
   where lower(email) = lower(p_email) and deleted_at is null;

  if v_user_id is null then
    insert into public.app_users (full_name, email, login_kind, auth_user_id)
    values (p_full_name, p_email, 'email', v_auth_id)
    returning id into v_user_id;
  elsif v_auth_id is not null then
    update public.app_users set auth_user_id = v_auth_id where id = v_user_id and auth_user_id is null;
  end if;

  insert into public.user_roles (user_id, role)
  values (v_user_id, 'owner')
  on conflict do nothing;

  return v_user_id;
end;
$$;

revoke execute on function private.bootstrap_owner(text, text) from public, anon, authenticated;
