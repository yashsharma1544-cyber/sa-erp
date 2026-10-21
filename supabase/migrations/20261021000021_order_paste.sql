-- =============================================================================
-- SA ERP · 0021 WhatsApp order paste (slice 2.2, D-62)
--   item_popularity(): sales lines per item in the last 90 days, so the
--     message parser prefers the item people actually buy.
--   learn_item_aliases(): when the office corrects a pasted line, its wording
--     is saved (source 'other') so the same wording matches next time.
-- =============================================================================

create or replace function public.item_popularity()
returns table (item_id uuid, lines bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select a.item_id, count(*)
    from tally.voucher_lines l
    join tally.vouchers v on v.id = l.voucher_id and v.voucher_kind = 'sales' and v.removed_at is null
    join public.item_aliases a on a.source = 'tally' and lower(a.alias_name) = lower(l.item_name) and a.deleted_at is null
   where l.removed_at is null and v.voucher_date >= private.today_ist() - 90
     and private.has_perm('order.create')
   group by a.item_id
$$;

create or replace function public.learn_item_aliases(p jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  x jsonb;
  v_text text;
  v_n int := 0;
begin
  if not private.has_perm('order.create') then
    raise exception 'You are not allowed to do this' using errcode = 'insufficient_privilege';
  end if;
  for x in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_text := regexp_replace(lower(trim(x ->> 'text')), '\s+', ' ', 'g');
    continue when v_text is null or length(v_text) < 3 or length(v_text) > 120;
    continue when not exists (select 1 from public.items i where i.id = (x ->> 'item_id')::uuid and i.deleted_at is null);
    -- Wording already linked (to this or another item) is left alone: the first correction wins.
    continue when exists (select 1 from public.item_aliases a where lower(a.alias_name) = v_text and a.deleted_at is null);
    insert into public.item_aliases (item_id, source, alias_name) values ((x ->> 'item_id')::uuid, 'other', v_text);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

revoke execute on function public.item_popularity(), public.learn_item_aliases(jsonb) from public, anon;
grant execute on function public.item_popularity(), public.learn_item_aliases(jsonb) to authenticated;
