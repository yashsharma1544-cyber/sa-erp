-- =============================================================================
-- SA ERP · 0022 Orders from the salesmen's WhatsApp groups (slice 2.3, D-63…D-66)
--
-- The "Whatsapp Orders" project reads each market's WhatsApp group and splits
-- every message into order lines (customer, item, qty, unit). The ERP reads it
-- through a read-only role (postgres_fdw, schema wa_src) and, every few
-- minutes, brings each order into public.wa_orders / wa_order_lines:
--   • firm: the JALNA LOCAL ORDER group is Sushil, every other group Anjali;
--   • customer: a saved link, else a unique exact name match;
--   • salesman: the sender, via the source's salesman list;
--   • item: the same item name as the ERP (or a saved alias);
--   • quantity: packet tea (100 g / 250 g / 500 g / 1 kg …) a plain number is
--     kg; rupee sachets (5 / 10 / 20 Rs) a plain number is packets; kg on a
--     sachet is turned into packets with the item's kg per packet.
-- An order with nothing to check becomes an ERP order straight away (credit
-- check and approvals as usual, the salesman as requester). Anything else
-- waits on the WhatsApp orders screen for the office.
-- =============================================================================

create schema if not exists wa;
create schema if not exists wa_src;
revoke all on schema wa, wa_src from public;

