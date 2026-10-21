-- =============================================================================
-- SA ERP · 0023 Closest customers for a WhatsApp customer name (D-65)
-- Salesmen add the area to the shop name ("Jamjam kirana.B.N."), so few names
-- match exactly. The office gets the closest ERP customers to tap; the link is
-- remembered, so later orders from that shop come in on their own.
-- =============================================================================
create extension if not exists pg_trgm with schema extensions;

create or replace function public.wa_customer_suggestions(p_id uuid)
returns table (customer_id uuid, name text, beat_name text, score numeric, in_firm boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with o as (
    select w.firm_id,
           lower(regexp_replace(w.customer_text, '[^[:alnum:][:space:]]+', ' ', 'g')) as full_text,
           lower(trim(split_part(split_part(w.customer_text, ',', 1), '.', 1))) as head
      from public.wa_orders w
     where w.id = p_id and w.deleted_at is null and w.customer_text is not null
       and private.is_office_user() and w.firm_id = any(private.my_firm_ids())
  )
  select c.id, c.name, b.name,
         round(greatest(extensions.similarity(lower(c.name), o.full_text),
                        extensions.word_similarity(o.head, lower(c.name)))::numeric, 2) as score,
         exists (select 1 from public.customer_firm_accounts a
                  where a.customer_id = c.id and a.firm_id = o.firm_id and a.deleted_at is null)
    from o
    join public.customers c on c.deleted_at is null and c.status <> 'ignore'
    left join public.beats b on b.id = c.beat_id
   order by 4 desc, 5 desc, c.name
   limit 6
$$;

revoke execute on function public.wa_customer_suggestions(uuid) from public, anon;
grant execute on function public.wa_customer_suggestions(uuid) to authenticated;
