-- =============================================================================
-- SA ERP · 0003 Field PIN login, user admin RPCs, approval limits and
-- delegations, approval queue.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Approval delegations: grant a permission to a person (optionally only for
-- a date range, e.g. while the owner is away) and/or cap the amount they may
-- approve. A row with max_amount null means "no rupee cap" (D-21).
-- -----------------------------------------------------------------------------

create table public.approval_delegations (
  id                uuid primary key default gen_random_uuid(),
  delegate_user_id  uuid not null references public.app_users (id),
  permission_key    text not null references public.permissions (key),
  max_amount        numeric(14,2) check (max_amount is null or max_amount >= 0),
  valid_from        date,
  valid_to          date,
  active            boolean not null default true,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid,
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
create index approval_delegations_user_idx on public.approval_delegations (delegate_user_id, permission_key)
  where deleted_at is null;
select private.standardise_table('public.approval_delegations');

create or replace function private.today_ist()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

create or replace function private.active_delegations(p_key text)
returns setof public.approval_delegations
language sql
stable
security definer
set search_path = ''
as $$
  select d.*
    from public.approval_delegations d
   where d.delegate_user_id = private.current_app_user_id()
     and d.permission_key = p_key
     and d.active
     and d.deleted_at is null
     and (d.valid_from is null or d.valid_from <= private.today_ist())
     and (d.valid_to   is null or d.valid_to   >= private.today_ist())
$$;

-- has_perm now also honours active delegations.
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
      or exists (select 1 from private.active_delegations(p_key))
$$;

-- The most this person may approve for a permission. null = no cap.
-- If several active rows set a cap, the smallest wins.
create or replace function private.approval_cap(p_key text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_owner() then null
              else (select min(d.max_amount) from private.active_delegations(p_key) d)
         end
$$;

grant execute on function private.today_ist(), private.active_delegations(text), private.approval_cap(text)
  to authenticated;

create policy approval_delegations_read on public.approval_delegations for select to authenticated
  using ((deleted_at is null and delegate_user_id = private.current_app_user_id()) or private.is_owner());
create policy approval_delegations_owner_insert on public.approval_delegations for insert to authenticated
  with check (private.is_owner());
create policy approval_delegations_owner_update on public.approval_delegations for update to authenticated
  using (private.is_owner()) with check (private.is_owner());

-- -----------------------------------------------------------------------------
-- Approval queue (one queue for every kind of approval)
-- -----------------------------------------------------------------------------

create table public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  firm_id         uuid not null references public.firms (id),
  kind            text not null check (kind in ('credit', 'discount', 'return', 'order', 'scheme', 'other')),
  permission_key  text not null references public.permissions (key),
  subject_table   text,
  subject_id      uuid,
  subject_label   text not null,
  amount          numeric(14,2) not null default 0 check (amount >= 0), -- amount to judge against the approver's cap
  is_bad_debt     boolean not null default false,
  reason          text not null,
  details         jsonb not null default '{}'::jsonb,
  requested_by    uuid not null default private.current_app_user_id() references public.app_users (id),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by      uuid references public.app_users (id),
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid,
  check ((status = 'pending') = (decided_at is null))
);
create index approval_requests_pending_idx on public.approval_requests (created_at) where status = 'pending';
create index approval_requests_subject_idx on public.approval_requests (subject_table, subject_id);
select private.standardise_table('public.approval_requests');

-- Read: the requester, anyone who may decide that kind in that firm, owner.
create policy approval_requests_read on public.approval_requests for select to authenticated
  using (
    deleted_at is null and (
      requested_by = private.current_app_user_id()
      or private.is_owner()
      or (private.has_perm(permission_key) and firm_id = any (private.my_firm_ids()))
    )
  );
-- No insert/update policies: requests are raised and decided only through the RPCs below.

create or replace function public.request_approval(
  p_firm_id        uuid,
  p_kind           text,
  p_permission_key text,
  p_subject_label  text,
  p_reason         text,
  p_amount         numeric default 0,
  p_is_bad_debt    boolean default false,
  p_subject_table  text default null,
  p_subject_id     uuid default null,
  p_details        jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not private.is_active_user() then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege';
  end if;
  insert into public.approval_requests (
    firm_id, kind, permission_key, subject_table, subject_id, subject_label,
    amount, is_bad_debt, reason, details
  ) values (
    p_firm_id, p_kind, p_permission_key, p_subject_table, p_subject_id, p_subject_label,
    coalesce(p_amount, 0), coalesce(p_is_bad_debt, false), p_reason, coalesce(p_details, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;

-- Approve or reject. Enforces permission, firm access, rupee cap and the
-- bad-debt rule (only the owner approves for bad-debt customers, D-21).
create or replace function public.decide_approval(p_id uuid, p_approve boolean, p_note text default null)
returns public.approval_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  r     public.approval_requests;
  v_cap numeric;
  v_me  uuid := private.current_app_user_id();
begin
  select * into r from public.approval_requests where id = p_id and deleted_at is null for update;
  if not found then
    raise exception 'Approval request not found' using errcode = 'no_data_found';
  end if;
  if r.status <> 'pending' then
    raise exception 'Already %', r.status using errcode = 'check_violation';
  end if;

  if r.requested_by = v_me and not private.is_owner() then
    raise exception 'You cannot decide your own request' using errcode = 'insufficient_privilege';
  end if;

  if not private.is_owner() then
    if not private.has_perm(r.permission_key) or not (r.firm_id = any (private.my_firm_ids())) then
      raise exception 'You are not allowed to decide this request' using errcode = 'insufficient_privilege';
    end if;
    if p_approve then
      if r.is_bad_debt then
        raise exception 'Only the owner can approve for a bad-debt customer' using errcode = 'insufficient_privilege';
      end if;
      v_cap := private.approval_cap(r.permission_key);
      if v_cap is not null and r.amount > v_cap then
        raise exception 'Amount % is above your approval limit %', r.amount, v_cap using errcode = 'insufficient_privilege';
      end if;
    end if;
  end if;

  update public.approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_me,
         decided_at = now(),
         decision_note = p_note
   where id = p_id
   returning * into r;
  return r;
end;
$$;

create or replace function public.cancel_approval_request(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_requests
     set status = 'cancelled', decided_by = private.current_app_user_id(), decided_at = now()
   where id = p_id
     and status = 'pending'
     and (requested_by = private.current_app_user_id() or private.is_owner());
  if not found then
    raise exception 'Cannot cancel this request' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

revoke execute on function
  public.request_approval(uuid, text, text, text, text, numeric, boolean, text, uuid, jsonb),
  public.decide_approval(uuid, boolean, text),
  public.cancel_approval_request(uuid)
from public, anon;
grant execute on function
  public.request_approval(uuid, text, text, text, text, numeric, boolean, text, uuid, jsonb),
  public.decide_approval(uuid, boolean, text),
  public.cancel_approval_request(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- What the signed-in user may do (for the UI)
-- -----------------------------------------------------------------------------

create or replace function public.my_permissions()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.is_owner() then (select coalesce(array_agg(p.key order by p.key), '{}') from public.permissions p where p.deleted_at is null)
    else (
      select coalesce(array_agg(distinct k order by k), '{}')
        from (
          select rp.permission_key as k
            from public.user_roles ur
            join public.role_permissions rp on rp.role = ur.role and rp.deleted_at is null
           where ur.user_id = private.current_app_user_id() and ur.deleted_at is null
          union
          select d.permission_key
            from public.approval_delegations d
           where d.delegate_user_id = private.current_app_user_id()
             and d.active and d.deleted_at is null
             and (d.valid_from is null or d.valid_from <= private.today_ist())
             and (d.valid_to   is null or d.valid_to   >= private.today_ist())
        ) x
    )
  end
$$;

revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

-- -----------------------------------------------------------------------------
-- Field PIN login (name + 4-digit PIN)
--   * set_user_pin: users.manage sets/resets a PIN (bcrypt)
--   * verify_pin:   called by the server (service_role) only; counts failures
--                   and locks after app_settings.pin_max_attempts
-- -----------------------------------------------------------------------------

create or replace function public.set_user_pin(p_user_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not private.has_perm('users.manage') then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_pin !~ '^[0-9]{4}$' then
    raise exception 'PIN must be exactly 4 digits' using errcode = 'check_violation';
  end if;
  if p_pin in ('0000', '1111', '1234', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '4321') then
    raise exception 'PIN is too easy to guess' using errcode = 'check_violation';
  end if;
  update public.app_users
     set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)),
         pin_failed_count = 0,
         locked_until = null
   where id = p_user_id
     and login_kind = 'pin'
     and deleted_at is null;
  if not found then
    raise exception 'Field user not found' using errcode = 'no_data_found';
  end if;
end;
$$;

create or replace function public.verify_pin(p_user_id uuid, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  u            public.app_users;
  v_max        int := coalesce((select (value #>> '{}')::int from public.app_settings where key = 'pin_max_attempts' and deleted_at is null), 5);
  v_lock_mins  int := coalesce((select (value #>> '{}')::int from public.app_settings where key = 'pin_lock_minutes' and deleted_at is null), 15);
begin
  select * into u
    from public.app_users
   where id = p_user_id and login_kind = 'pin' and active and deleted_at is null
   for update;

  if not found or u.pin_hash is null or u.auth_user_id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown');
  end if;

  if u.locked_until is not null and u.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', u.locked_until);
  end if;

  if p_pin ~ '^[0-9]{4}$' and extensions.crypt(p_pin, u.pin_hash) = u.pin_hash then
    update public.app_users set pin_failed_count = 0, locked_until = null where id = u.id;
    return jsonb_build_object('ok', true, 'auth_user_id', u.auth_user_id);
  end if;

  if u.pin_failed_count + 1 >= v_max then
    update public.app_users
       set pin_failed_count = 0, locked_until = now() + make_interval(mins => v_lock_mins)
     where id = u.id;
    return jsonb_build_object('ok', false, 'reason', 'locked', 'locked_until', now() + make_interval(mins => v_lock_mins));
  end if;

  update public.app_users set pin_failed_count = u.pin_failed_count + 1 where id = u.id;
  return jsonb_build_object('ok', false, 'reason', 'wrong_pin', 'attempts_left', v_max - u.pin_failed_count - 1);
end;
$$;

revoke execute on function public.set_user_pin(uuid, text) from public, anon;
grant execute on function public.set_user_pin(uuid, text) to authenticated;
revoke execute on function public.verify_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.verify_pin(uuid, text) to service_role;

-- Names shown on the field login screen (service_role only; served by the app).
create or replace function public.pin_login_users()
returns table (id uuid, full_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select u.id, u.full_name
    from public.app_users u
   where u.login_kind = 'pin' and u.active and u.deleted_at is null
     and u.pin_hash is not null and u.auth_user_id is not null
   order by u.full_name
$$;

revoke execute on function public.pin_login_users() from public, anon, authenticated;
grant execute on function public.pin_login_users() to service_role;

-- Owner-only: link a field user to the hidden auth account the server created.
create or replace function public.link_pin_auth_user(p_user_id uuid, p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_users
     set auth_user_id = p_auth_user_id
   where id = p_user_id and login_kind = 'pin' and auth_user_id is null and deleted_at is null;
  if not found then
    raise exception 'Field user not found or already linked' using errcode = 'no_data_found';
  end if;
end;
$$;

revoke execute on function public.link_pin_auth_user(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_pin_auth_user(uuid, uuid) to service_role;