-- -----------------------------------------------------------------------------
-- Order creation shared by people and the WhatsApp sync. The caller has
-- already checked who may do it; p_actor is the requester of any approval.
-- -----------------------------------------------------------------------------
create or replace function private.create_order_core(p jsonb, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_op       uuid := (p ->> 'client_op_id')::uuid;
  v_firm     uuid := (p ->> 'firm_id')::uuid;
  v_cust     uuid := (p ->> 'customer_id')::uuid;
  v_source   text := coalesce(p ->> 'source', 'office');
  v_date     date := coalesce((p ->> 'order_date')::date, private.today_ist());
  v_salesman uuid := (p ->> 'salesman_id')::uuid;
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
  select * into c from public.customers where id = v_cust and deleted_at is null;
  if not found then
    raise exception 'Customer not found' using errcode = 'no_data_found';
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
  if v_gstfirm is null then
    raise exception 'Unknown firm' using errcode = 'check_violation';
  end if;

  insert into public.orders (firm_id, order_no, customer_id, source, salesman_id, order_date, note, lat, lng, client_op_id)
  values (v_firm, private.next_doc_no(v_firm, 'O', v_date), v_cust, v_source,
          coalesce(v_salesman, case when v_source = 'salesman' then p_actor end), v_date,
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

  v_credit := private.credit_eval(v_firm, v_cust, o.total, case when v_source = 'counter' then 'counter_cash' else 'credit' end);
  update public.orders set credit_check = v_credit where id = o.id;

  if not (v_credit ->> 'ok')::boolean then
    v_reasons := (select string_agg(r ->> 'text', '; ') from jsonb_array_elements(v_credit -> 'reasons') r);
    insert into public.approval_requests (firm_id, kind, permission_key, subject_table, subject_id, subject_label,
                                          amount, is_bad_debt, reason, details, requested_by)
    values (v_firm, 'order', 'order.approve', 'orders', o.id, format('Order %s · %s', o.order_no, c.name),
            o.total, c.status = 'bad_debt', v_reasons, jsonb_build_object('credit', v_credit), p_actor);
    v_pending := v_pending + 1;
  end if;
  if v_disc > 0 then
    insert into public.approval_requests (firm_id, kind, permission_key, subject_table, subject_id, subject_label,
                                          amount, is_bad_debt, reason, details, requested_by)
    values (v_firm, 'discount', 'discount.approve', 'orders', o.id, format('Order %s · %s', o.order_no, c.name),
            v_disc, c.status = 'bad_debt',
            (select string_agg(format('%s at %s (list %s)', i.name, trim(to_char(l.rate, 'FM9999999990.00')),
                                      trim(to_char(l.list_rate, 'FM9999999990.00'))), '; ' order by l.line_no)
               from public.order_lines l join public.items i on i.id = l.item_id
              where l.order_id = o.id and l.rate < l.list_rate),
            jsonb_build_object('discount', v_disc), p_actor);
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

-- Same behaviour as 0020, now through the shared core.
create or replace function public.create_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := private.current_app_user_id();
  v_op   uuid := (p ->> 'client_op_id')::uuid;
  v_firm uuid := (p ->> 'firm_id')::uuid;
  o      public.orders;
begin
  if v_me is null or not private.has_perm('order.create') then
    raise exception 'You are not allowed to take orders' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.orders where client_op_id = v_op;
  if found then
    return jsonb_build_object('status', 'duplicate', 'id', o.id, 'order_no', o.order_no, 'order_status', o.status);
  end if;
  if not (v_firm = any(private.my_firm_ids())) then
    raise exception 'You do not work for this firm' using errcode = 'insufficient_privilege';
  end if;
  if not private.is_office_user()
     and not exists (select 1 from public.customers c where c.id = (p ->> 'customer_id')::uuid
                      and c.beat_id = any(private.my_sales_beat_ids())) then
    raise exception 'This customer is not in your beats' using errcode = 'insufficient_privilege';
  end if;
  -- People can't set someone else as the salesman.
  return private.create_order_core(p - 'salesman_id', v_me);
end;
$$;

-- -----------------------------------------------------------------------------
-- Connection to the Whatsapp Orders project (read-only role, see RUNBOOK).
-- -----------------------------------------------------------------------------
create or replace function wa.connect_source(p_host text, p_port int, p_dbname text, p_user text, p_password text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_foreign_server where srvname = 'wa_source') then
    execute format('create server wa_source foreign data wrapper postgres_fdw options (host %L, port %L, dbname %L, fetch_size %L, updatable %L)',
                   p_host, p_port::text, p_dbname, '2000', 'false');
  else
    execute format('alter server wa_source options (set host %L, set port %L, set dbname %L)', p_host, p_port::text, p_dbname);
  end if;
  if exists (select 1 from pg_user_mappings where srvname = 'wa_source' and usename = current_user) then
    execute format('alter user mapping for current_user server wa_source options (set user %L, set password %L)', p_user, p_password);
  else
    execute format('create user mapping for current_user server wa_source options (user %L, password %L)', p_user, p_password);
  end if;
  if to_regclass('wa_src.wa_order_lines') is null then
    create foreign table wa_src.wa_groups (jid text, subject text, track boolean)
      server wa_source options (schema_name 'public', table_name 'wa_groups');
    create foreign table wa_src.wa_salesmen (jid text, name text, aliases text[])
      server wa_source options (schema_name 'public', table_name 'wa_salesmen');
    create foreign table wa_src.wa_messages (
      id bigint, group_jid text, message_id text, sender_name text, sent_at timestamptz, message_type text,
      body text, parse_status text, parse_notes text, received_at timestamptz, parsed_at timestamptz
    ) server wa_source options (schema_name 'public', table_name 'wa_messages');
    create foreign table wa_src.wa_order_lines (
      id bigint, message_id bigint, group_jid text, sender_name text, sent_at timestamptz, order_no int, customer text,
      brand text, pack text, qty numeric, unit text, raw_line text, uncertain boolean, source text,
      created_at timestamptz, item_code text, item_name text, free_qty numeric
    ) server wa_source options (schema_name 'public', table_name 'wa_order_lines');
  end if;
end;
$$;

create table wa.sync_log (
  id          bigint generated always as identity primary key,
  trigger     text not null default 'cron' check (trigger in ('cron', 'manual')),
  started_at  timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'ok', 'failed')),
  counts      jsonb,
  error       text
);
create index wa_sync_log_started_idx on wa.sync_log (started_at desc);

-- -----------------------------------------------------------------------------
-- WhatsApp orders in the ERP
-- -----------------------------------------------------------------------------
create table public.wa_orders (
  id             uuid primary key default gen_random_uuid(),
  external_key   text not null,             -- '<source message id>:<order no>'
  wa_message_id  bigint not null,
  order_no       int not null,
  group_jid      text not null,
  group_name     text,
  firm_id        uuid not null references public.firms (id),
  sent_at        timestamptz not null,
  order_date     date not null,
  sender_name    text,
  salesman_id    uuid references public.app_users (id),
  customer_text  text,
  customer_id    uuid references public.customers (id),
  message_body   text,
  parse_notes    text,
  status         text not null default 'review' check (status in ('review', 'ordered', 'ignored', 'cancelled')),
  problems       text[] not null default '{}',
  order_id       uuid references public.orders (id),
  note           text,
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz,
  deleted_by     uuid
);
create unique index wa_orders_key_uq on public.wa_orders (external_key) where deleted_at is null;
create index wa_orders_status_idx on public.wa_orders (status, sent_at) where deleted_at is null;
select private.standardise_table('public.wa_orders');
create policy wa_orders_read on public.wa_orders for select to authenticated
  using (deleted_at is null and private.is_office_user() and firm_id = any(private.my_firm_ids()));

