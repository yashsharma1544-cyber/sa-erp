-- =============================================================================
-- SA ERP · 0004 Masters
--   territories, beats (route days), brands, SKU groups, items (+aliases),
--   customers (+per-firm accounts with credit), non-customer parties,
--   suppliers (+per-firm terms), vehicles, bank accounts, user ↔ beat.
--
-- Shared masters carry no firm_id; per-firm data lives in *_firm_accounts
-- (D-10). Credit limit / credit days need credit.manage (owner by default).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helpers: office vs field visibility
-- -----------------------------------------------------------------------------

-- Office roles see every customer; field roles see only their beats.
create or replace function private.is_office_user()
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
       and r.deleted_at is null
       and r.role in ('owner', 'sales_admin', 'accounts', 'stores', 'dispatch')
  )
$$;

grant execute on function private.is_office_user() to authenticated;

-- -----------------------------------------------------------------------------
-- Territories and beats
-- -----------------------------------------------------------------------------

create table public.territories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index territories_name_uq on public.territories (lower(name)) where deleted_at is null;
select private.standardise_table('public.territories');

create table public.beats (
  id             uuid primary key default gen_random_uuid(),
  territory_id   uuid not null references public.territories (id),
  name           text not null,
  route_kind     text not null default 'city' check (route_kind in ('city', 'outstation', 'counter')),
  route_weekday  smallint check (route_weekday between 0 and 6), -- 0 = Sunday … 6 = Saturday (outstation only)
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid,
  constraint beats_weekday_only_outstation check (
    (route_kind = 'outstation' and route_weekday is not null) or (route_kind <> 'outstation' and route_weekday is null)
  )
);
create unique index beats_name_uq on public.beats (lower(name)) where deleted_at is null;
create index beats_territory_idx on public.beats (territory_id) where deleted_at is null;
select private.standardise_table('public.beats');

create table public.user_beats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.app_users (id),
  beat_id     uuid not null references public.beats (id),
  purpose     text not null check (purpose in ('sales', 'collection')),
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index user_beats_uq on public.user_beats (user_id, beat_id, purpose) where deleted_at is null;
create index user_beats_beat_idx on public.user_beats (beat_id) where deleted_at is null;
select private.standardise_table('public.user_beats');

create or replace function private.my_beat_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct ub.beat_id), '{}')
    from public.user_beats ub
   where ub.user_id = private.current_app_user_id()
     and ub.deleted_at is null
$$;

grant execute on function private.my_beat_ids() to authenticated;

-- -----------------------------------------------------------------------------
-- Brands, SKU groups, items
-- -----------------------------------------------------------------------------

