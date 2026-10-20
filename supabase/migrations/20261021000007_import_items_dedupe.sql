-- =============================================================================
-- SA ERP · 0007 Item import: Tally names that differ only in spacing become
-- aliases of one item instead of failing on the unique name index.
-- (Applied live on 2026-10-21; 0006 in the repo already carries this body, so
-- re-running it is a no-op.)
-- =============================================================================

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
