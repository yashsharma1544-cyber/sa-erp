-- =============================================================================
-- SA ERP · 0006 One-time import from TallySync V2 (tsv2) + party matching
--
-- Raw rows are loaded into import_* staging tables (read-only copy of what
-- tsv2 held on the import date). Processing functions then create masters:
--   * Sushil ledgers   → one customer each (+ SA account)
--   * Anjali ledgers   → linked to the Sushil customer with the same
--                        normalised name (auto_exact), otherwise left
--                        'pending' for the matching screen
--   * non-customer parties are set aside
-- Every decision is recorded on the staging row and audit-logged.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

create or replace function private.norm_name(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g')
$$;

-- Indian mobile: keep the last 10 digits when the number looks valid.
create or replace function private.norm_mobile(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when d ~ '^[6-9][0-9]{9}$' then d
    when d ~ '^91[6-9][0-9]{9}$' then substr(d, 3)
    when d ~ '^0[6-9][0-9]{9}$' then substr(d, 2)
    else null
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x
$$;

-- -----------------------------------------------------------------------------
-- Staging: parties
-- -----------------------------------------------------------------------------

create table public.import_parties (
  id                     uuid primary key default gen_random_uuid(),
  firm_id                uuid not null references public.firms (id),
  ledger_name            text not null,
  tally_group            text,
  gstin                  text,
  phone                  text,
  address                text,
  erp_beat               text,
  whatsapp               text,
  flag                   text check (flag is null or flag in ('bad_debt', 'ignore')),
  closing_balance        numeric(14,2),
  last_sale              date,
  sales_count            int not null default 0,
  norm_key               text generated always as (private.norm_name(ledger_name)) stored,
  status                 text not null default 'pending'
                         check (status in ('pending', 'created', 'linked', 'non_customer', 'skipped')),
  match_method           text check (match_method in ('auto_new', 'auto_exact', 'manual_link', 'manual_new', 'manual_skip', 'non_customer')),
  customer_id            uuid references public.customers (id),
  suggested_customer_id  uuid references public.customers (id),
  suggestion_score       numeric(4,3),
  decided_by             uuid references public.app_users (id),
  decided_at             timestamptz,
  imported_at            timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  created_by             uuid default auth.uid(),
  updated_at             timestamptz not null default now(),
  updated_by             uuid,
  deleted_at             timestamptz,
  deleted_by             uuid
);
create unique index import_parties_uq on public.import_parties (firm_id, lower(ledger_name)) where deleted_at is null;
create index import_parties_status_idx on public.import_parties (firm_id, status) where deleted_at is null;
create index import_parties_norm_idx on public.import_parties (norm_key);
select private.standardise_table('public.import_parties');

create policy import_parties_read on public.import_parties for select to authenticated
  using (private.has_perm('masters.manage'));
-- Writes only through the functions below.

-- -----------------------------------------------------------------------------
-- Staging: items
-- -----------------------------------------------------------------------------

create table public.import_items (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand         text,
  grp           smallint check (grp in (1, 2)),
  is_tea        boolean not null default false,
  hsn           text,
  unit          text,
  kg_per_unit   numeric(12,3),
  gst_rate      numeric(5,2),
  last_sale     date,
  sales_lines   int not null default 0,
  status        text not null default 'pending' check (status in ('pending', 'created', 'skipped')),
  item_id       uuid references public.items (id),
  imported_at   timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid
);
create unique index import_items_uq on public.import_items (lower(name)) where deleted_at is null;
select private.standardise_table('public.import_items');

create policy import_items_read on public.import_items for select to authenticated
  using (private.has_perm('masters.manage'));

-- -----------------------------------------------------------------------------
-- Processing
-- -----------------------------------------------------------------------------

create or replace function private.require_import_rights()
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- SQL editor / migration (no auth.uid()) or someone with masters.manage.
  if auth.uid() is not null and not private.has_perm('masters.manage') then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  -- Imported bad-debt / ignore flags come from the owner's sa-collections
  -- lists, so the status guard lets this transaction set them.
  perform set_config('app.importing', 'on', true);
end;
$$;

create or replace function private.guard_customer_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_owner() or current_setting('app.importing', true) = 'on' then
    return new;
  end if;
  if (tg_op = 'INSERT' and new.status <> 'active')
     or (tg_op = 'UPDATE' and new.status is distinct from old.status) then
    raise exception 'Only the owner can mark a customer bad debt or ignore'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create index if not exists customers_name_trgm_idx on public.customers using gin (lower(name) extensions.gin_trgm_ops)
  where deleted_at is null;

create or replace function private.beat_id_for(p_erp_beat text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select b.id
    from public.beats b
   where b.deleted_at is null
     and (lower(b.name) = lower(trim(p_erp_beat))
          or (lower(trim(p_erp_beat)) = 'counter' and b.route_kind = 'counter'))
   limit 1
$$;

-- Create one customer (+ firm account) from a staging row.
create or replace function private.import_create_customer(p_row public.import_parties, p_method text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_customer uuid;
  v_gstin text := case when upper(trim(p_row.gstin)) ~ '^[0-9]{2}[A-Z0-9]{13}$' then upper(trim(p_row.gstin)) end;
begin
  insert into public.customers (name, customer_type, beat_id, whatsapp, phone, gstin, address, status, status_note)
  values (
    trim(regexp_replace(p_row.ledger_name, '\s+', ' ', 'g')),
    case when private.beat_id_for(p_row.erp_beat) is not null
          and (select route_kind from public.beats where id = private.beat_id_for(p_row.erp_beat)) = 'counter'
         then 'counter' else 'kirana' end,
    private.beat_id_for(p_row.erp_beat),
    private.norm_mobile(coalesce(p_row.whatsapp, p_row.phone)),
    nullif(trim(p_row.phone), ''),
    v_gstin,
    nullif(trim(p_row.address), ''),
    coalesce(p_row.flag, 'active'),
    case when p_row.flag is not null then 'Imported from sa-collections flags' end
  )
  returning id into v_customer;

  insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name)
  values (v_customer, p_row.firm_id, p_row.ledger_name);

  update public.import_parties
     set status = 'created', match_method = p_method, customer_id = v_customer,
         decided_by = private.current_app_user_id(), decided_at = now()
   where id = p_row.id;

  return v_customer;
end;
$$;

-- Attach a staging row to an existing customer as that firm's account.
create or replace function private.import_link_customer(p_row public.import_parties, p_customer uuid, p_method text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.customer_firm_accounts a
              where a.customer_id = p_customer and a.firm_id = p_row.firm_id and a.deleted_at is null) then
    raise exception 'That customer already has an account in this firm (%).',
      (select tally_ledger_name from public.customer_firm_accounts
        where customer_id = p_customer and firm_id = p_row.firm_id and deleted_at is null)
      using errcode = 'unique_violation';
  end if;

  insert into public.customer_firm_accounts (customer_id, firm_id, tally_ledger_name)
  values (p_customer, p_row.firm_id, p_row.ledger_name);

  -- Fill gaps on the customer from this firm's data; a flag in either firm wins.
  update public.customers c
     set whatsapp = coalesce(c.whatsapp, private.norm_mobile(coalesce(p_row.whatsapp, p_row.phone))),
         beat_id  = coalesce(c.beat_id, private.beat_id_for(p_row.erp_beat)),
         status   = case when c.status = 'active' and p_row.flag is not null then p_row.flag else c.status end
   where c.id = p_customer;

  update public.import_parties
     set status = 'linked', match_method = p_method, customer_id = p_customer,
         decided_by = private.current_app_user_id(), decided_at = now()
   where id = p_row.id;
end;
$$;

-- Automatic pass. Safe to re-run: only touches pending rows.
create or replace function public.import_process_parties()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.import_parties;
  v_sa uuid := (select id from public.firms where code = 'SA');
  v_match uuid;
  v_created int := 0;
  v_linked int := 0;
  v_non int := 0;
begin
  perform private.require_import_rights();

  -- 1. Non-customer parties (D-06)
  update public.import_parties p
     set status = 'non_customer', match_method = 'non_customer', decided_at = now()
   where p.status = 'pending' and p.deleted_at is null
     and exists (select 1 from public.non_customer_parties n
                  where n.firm_id = p.firm_id and lower(n.tally_ledger_name) = lower(p.ledger_name) and n.deleted_at is null);
  get diagnostics v_non = row_count;

  -- 2. Sushil ledgers → one customer each
  for r in select * from public.import_parties
            where status = 'pending' and firm_id = v_sa and deleted_at is null
            order by ledger_name
  loop
    perform private.import_create_customer(r, 'auto_new');
    v_created := v_created + 1;
  end loop;

  -- 3. Other firms: link on exact normalised name when it is unambiguous
  for r in select * from public.import_parties
            where status = 'pending' and firm_id <> v_sa and deleted_at is null
            order by ledger_name
  loop
    v_match := null;
    select max(a.customer_id::text)::uuid into v_match
      from public.import_parties s
      join public.customer_firm_accounts a on a.customer_id = s.customer_id and a.deleted_at is null
     where s.firm_id <> r.firm_id and s.norm_key = r.norm_key and s.customer_id is not null
       and not exists (select 1 from public.customer_firm_accounts x
                        where x.customer_id = s.customer_id and x.firm_id = r.firm_id and x.deleted_at is null)
    having count(distinct s.customer_id) = 1;

    if v_match is not null then
      perform private.import_link_customer(r, v_match, 'auto_exact');
      v_linked := v_linked + 1;
    end if;
  end loop;

  -- 4. Suggestions for what is left (trigram similarity on names)
  update public.import_parties p
     set (suggested_customer_id, suggestion_score) = (
       select c.id, round(extensions.similarity(lower(c.name), lower(p.ledger_name))::numeric, 3)
         from public.customers c
        where c.deleted_at is null
          and not exists (select 1 from public.customer_firm_accounts a
                           where a.customer_id = c.id and a.firm_id = p.firm_id and a.deleted_at is null)
        order by extensions.similarity(lower(c.name), lower(p.ledger_name)) desc
        limit 1
     )
   where p.status = 'pending' and p.deleted_at is null;

  update public.import_parties
     set suggested_customer_id = null, suggestion_score = null
   where status = 'pending' and deleted_at is null and coalesce(suggestion_score, 0) < 0.45;

  return jsonb_build_object(
    'created', v_created,
    'linked', v_linked,
    'non_customer', v_non,
    'pending', (select count(*) from public.import_parties where status = 'pending' and deleted_at is null)
  );
end;
$$;

-- Manual decisions from the matching screen.
create or replace function public.import_decide_party(
  p_id uuid,
  p_action text,              -- 'link' | 'new' | 'skip' | 'non_customer' | 'undo'
  p_customer_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.import_parties;
begin
  perform private.require_import_rights();
  select * into r from public.import_parties where id = p_id and deleted_at is null for update;
  if not found then raise exception 'Row not found' using errcode = 'no_data_found'; end if;

  if p_action = 'undo' then
    if r.status = 'linked' then
      update public.customer_firm_accounts set deleted_at = now()
       where customer_id = r.customer_id and firm_id = r.firm_id and lower(tally_ledger_name) = lower(r.ledger_name) and deleted_at is null;
    elsif r.status = 'created' then
      update public.customer_firm_accounts set deleted_at = now()
       where customer_id = r.customer_id and firm_id = r.firm_id and deleted_at is null;
      -- Remove the customer only if nothing else hangs on it.
      update public.customers c set deleted_at = now()
       where c.id = r.customer_id
         and not exists (select 1 from public.customer_firm_accounts a where a.customer_id = c.id and a.deleted_at is null);
    end if;
    update public.import_parties
       set status = 'pending', match_method = null, customer_id = null,
           decided_by = private.current_app_user_id(), decided_at = now()
     where id = p_id;
    return;
  end if;

  if r.status <> 'pending' then
    raise exception 'Already decided (%). Undo first.', r.status using errcode = 'check_violation';
  end if;

  if p_action = 'link' then
    if p_customer_id is null then raise exception 'Choose a customer' using errcode = 'check_violation'; end if;
    perform private.import_link_customer(r, p_customer_id, 'manual_link');
  elsif p_action = 'new' then
    perform private.import_create_customer(r, 'manual_new');
  elsif p_action = 'skip' then
    update public.import_parties set status = 'skipped', match_method = 'manual_skip',
           decided_by = private.current_app_user_id(), decided_at = now() where id = p_id;
  elsif p_action = 'non_customer' then
    insert into public.non_customer_parties (firm_id, tally_ledger_name, reason)
    values (r.firm_id, r.ledger_name, 'Marked on the import matching screen')
    on conflict do nothing;
    update public.import_parties set status = 'non_customer', match_method = 'non_customer',
           decided_by = private.current_app_user_id(), decided_at = now() where id = p_id;
  else
    raise exception 'Unknown action %', p_action using errcode = 'check_violation';
  end if;
end;
$$;

-- "Create new customers for everything still pending in this firm."
create or replace function public.import_create_all_pending(p_firm_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.import_parties;
  n int := 0;
begin
  perform private.require_import_rights();
  for r in select * from public.import_parties
            where status = 'pending' and firm_id = p_firm_id and deleted_at is null
  loop
    perform private.import_create_customer(r, 'manual_new');
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.import_process_items()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.import_items;
  v_brand uuid;
  v_item uuid;
  n int := 0;
begin
  perform private.require_import_rights();
  for r in select * from public.import_items where status = 'pending' and deleted_at is null order by name loop
    v_brand := null;
    v_item := null;
    if r.brand is not null then
      select id into v_brand from public.brands where lower(name) = lower(r.brand) and deleted_at is null;
      if v_brand is null then
        insert into public.brands (name, category) values (r.brand, case when r.is_tea then 'tea' when r.hsn like '15%' then 'oil' else 'other' end)
        returning id into v_brand;
      end if;
    end if;

    -- Tally sometimes has the same item twice, differing only in spacing:
    -- keep one item and record the other spelling as an alias.
    select id into v_item from public.items
     where lower(name) = lower(trim(regexp_replace(r.name, '\s+', ' ', 'g'))) and deleted_at is null;
    if v_item is not null then
      insert into public.item_aliases (item_id, source, alias_name) values (v_item, 'tally', r.name)
      on conflict do nothing;
      update public.import_items set status = 'created', item_id = v_item where id = r.id;
      continue;
    end if;

    insert into public.items (name, brand_id, sku_group_id, category, unit, kg_per_unit, hsn, gst_rate, active)
    values (
      trim(regexp_replace(r.name, '\s+', ' ', 'g')),
      v_brand,
      (select id from public.sku_groups where code = 'G' || r.grp and deleted_at is null),
      case when r.is_tea then 'tea' when r.hsn like '15%' then 'oil' else 'other' end,
      coalesce(nullif(r.unit, ''), 'pc'),
      coalesce(r.kg_per_unit, 0),
      r.hsn,
      coalesce(r.gst_rate, 0),
      coalesce(r.last_sale >= date '2026-04-01', false)
    )
    returning id into v_item;

    insert into public.item_aliases (item_id, source, alias_name) values (v_item, 'tally', r.name)
    on conflict do nothing;

    update public.import_items set status = 'created', item_id = v_item where id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('created', n);
end;
$$;

revoke execute on function
  public.import_process_parties(),
  public.import_decide_party(uuid, text, uuid),
  public.import_create_all_pending(uuid),
  public.import_process_items()
from public, anon;
grant execute on function
  public.import_process_parties(),
  public.import_decide_party(uuid, text, uuid),
  public.import_create_all_pending(uuid),
  public.import_process_items()
to authenticated;