create table public.brands (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  category    text not null default 'tea' check (category in ('tea', 'oil', 'other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index brands_name_uq on public.brands (lower(name)) where deleted_at is null;
select private.standardise_table('public.brands');

create table public.sku_groups (
  id           uuid primary key default gen_random_uuid(),
  code         text not null,
  name         text not null,
  description  text,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create unique index sku_groups_code_uq on public.sku_groups (code) where deleted_at is null;
select private.standardise_table('public.sku_groups');

create table public.items (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  brand_id        uuid references public.brands (id),
  sku_group_id    uuid references public.sku_groups (id), -- editable; history is in the audit log
  category        text not null default 'tea' check (category in ('tea', 'oil', 'other')),
  unit            text not null default 'pc',              -- pc, pkt, jar, tin, box, ltr …
  units_per_case  numeric(12,3) check (units_per_case is null or units_per_case > 0),
  pack_size_g     numeric(12,3) check (pack_size_g is null or pack_size_g > 0),
  kg_per_unit     numeric(12,3) not null default 0 check (kg_per_unit >= 0),
  hsn             text,
  gst_rate        numeric(5,2) not null default 0 check (gst_rate between 0 and 28), -- Sushil
  mrp             numeric(14,2) check (mrp is null or mrp >= 0),
  shelf_life_days int check (shelf_life_days is null or shelf_life_days > 0),
  active          boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  deleted_by      uuid
);
create unique index items_name_uq on public.items (lower(name)) where deleted_at is null;
create index items_brand_idx on public.items (brand_id) where deleted_at is null;
select private.standardise_table('public.items');

create table public.item_aliases (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items (id),
  source      text not null check (source in ('tally', 'rupyz', 'mondha', 'other')),
  alias_name  text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index item_aliases_uq on public.item_aliases (source, lower(alias_name)) where deleted_at is null;
select private.standardise_table('public.item_aliases');

-- -----------------------------------------------------------------------------
-- Customers and per-firm accounts
-- -----------------------------------------------------------------------------

create table public.customers (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  display_name_mr  text,
  customer_type    text not null default 'kirana'
                   check (customer_type in ('kirana', 'retailer', 'wholesaler', 'hotel', 'counter', 'other')),
  beat_id          uuid references public.beats (id),
  whatsapp         text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  phone            text,
  gstin            text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  address          text,
  town             text,
  lat              numeric(9,6),
  lng              numeric(9,6),
  status           text not null default 'active' check (status in ('active', 'bad_debt', 'ignore')),
  status_note      text,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid
);
create index customers_beat_idx on public.customers (beat_id) where deleted_at is null;
create index customers_name_idx on public.customers (lower(name)) where deleted_at is null;
create index customers_status_idx on public.customers (status) where deleted_at is null;
select private.standardise_table('public.customers');

create table public.customer_firm_accounts (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers (id),
  firm_id            uuid not null references public.firms (id),
  tally_ledger_name  text,
  credit_limit       numeric(14,2) not null default 0 check (credit_limit >= 0),
  credit_days        int not null default 0 check (credit_days between 0 and 365),
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  deleted_by         uuid
);
create unique index customer_firm_accounts_uq on public.customer_firm_accounts (customer_id, firm_id) where deleted_at is null;
create unique index customer_firm_accounts_ledger_uq on public.customer_firm_accounts (firm_id, lower(tally_ledger_name))
  where deleted_at is null and tally_ledger_name is not null;
select private.standardise_table('public.customer_firm_accounts');

-- Credit terms are owner-controlled (credit.manage). masters.manage can open
-- an account but cannot set or change its credit.
create or replace function private.guard_credit_terms()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.has_perm('credit.manage') then
    return new;
  end if;
  if tg_op = 'INSERT' and (new.credit_limit <> 0 or new.credit_days <> 0) then
    raise exception 'Only someone with credit.manage can set credit limit or credit days'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and (new.credit_limit is distinct from old.credit_limit
                           or new.credit_days is distinct from old.credit_days) then
    raise exception 'Only someone with credit.manage can change credit limit or credit days'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger guard_credit_terms
  before insert or update on public.customer_firm_accounts
  for each row execute function private.guard_credit_terms();

-- Status changes to bad_debt / ignore are owner-only (they move money out of working totals).
create or replace function private.guard_customer_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_owner() then
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

create trigger guard_customer_status
  before insert or update on public.customers
  for each row execute function private.guard_customer_status();

create table public.non_customer_parties (
  id                 uuid primary key default gen_random_uuid(),
  firm_id            uuid not null references public.firms (id),
  tally_ledger_name  text not null,
  reason             text not null,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  deleted_by         uuid
);
create unique index non_customer_parties_uq on public.non_customer_parties (firm_id, lower(tally_ledger_name)) where deleted_at is null;
select private.standardise_table('public.non_customer_parties');

-- -----------------------------------------------------------------------------
-- Suppliers, vehicles, bank accounts
-- -----------------------------------------------------------------------------

create table public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'tea' check (kind in ('tea', 'oil', 'other')),
  whatsapp    text check (whatsapp is null or whatsapp ~ '^[0-9]{10,13}$'),
  phone       text,
  gstin       text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  address     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  deleted_by  uuid
);
create unique index suppliers_name_uq on public.suppliers (lower(name)) where deleted_at is null;
select private.standardise_table('public.suppliers');

create table public.supplier_firm_accounts (
  id                  uuid primary key default gen_random_uuid(),
  supplier_id         uuid not null references public.suppliers (id),
  firm_id             uuid not null references public.firms (id),
  tally_ledger_name   text,
  credit_days         int not null default 0 check (credit_days between 0 and 365),
  cash_discount_pct   numeric(5,2) not null default 0 check (cash_discount_pct between 0 and 100),
  cash_discount_days  int check (cash_discount_days is null or cash_discount_days between 0 and 365),
  discount_base       text not null default 'gross_incl_gst' check (discount_base in ('gross_incl_gst', 'taxable')),
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  check (cash_discount_pct = 0 or cash_discount_days is not null)
);
create unique index supplier_firm_accounts_uq on public.supplier_firm_accounts (supplier_id, firm_id) where deleted_at is null;
select private.standardise_table('public.supplier_firm_accounts');

create table public.vehicles (
  id           uuid primary key default gen_random_uuid(),
  reg_no       text not null check (reg_no ~ '^[A-Z0-9 -]{4,15}$'),
  ownership    text not null default 'own' check (ownership in ('own', 'borrowed_vikram', 'hired')),
  description  text,
  capacity_kg  numeric(12,3) check (capacity_kg is null or capacity_kg > 0),
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  deleted_by   uuid
);
create unique index vehicles_reg_uq on public.vehicles (upper(replace(reg_no, ' ', ''))) where deleted_at is null;
select private.standardise_table('public.vehicles');

create table public.bank_accounts (
  id                uuid primary key default gen_random_uuid(),
  firm_id           uuid not null references public.firms (id),
  bank              text not null,
  branch            text,
  account_last4     text check (account_last4 is null or account_last4 ~ '^[0-9]{4}$'),
  tally_ledger_name text,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid,
  deleted_at        timestamptz,
  deleted_by        uuid
);
select private.standardise_table('public.bank_accounts');

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------

-- Catalogue masters: every active user reads (field apps need beats/items);
-- masters.manage writes. Soft-deleted rows stay visible to writers.
do $$
declare t text;
begin
  foreach t in array array['territories', 'beats', 'brands', 'sku_groups', 'items', 'item_aliases'] loop
    execute format($p$create policy %1$s_read on public.%1$s for select to authenticated
                     using (private.is_active_user() and (deleted_at is null or private.has_perm('masters.manage')))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$s for insert to authenticated
                     with check (private.has_perm('masters.manage'))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$s for update to authenticated
                     using (private.has_perm('masters.manage')) with check (private.has_perm('masters.manage'))$p$, t);
  end loop;
end $$;

-- Office-only masters: suppliers, their terms, vehicles, bank accounts,
-- non-customer parties.
do $$
declare t text;
begin
  foreach t in array array['suppliers', 'supplier_firm_accounts', 'vehicles', 'bank_accounts', 'non_customer_parties'] loop
    execute format($p$create policy %1$s_read on public.%1$s for select to authenticated
                     using (private.is_office_user() and (deleted_at is null or private.has_perm('masters.manage')))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$s for insert to authenticated
                     with check (private.has_perm('masters.manage'))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$s for update to authenticated
                     using (private.has_perm('masters.manage')) with check (private.has_perm('masters.manage'))$p$, t);
  end loop;
end $$;

-- Drivers see vehicles (their dispatch screens need the reg no).
create policy vehicles_read_driver on public.vehicles for select to authenticated
  using (deleted_at is null and private.has_role('driver'));

-- Customers: office users see all; field users only customers in their beats.
create policy customers_read on public.customers for select to authenticated
  using (
    private.is_active_user() and (
      private.has_perm('masters.manage')
      or (deleted_at is null and (private.is_office_user() or beat_id = any (private.my_beat_ids())))
    )
  );
create policy customers_insert on public.customers for insert to authenticated
  with check (private.has_perm('masters.manage'));
create policy customers_update on public.customers for update to authenticated
  using (private.has_perm('masters.manage') or private.has_perm('credit.manage'))
  with check (private.has_perm('masters.manage') or private.has_perm('credit.manage'));

create policy customer_firm_accounts_read on public.customer_firm_accounts for select to authenticated
  using (
    private.is_active_user() and (
      private.has_perm('masters.manage')
      or (deleted_at is null and (
            private.is_office_user()
            or exists (select 1 from public.customers c
                        where c.id = customer_id and c.deleted_at is null
                          and c.beat_id = any (private.my_beat_ids()))))
    )
  );
create policy customer_firm_accounts_insert on public.customer_firm_accounts for insert to authenticated
  with check (private.has_perm('masters.manage') or private.has_perm('credit.manage'));
create policy customer_firm_accounts_update on public.customer_firm_accounts for update to authenticated
  using (private.has_perm('masters.manage') or private.has_perm('credit.manage'))
  with check (private.has_perm('masters.manage') or private.has_perm('credit.manage'));

-- user_beats: self reads own; users.manage reads and writes all.
create policy user_beats_read on public.user_beats for select to authenticated
  using ((deleted_at is null and user_id = private.current_app_user_id()) or private.has_perm('users.manage'));
create policy user_beats_insert on public.user_beats for insert to authenticated
  with check (private.has_perm('users.manage'));
create policy user_beats_update on public.user_beats for update to authenticated
  using (private.has_perm('users.manage')) with check (private.has_perm('users.manage'));

-- -----------------------------------------------------------------------------
-- Convenience views (security_invoker: RLS of the caller applies)
-- -----------------------------------------------------------------------------

create or replace view public.v_beats
with (security_invoker = true)
as
select b.id, b.name, b.route_kind, b.route_weekday, b.active,
       t.id as territory_id, t.name as territory_name, t.sort_order as territory_sort,
       (select count(*) from public.customers c where c.beat_id = b.id and c.deleted_at is null) as customer_count
  from public.beats b
  join public.territories t on t.id = b.territory_id
 where b.deleted_at is null;

grant select on public.v_beats to authenticated;
