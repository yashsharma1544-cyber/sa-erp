-- =============================================================================
-- SA ERP · 0026 Fix sachet weights from 0025, and "katta" of small packs
-- 0025 set kg per Pkt with integer division (660 / 1000 = 0), so sachet items
-- lost their weight. Set it from the packet weight again. A bag / katta of
-- small packs is one standard bag: packets per bag × packet weight.
-- =============================================================================

update public.items
   set kg_per_unit = round(pack_size_g / 1000, 3)
 where unit = 'pkt' and supplier_code is not null and pack_size_g is not null and deleted_at is null
   and kg_per_unit is distinct from round(pack_size_g / 1000, 3);

create or replace function wa.convert_qty(p_item public.items, p_pack text, p_qty numeric, p_unit text, p_uncertain boolean)
returns table (qty numeric, kg numeric, note text, problem text)
language plpgsql
stable
set search_path = ''
as $$
declare
  u text := nullif(lower(trim(coalesce(p_unit, ''))), '');
  pk numeric := coalesce(p_item.pack_size_g / 1000, wa.pack_kg(p_pack));
  rupee boolean := coalesce(p_pack, '') ~* 'rs' or p_item.name ~* '\m(rs\.?|rs)\s*\d|\d+\s*rs';
  unclear text := case when p_uncertain then 'Unclear in the message' end;
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
    if rupee and (u is null or u = 'pkt') then
      -- Sachets billed per kg: the number is packets.
      if pk is null then
        return query select null::numeric, null::numeric, null::text, format('%s packets: packet weight not set for this item', p_qty);
      else
        q := round(p_qty * pk, 3);
        return query select q, q, format('%s pkt × %s kg = %s kg', p_qty, pk, q), unclear;
      end if;
    elsif u is null or u = 'kg' then
      return query select round(p_qty, 3), round(p_qty * p_item.kg_per_unit, 3),
                          case when u is null then format('%s written without unit: read as kg', p_qty) end, unclear;
    elsif u in ('pkt', 'jar', 'box') and pk is not null then
      q := round(p_qty * pk, 3);
      return query select q, q, format('%s %s × %s kg = %s kg', p_qty, u, pk, q), unclear;
    elsif u = 'bag' and pk is not null and pk >= 1 then
      q := round(p_qty * pk, 3);
      return query select q, q, format('%s bag × %s kg = %s kg', p_qty, pk, q), unclear;
    elsif u = 'bag' and pk is not null and p_item.units_per_case > 0 then
      -- A katta of small packs is one standard bag (e.g. 80 × 250 g = 20 kg).
      q := round(p_qty * p_item.units_per_case * pk, 3);
      return query select q, q, format('%s bag × %s × %s kg = %s kg', p_qty, p_item.units_per_case, pk, q), unclear;
    else
      return query select null::numeric, null::numeric, null::text, format('"%s %s": unit not understood for an item billed per kg', p_qty, u);
    end if;
    return;
  end if;

  if p_item.unit = 'pkt' then
    if u is null or u = 'pkt' then
      return query select round(p_qty, 3), round(p_qty * p_item.kg_per_unit, 3), null::text, unclear;
    elsif u = 'kg' and p_item.kg_per_unit > 0 then
      q := p_qty / p_item.kg_per_unit;
      if abs(q - round(q)) <= 0.05 then
        return query select round(q), round(round(q) * p_item.kg_per_unit, 3),
                            format('%s kg ÷ %s kg per pkt = %s pkt', p_qty, p_item.kg_per_unit, round(q)), unclear;
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

  if u is null or u = p_item.unit or (u in ('box', 'jar', 'tin', 'pkt') and p_item.unit in ('box', 'jar', 'tin', 'can', 'pc')) then
    return query select round(p_qty, 3), round(p_qty * p_item.kg_per_unit, 3), null::text, unclear;
  else
    return query select null::numeric, null::numeric, null::text, format('"%s %s": unit not understood for an item billed per %s', p_qty, u, p_item.unit);
  end if;
end;
$$;

revoke all on all functions in schema wa from public;
