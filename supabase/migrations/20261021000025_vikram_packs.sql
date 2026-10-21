-- =============================================================================
-- SA ERP · 0025 Pack sizes from the Vikram rate-scheme sheet (D-67)
-- "Rate Scheme 14-Oct-2026 to 10-Nov-2026", sheet "Jal, Amrvti, Gond, Ngpur".
--   items.supplier_code   Vikram product code
--   items.pack_size_g     one packet as the salesman counts it (250 g pouch,
--                         or one sachet "Pkt": std weight ÷ std packing)
--   items.units_per_case  packets per standard bag / box
--   items.kg_per_unit     for sachet items billed per Pkt: the sheet's kg per Pkt
-- WhatsApp quantity rule (D-64) now also covers rupee sachets billed per kg
-- (Lion No 5 Rs 20): a plain number is packets × the packet weight.
-- =============================================================================

alter table public.items add column if not exists supplier_code text;

update public.items i
   set supplier_code  = v.code,
       pack_size_g    = v.pack_g,
       units_per_case = v.per_case,
       kg_per_unit    = case when i.unit = 'pkt' then round(v.pack_g::numeric / 1000, 3) else i.kg_per_unit end
  from (values
    ('lion no 5 - 250 gm',                    'L5D250PA220K',   250, 80),
    ('lion no 5 - 500 gm',                    'L5D500PA220K',   500, 40),
    ('lion no 5 -100 gm',                     'L5D100PA320K',   100, 200),
    ('lion no.5 1 kg.',                       'L5D1KGPA120K',  1000, 20),
    ('lion 1 kg (zola bag free )',            'L5D1KGPA120K',  1000, 20),
    ('lion 1 kg (bucket free ) 411 rs',       'L5D1KGPA120K',  1000, 20),
    ('lion no 5 10 rs',                       'L5D022PA410P',   660, 10),
    ('lion no 5 rs 20 (new)',                 'L5D046PA310P',   460, 20),
    ('lion no 5 rs 5/-',                      'L5D011PA220P',   550, 20),
    ('lion 5 rs',                             'L5D011PA220P',   550, 20),
    ('vikram dust - 100 gm',                  'VDD100PA320K',   100, 200),
    ('vikram dust - 250 gm',                  'VDD250PA520K',   250, 80),
    ('vikram dust - 500 gm',                  'VDD500PA420K',   500, 40),
    ('vikram dust 1 kg.',                     'VDD1KGPA420K',  1000, 20),
    ('vikram dust 5kg',                       'VDD5KGTA430K',  5000, 6),
    ('vikram dust 10 rs',                     'VDD022PA410P',   660, 10),
    ('vikram dust 20 rs',                     'VDD045PA310P',   450, 20),
    ('vikram kadak dust 20 rs',               'VDD045PA310P',   450, 20),
    ('vikram kadak dust 200 gm',              'VDD200PA420K',   200, 100),
    ('vikram kadak dust 5 rs ( new )',        'VDD011PA220P',   600, 20),
    ('vikram elachi 10 rs',                   'VED020PA220P',   480, 20),
    ('vikram elachi 10 rs ( new pack )',      'VED020PA220P',   480, 20),
    ('vikram elachi dust 20 rs',              'VED040PA320PS0', 480, 20),
    ('vikram elachi dust 20 rs (new)',        'VED040PA320PS0', 480, 20),
    ('vikram elaichi 100gm',                  'VED100PA520K',   100, 200),
    ('vikram elaichi 250 gm',                 'VED250PA420K',   250, 80),
    ('vikram elachi 250 gm jar',              'VED250JA110K',   250, 40),
    ('vikram elaichi 250gm jar',              'VED250JA110K',   250, 40),
    ('vikram elaichi dust 500 gm jar',        'VED500JA410K',   500, 20),
    ('vikram elachi dust 1 kg standee',       'VED1KGSA410K',  1000, 10),
    ('vikram gold 1 kg (standy pouch)',       'VGM1KGSA910K',  1000, 10),
    ('vikram gold mix 10 rs',                 'VGM022PA140P',   264, 40),
    ('vikram gold mix 100 gm',                'VGM100BA310K',   100, 100),
    ('vikram gold mix 100 gm container',      'VGM100BA310K',   100, 100),
    ('vikram gold mix 250 gm.',               'VGM250BA810K',   250, 40),
    ('vikram gold mix 500 gm',                'VGM500BA910K',   500, 20),
    ('vikram klassic 1kg standee',            'VKC1KGSA610KS1',1000, 10),
    ('vikram lion ( n ) 1kg',                 'VLN1KGPA1120KS1',1000, 20),
    ('vikram lion ( n ) 250gm',               'VLN250PA420KS1', 250, 80),
    ('vikram lion 1 kg (p)',                  'VLN1KGPA1120KS1',1000, 20),
    ('vikram lion 1 kg 435 rs',               'VLN1KGPA1120KS1',1000, 20),
    ('vikram lion dust 1 kg 435 rs,',         'VLN1KGPA1120KS1',1000, 20),
    ('vikram lion 500 gm jar dust',           'VLN500JA510K',   500, 20),
    ('vikram masala tea 250gm box',           'VMC250BA202KS0', 250, 8),
    ('vikram green tea 100 gm box',           'GRC100BA001K',   100, 10),
    ('janta dust',                            'JDD5KGTA130K',  5000, 6),
    ('new sagar mix 5 kg bag',                'NSM5KGTA130K',  5000, 6),
    ('rupa second flush ctc 500 gm box',      'RPC500BA202K',   500, 4)
  ) as v (name, code, pack_g, per_case)
 where lower(i.name) = v.name and i.deleted_at is null;

-- Quantity in the item's billing unit (D-64, D-67). Rupee sachets: a plain
-- number is packets; billed per kg (Lion No 5 Rs 20) that is packets × packet kg.
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