create table public.wa_order_lines (
  id            uuid primary key default gen_random_uuid(),
  wa_order_id   uuid not null references public.wa_orders (id),
  wa_line_id    bigint not null,
  line_no       int not null,
  raw_line      text,
  wa_item_name  text,
  pack          text,
  qty_said      numeric(12,3),
  unit_said     text,
  free_qty      numeric(12,3),
  uncertain     boolean not null default false,
  item_id       uuid references public.items (id),
  qty           numeric(12,3),             -- in the item's billing unit
  kg            numeric(12,3),
  note          text,
  problem       text,
  set_by_office boolean not null default false,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  deleted_by    uuid
);
create unique index wa_order_lines_src_uq on public.wa_order_lines (wa_line_id) where deleted_at is null;
create index wa_order_lines_order_idx on public.wa_order_lines (wa_order_id) where deleted_at is null;
select private.standardise_table('public.wa_order_lines');
create policy wa_order_lines_read on public.wa_order_lines for select to authenticated
  using (deleted_at is null and exists (select 1 from public.wa_orders o where o.id = wa_order_id));

-- Group → firm: JALNA LOCAL ORDER is Sushil, all other groups Anjali (owner, D-63).
create or replace function wa.firm_for_group(p_group_name text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select f.id from public.firms f
   where f.code = case when upper(coalesce(p_group_name, '')) like '%JALNA LOCAL%' then 'SA' else 'AA' end
$$;

-- Grams / kg in a pack text like '250g', '1kg', '5kg'; null for '10rs'.
create or replace function wa.pack_kg(p_pack text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_pack ~* '^\s*\d+(\.\d+)?\s*(g|gm|gms|gram)\s*$' then substring(p_pack from '\d+(?:\.\d+)?')::numeric / 1000
    when p_pack ~* '^\s*\d+(\.\d+)?\s*(kg|kgs)\s*$' then substring(p_pack from '\d+(?:\.\d+)?')::numeric
  end
$$;

-- Quantity in the item's billing unit (D-64). Returns qty, kg, note, problem.
create or replace function wa.convert_qty(p_item public.items, p_pack text, p_qty numeric, p_unit text, p_uncertain boolean)
returns table (qty numeric, kg numeric, note text, problem text)
language plpgsql
stable
set search_path = ''
as $$
declare
  u text := nullif(lower(trim(coalesce(p_unit, ''))), '');
  pk numeric := wa.pack_kg(p_pack);
  q numeric;
begin
  if p_qty is null or p_qty <= 0 then
    return query select null::numeric, null::numeric, null::text, 'No quantity';
    return;
  end if;
  u := case
         when u in ('kg', 'kgs', 'kilo', 'किलो') then 'kg'
         when u in ('pkt', 'pkts', 'packet', 'packets', 'pack', 'पॅकेट', 'pc', 'pcs', 'nag', 'नग') then 'pkt'
         when u in ('bag', 'bags', 'katta', 'ktaa', 'कट्टा', 'बॅग') then 'bag'
         when u in ('box', 'boxes', 'बॉक्स') then 'box'
         when u in ('jar', 'jars', 'जार') then 'jar'
         when u in ('tin', 'tins', 'dabba', 'डबा') then 'tin'
         else u
       end;

  if p_item.unit = 'kg' then
    if u is null or u = 'kg' then
      q := p_qty;
      return query select round(q, 3), round(q * p_item.kg_per_unit, 3),
                          case when u is null and pk is not null then format('%s written without unit: read as kg', p_qty) end,
                          case when p_uncertain then 'Unclear in the message' end;
    elsif u in ('pkt', 'jar', 'box') and pk is not null then
      q := round(p_qty * pk, 3);
      return query select q, round(q * p_item.kg_per_unit, 3), format('%s %s × %s kg = %s kg', p_qty, u, pk, q),
                          case when p_uncertain then 'Unclear in the message' end;
    elsif u = 'bag' and pk is not null and pk >= 1 then
      q := round(p_qty * pk, 3);
      return query select q, q, format('%s bag × %s kg = %s kg', p_qty, pk, q),
                          case when p_uncertain then 'Unclear in the message' end;
    else
      return query select null::numeric, null::numeric, null::text, format('"%s %s": unit not understood for an item billed per kg', p_qty, u);
    end if;
    return;
  end if;

  if p_item.unit = 'pkt' then
    if u is null or u = 'pkt' then
      return query select round(p_qty, 3), round(p_qty * p_item.kg_per_unit, 3), null::text,
                          case when p_uncertain then 'Unclear in the message' end;
    elsif u = 'kg' and p_item.kg_per_unit > 0 then
      q := p_qty / p_item.kg_per_unit;
      if abs(q - round(q)) <= 0.05 then
        return query select round(q), round(round(q) * p_item.kg_per_unit, 3),
                            format('%s kg ÷ %s kg per pkt = %s pkt', p_qty, p_item.kg_per_unit, round(q)),
                            case when p_uncertain then 'Unclear in the message' end;
      else
        return query select round(q), round(round(q) * p_item.kg_per_unit, 3),
                            format('%s kg ÷ %s kg per pkt = %s pkt', p_qty, p_item.kg_per_unit, round(q, 2)),
                            format('%s kg is not a whole number of packets (%s); check', p_qty, round(q, 2));
      end if;
    else
      return query select null::numeric, null::numeric, null::text,
                          format('"%s %s": unit not understood for an item billed per pkt%s', p_qty, coalesce(u, ''),
                                 case when p_item.kg_per_unit = 0 then ' (kg per pkt not set)' else '' end);
    end if;
    return;
  end if;

  -- Box / jar / tin / pc items: a plain number or the same unit.
  if u is null or u = p_item.unit or (u in ('box', 'jar', 'tin', 'pkt') and p_item.unit in ('box', 'jar', 'tin', 'can', 'pc')) then
    return query select round(p_qty, 3), round(p_qty * p_item.kg_per_unit, 3), null::text,
                        case when p_uncertain then 'Unclear in the message' end;
  else
    return query select null::numeric, null::numeric, null::text, format('"%s %s": unit not understood for an item billed per %s', p_qty, u, p_item.unit);
  end if;
end;
$$;

-- Customer for a WhatsApp customer name: a saved link, else a unique exact
-- name (the whole text, or the part before the first comma, e.g. "Sarthak
-- Kirana, Mehkar"), preferring customers with an account in the firm.
create or replace function wa.match_customer(p_firm_id uuid, p_text text)
returns uuid
language sql
stable
set search_path = ''
as $$
  with k as (
    select private.ledger_key(p_text) as full_key,
           private.ledger_key(split_part(p_text, ',', 1)) as head_key
  ),
  cand as (
    select c.id,
           exists (select 1 from public.customer_firm_accounts a
                    where a.customer_id = c.id and a.firm_id = p_firm_id and a.deleted_at is null) as in_firm
      from public.customers c, k
     where c.deleted_at is null and c.status <> 'ignore'
       and private.ledger_key(c.name) in (k.full_key, k.head_key)
  )
  select coalesce(
    (select ca.customer_id from public.customer_aliases ca, k
      where ca.source = 'other' and ca.external_id = 'wa:' || k.full_key and ca.deleted_at is null),
    (select min(id::text)::uuid from cand where in_firm having count(*) = 1),
    (select min(id::text)::uuid from cand having count(*) = 1)
  )
$$;

-- Salesman: the sender's name through the source's salesman list, then the
-- ERP user whose name it is (or starts with: "Akshay" ↔ "Akshay Lidhoriye").
create or replace function wa.match_salesman(p_sender text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_name text;
  v_id uuid;
begin
  if to_regclass('wa_src.wa_salesmen') is not null then
    execute 'select s.name from wa_src.wa_salesmen s where lower(s.name) = lower($1) or lower($1) = any (select lower(a) from unnest(s.aliases) a) limit 1'
       into v_name using p_sender;
  end if;
  v_name := coalesce(v_name, p_sender);
  select u.id into v_id
    from public.app_users u
    join public.user_roles r on r.user_id = u.id and r.role = 'salesman' and r.deleted_at is null
   where u.deleted_at is null and u.active
     and (lower(u.full_name) = lower(v_name) or lower(v_name) like lower(u.full_name) || ' %' or lower(u.full_name) like lower(v_name) || ' %')
   order by length(u.full_name) desc
   limit 1;
  return v_id;
end;
$$;

-- Work out customer, salesman, items and quantities for one WhatsApp order,
-- and place it when nothing needs checking (p_auto). Office changes on a line
-- (set_by_office) are kept.
create or replace function wa.prepare(p_id uuid, p_auto boolean default true)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  o       public.wa_orders;
  l       record;
  it      public.items;
  cv      record;
  v_probs text[] := '{}';
  v_lines jsonb := '[]'::jsonb;
  v_res   jsonb;
begin
  select * into o from public.wa_orders where id = p_id and deleted_at is null for update;
  if not found or o.status <> 'review' then
    return coalesce(o.status, 'missing');
  end if;

  if o.customer_id is null and o.customer_text is not null then
    o.customer_id := wa.match_customer(o.firm_id, o.customer_text);
  end if;
  if o.customer_id is null then
    v_probs := v_probs || case when o.customer_text is null then 'No customer name in the message' else format('Customer "%s" not linked', o.customer_text) end;
  end if;
  if o.salesman_id is null then
    o.salesman_id := wa.match_salesman(o.sender_name);
  end if;

  for l in select * from public.wa_order_lines where wa_order_id = o.id and deleted_at is null order by line_no loop
    if not l.set_by_office then
      select i.* into it from public.items i
       where i.deleted_at is null and i.active
         and (lower(i.name) = lower(l.wa_item_name)
              or i.id in (select a.item_id from public.item_aliases a where lower(a.alias_name) = lower(l.wa_item_name) and a.deleted_at is null))
       order by (lower(i.name) = lower(l.wa_item_name)) desc
       limit 1;
      if not found then
        update public.wa_order_lines set item_id = null, qty = null, kg = null, note = null,
               problem = format('Item "%s" not in the ERP', coalesce(l.wa_item_name, l.raw_line))
         where id = l.id;
      else
        select * into cv from wa.convert_qty(it, l.pack, l.qty_said, l.unit_said, l.uncertain);
        update public.wa_order_lines set item_id = it.id, qty = cv.qty, kg = cv.kg, note = cv.note, problem = cv.problem
         where id = l.id;
      end if;
    end if;
  end loop;

  v_probs := v_probs || (select coalesce(array_agg(format('Line %s: %s', w.line_no, w.problem) order by w.line_no), '{}')
                           from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null and w.problem is not null);
  if exists (select 1 from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null
              group by w.item_id having count(*) > 1 and w.item_id is not null) then
    v_probs := v_probs || 'The same item is on two lines';
  end if;
  if not exists (select 1 from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null) then
    v_probs := v_probs || 'No item lines';
  end if;
  if o.salesman_id is null and p_auto then
    v_probs := v_probs || format('Salesman "%s" not linked to an ERP user', coalesce(o.sender_name, '?'));
  end if;

  update public.wa_orders set customer_id = o.customer_id, salesman_id = o.salesman_id, problems = v_probs where id = o.id;

  if cardinality(v_probs) = 0 and p_auto then
    begin
      v_res := private.create_order_core(jsonb_build_object(
        'client_op_id', private.wa_op_id(o.external_key),
        'firm_id', o.firm_id, 'customer_id', o.customer_id,
        'source', case when o.salesman_id is null then 'whatsapp_paste' else 'salesman' end, 'salesman_id', o.salesman_id,
        'order_date', o.order_date,
        'note', format('WhatsApp %s · %s', coalesce(o.group_name, ''), coalesce(o.sender_name, '')),
        'lines', (select jsonb_agg(jsonb_build_object('item_id', w.item_id, 'qty', w.qty) order by w.line_no)
                    from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null)
      ), o.salesman_id);
      update public.wa_orders set status = 'ordered', order_id = (v_res ->> 'id')::uuid where id = o.id;
      return 'ordered';
    exception when others then
      update public.wa_orders set problems = problems || sqlerrm where id = o.id;
      return 'review';
    end;
  end if;
  return 'review';
end;
$$;

-- A stable client_op_id per WhatsApp order, so a retry never makes a second order.
create or replace function private.wa_op_id(p_key text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select (substr(md5('wa-order:' || p_key), 1, 8) || '-' || substr(md5('wa-order:' || p_key), 9, 4) || '-4' ||
          substr(md5('wa-order:' || p_key), 14, 3) || '-8' || substr(md5('wa-order:' || p_key), 18, 3) || '-' ||
          substr(md5('wa-order:' || p_key), 21, 12))::uuid
$$;

-- -----------------------------------------------------------------------------
-- Sync: messages parsed in the last day (or since the last run, 30 min overlap).
-- New orders come in; orders still under review get their lines refreshed;
-- deleted messages cancel orders not yet placed.
-- -----------------------------------------------------------------------------
create or replace function wa.run_sync(p_trigger text default 'cron')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_log    bigint;
  v_since  timestamptz;
  v_new    int := 0;
  v_upd    int := 0;
  v_cancel int := 0;
  v_n      int;
  v_placed int := 0;
  m        record;
  r        record;
  v_id     uuid;
  v_ins    boolean;
  v_res    text;
  v_status text;
  v_counts jsonb;
begin
  if to_regclass('wa_src.wa_order_lines') is null then
    return jsonb_build_object('status', 'skipped', 'reason', 'WhatsApp orders are not connected yet');
  end if;
  if not pg_try_advisory_xact_lock(hashtext('wa.run_sync')) then
    return jsonb_build_object('status', 'skipped', 'reason', 'A sync is already running');
  end if;
  v_since := coalesce((select max(started_at) from wa.sync_log where status = 'ok') - interval '30 minutes',
                      now() - interval '1 day');
  insert into wa.sync_log (trigger) values (p_trigger) returning id into v_log;

  begin
    for m in
      select x.id, x.group_jid, x.sender_name, x.sent_at, x.body, x.parse_status, x.parse_notes, g.subject
        from wa_src.wa_messages x
        left join wa_src.wa_groups g on g.jid = x.group_jid
       where coalesce(x.parsed_at, x.received_at, x.sent_at) >= v_since
    loop
      if m.parse_status in ('deleted', 'ignored') then
        update public.wa_orders set status = 'cancelled', note = 'Message ' || m.parse_status || ' in WhatsApp'
         where wa_message_id = m.id and status = 'review' and deleted_at is null;
        get diagnostics v_n = row_count;
        v_cancel := v_cancel + v_n;
        continue;
      end if;
      continue when m.parse_status <> 'parsed';

      for r in
        select t.order_no, max(t.customer) as customer
          from wa_src.wa_order_lines t where t.message_id = m.id group by t.order_no
      loop
        insert into public.wa_orders (external_key, wa_message_id, order_no, group_jid, group_name, firm_id, sent_at, order_date,
                                      sender_name, customer_text, message_body, parse_notes)
        values (m.id || ':' || r.order_no, m.id, r.order_no, m.group_jid, m.subject, wa.firm_for_group(m.subject), m.sent_at,
                (m.sent_at at time zone 'Asia/Kolkata')::date, m.sender_name, nullif(trim(r.customer), ''), m.body, m.parse_notes)
        on conflict (external_key) where deleted_at is null do update
           set customer_text = excluded.customer_text, message_body = excluded.message_body, parse_notes = excluded.parse_notes,
               customer_id = case when public.wa_orders.customer_text is distinct from excluded.customer_text then null
                                  else public.wa_orders.customer_id end
         where public.wa_orders.status = 'review'
        returning id, (xmax = 0) into v_id, v_ins;
        continue when v_id is null; -- placed, ignored or cancelled: leave it
        if v_ins then v_new := v_new + 1; else v_upd := v_upd + 1; end if;

        -- Lines: refresh what came from WhatsApp, keep office changes.
        update public.wa_order_lines w set deleted_at = now()
         where w.wa_order_id = v_id and w.deleted_at is null and not w.set_by_office
           and not exists (select 1 from wa_src.wa_order_lines t where t.id = w.wa_line_id and t.message_id = m.id and t.order_no = r.order_no);
        insert into public.wa_order_lines (wa_order_id, wa_line_id, line_no, raw_line, wa_item_name, pack, qty_said, unit_said, free_qty, uncertain)
        select v_id, t.id, row_number() over (order by t.id), t.raw_line, t.item_name, t.pack, t.qty, t.unit, t.free_qty, coalesce(t.uncertain, false)
          from wa_src.wa_order_lines t
         where t.message_id = m.id and t.order_no = r.order_no
           -- a line the office removed stays removed
           and not exists (select 1 from public.wa_order_lines x where x.wa_line_id = t.id and x.set_by_office and x.deleted_at is not null)
        on conflict (wa_line_id) where deleted_at is null do update
           set raw_line = excluded.raw_line, wa_item_name = excluded.wa_item_name, pack = excluded.pack,
               qty_said = excluded.qty_said, unit_said = excluded.unit_said, free_qty = excluded.free_qty, uncertain = excluded.uncertain
         where not public.wa_order_lines.set_by_office;

        v_res := wa.prepare(v_id, true);
        if v_res = 'ordered' then v_placed := v_placed + 1; end if;
      end loop;
    end loop;

    v_counts := jsonb_build_object('new', v_new, 'updated', v_upd, 'placed', v_placed, 'cancelled', v_cancel);
    update wa.sync_log set status = 'ok', counts = v_counts, finished_at = clock_timestamp() where id = v_log;
    v_status := 'ok';
  exception when others then
    update wa.sync_log set status = 'failed', error = sqlerrm, finished_at = clock_timestamp() where id = v_log;
    v_status := 'failed';
    v_counts := jsonb_build_object('error', sqlerrm);
  end;
  return jsonb_build_object('status', v_status, 'counts', v_counts);
end;
$$;

-- -----------------------------------------------------------------------------
-- Office actions
-- -----------------------------------------------------------------------------
create or replace function private.wa_order_for_office(p_id uuid)
returns public.wa_orders
language plpgsql
security definer
set search_path = ''
as $$
declare o public.wa_orders;
begin
  if not (private.has_perm('order.create') and private.is_office_user()) then
    raise exception 'You are not allowed to do this' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.wa_orders where id = p_id and deleted_at is null for update;
  if not found or not (o.firm_id = any(private.my_firm_ids())) then
    raise exception 'WhatsApp order not found' using errcode = 'no_data_found';
  end if;
  if o.status <> 'review' then
    raise exception 'This order is already %', o.status using errcode = 'check_violation';
  end if;
  return o;
end;
$$;

-- Link the customer; the wording is remembered for later orders.
create or replace function public.wa_link_customer(p_id uuid, p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.wa_orders := private.wa_order_for_office(p_id);
begin
  if not exists (select 1 from public.customers where id = p_customer_id and deleted_at is null) then
    raise exception 'Customer not found' using errcode = 'no_data_found';
  end if;
  if o.customer_text is not null then
    update public.customer_aliases set deleted_at = now(), deleted_by = auth.uid()
     where source = 'other' and external_id = 'wa:' || private.ledger_key(o.customer_text)
       and deleted_at is null and customer_id <> p_customer_id;
    insert into public.customer_aliases (customer_id, source, external_id, alias_name)
    select p_customer_id, 'other', 'wa:' || private.ledger_key(o.customer_text), o.customer_text
     where not exists (select 1 from public.customer_aliases
                        where source = 'other' and external_id = 'wa:' || private.ledger_key(o.customer_text) and deleted_at is null);
  end if;
  update public.wa_orders set customer_id = p_customer_id where id = p_id;
  perform wa.prepare(p_id, false);
end;
$$;

-- Set a line's item and billing quantity by hand (also for an unclear line).
create or replace function public.wa_set_line(p_line_id uuid, p_item_id uuid, p_qty numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  w  public.wa_order_lines;
  it public.items;
begin
  select * into w from public.wa_order_lines where id = p_line_id and deleted_at is null;
  if not found then
    raise exception 'Line not found' using errcode = 'no_data_found';
  end if;
  perform private.wa_order_for_office(w.wa_order_id);
  select * into it from public.items where id = p_item_id and deleted_at is null and active;
  if not found then
    raise exception 'Item not found or not active' using errcode = 'check_violation';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then
    raise exception 'Quantity must be more than 0' using errcode = 'check_violation';
  end if;
  update public.wa_order_lines
     set item_id = it.id, qty = round(p_qty, 3), kg = round(round(p_qty, 3) * it.kg_per_unit, 3),
         problem = null, note = coalesce(note || ' · ', '') || 'set by office', set_by_office = true
   where id = p_line_id;
  -- Teach the item name so the next order with it matches.
  if w.wa_item_name is not null and lower(w.wa_item_name) <> lower(it.name)
     and not exists (select 1 from public.item_aliases a where lower(a.alias_name) = lower(w.wa_item_name) and a.deleted_at is null) then
    insert into public.item_aliases (item_id, source, alias_name) values (it.id, 'other', lower(w.wa_item_name));
  end if;
  perform wa.prepare(w.wa_order_id, false);
end;
$$;

-- Drop a line the office doesn't want on the order.
create or replace function public.wa_remove_line(p_line_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare w public.wa_order_lines;
begin
  select * into w from public.wa_order_lines where id = p_line_id and deleted_at is null;
  if not found then
    raise exception 'Line not found' using errcode = 'no_data_found';
  end if;
  perform private.wa_order_for_office(w.wa_order_id);
  update public.wa_order_lines set deleted_at = now(), deleted_by = auth.uid(), set_by_office = true where id = p_line_id;
  perform wa.prepare(w.wa_order_id, false);
end;
$$;

-- Place the order once everything is set. The office user is the requester.
create or replace function public.wa_place_order(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.wa_orders := private.wa_order_for_office(p_id);
  v_res jsonb;
begin
  perform wa.prepare(p_id, false);
  select * into o from public.wa_orders where id = p_id;
  if cardinality(o.problems) > 0 then
    raise exception 'Fix first: %', array_to_string(o.problems, '; ') using errcode = 'check_violation';
  end if;
  v_res := private.create_order_core(jsonb_build_object(
    'client_op_id', private.wa_op_id(o.external_key),
    'firm_id', o.firm_id, 'customer_id', o.customer_id,
    'source', case when o.salesman_id is null then 'whatsapp_paste' else 'salesman' end, 'salesman_id', o.salesman_id,
    'order_date', greatest(o.order_date, private.today_ist() - 7),
    'note', format('WhatsApp %s · %s', coalesce(o.group_name, ''), coalesce(o.sender_name, '')),
    'lines', (select jsonb_agg(jsonb_build_object('item_id', w.item_id, 'qty', w.qty) order by w.line_no)
                from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null)
  ), private.current_app_user_id());
  update public.wa_orders set status = 'ordered', order_id = (v_res ->> 'id')::uuid where id = p_id;
  return v_res;
end;
$$;

create or replace function public.wa_ignore_order(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare o public.wa_orders := private.wa_order_for_office(p_id);
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Give a reason' using errcode = 'check_violation';
  end if;
  update public.wa_orders set status = 'ignored', note = trim(p_reason) where id = o.id;
end;
$$;

create or replace function public.wa_sync_status()
returns table (connected boolean, started_at timestamptz, finished_at timestamptz, status text, counts jsonb,
               error text, last_ok_at timestamptz, waiting bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select to_regclass('wa_src.wa_order_lines') is not null, l.started_at, l.finished_at, l.status, l.counts, l.error,
         (select max(s.finished_at) from wa.sync_log s where s.status = 'ok'),
         (select count(*) from public.wa_orders w where w.status = 'review' and w.deleted_at is null and w.firm_id = any(private.my_firm_ids()))
    from (select 1) one
    left join lateral (select * from wa.sync_log s order by s.started_at desc limit 1) l on true
   where private.is_office_user()
$$;

create or replace function public.wa_sync_now()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (private.has_perm('order.create') and private.is_office_user()) then
    raise exception 'You are not allowed to start a sync' using errcode = 'insufficient_privilege';
  end if;
  return wa.run_sync('manual');
end;
$$;

revoke all on all functions in schema wa from public;
revoke all on all tables in schema wa from anon, authenticated;
revoke execute on function private.create_order_core(jsonb, uuid), private.wa_op_id(text),
  private.wa_order_for_office(uuid) from public, anon, authenticated;
revoke execute on function public.wa_link_customer(uuid, uuid), public.wa_set_line(uuid, uuid, numeric),
  public.wa_remove_line(uuid), public.wa_place_order(uuid), public.wa_ignore_order(uuid, text),
  public.wa_sync_status(), public.wa_sync_now() from public, anon;
grant execute on function public.wa_link_customer(uuid, uuid), public.wa_set_line(uuid, uuid, numeric),
  public.wa_remove_line(uuid), public.wa_place_order(uuid), public.wa_ignore_order(uuid, text),
  public.wa_sync_status(), public.wa_sync_now() to authenticated;
