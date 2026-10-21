-- =============================================================================
-- SA ERP · 0024 WhatsApp sync fix
-- The first live sync stopped on "The same item is on two lines": a bare
-- string appended to a text[] is read as an array literal. Cast it, and let
-- one order's error stay on that order instead of stopping the whole sync.
-- =============================================================================

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
    v_probs := v_probs || 'The same item is on two lines'::text;
  end if;
  if not exists (select 1 from public.wa_order_lines w where w.wa_order_id = o.id and w.deleted_at is null) then
    v_probs := v_probs || 'No item lines'::text;
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
      update public.wa_orders set problems = problems || sqlerrm::text where id = o.id;
      return 'review';
    end;
  end if;
  return 'review';
end;
$$;

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

        -- One bad order must not stop the others.
        begin
          v_res := wa.prepare(v_id, true);
        exception when others then
          update public.wa_orders set problems = array[sqlerrm::text] where id = v_id;
          v_res := 'review';
        end;
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

revoke all on all functions in schema wa from public;
