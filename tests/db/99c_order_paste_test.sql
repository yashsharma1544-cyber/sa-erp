-- WhatsApp paste helpers: wording is learnt once; popularity needs order.create.
\set sm_auth    '00000000-0000-0000-0000-00000000e002'
\set col_auth   '00000000-0000-0000-0000-00000000f001'

set role authenticated;
select set_config('request.jwt.claim.sub', :'sm_auth', false);
do $$
begin
  if public.learn_item_aliases('[{"item_id": "00000000-0000-0000-0000-0000000a0001", "text": "  Peela   Tea "}, {"item_id": "00000000-0000-0000-0000-0000000a0001", "text": "x"}]') <> 1 then
    raise exception 'learn count';
  end if;
  -- Same wording again (even for another item) is ignored.
  if public.learn_item_aliases('[{"item_id": "00000000-0000-0000-0000-0000000a0002", "text": "peela tea"}]') <> 0 then raise exception 'relearnt'; end if;
  if (select item_id from public.item_aliases where alias_name = 'peela tea') <> '00000000-0000-0000-0000-0000000a0001' then raise exception 'alias item'; end if;
  if (select lines from public.item_popularity() where item_id = '00000000-0000-0000-0000-0000000a0001') <> 2 then raise exception 'popularity'; end if;
end;
$$;
-- A collector can't take orders, so can't teach wording either.
select set_config('request.jwt.claim.sub', :'col_auth', false);
do $$
begin
  perform public.learn_item_aliases('[{"item_id": "00000000-0000-0000-0000-0000000a0001", "text": "other tea"}]');
  raise exception 'collector learnt an alias';
exception when insufficient_privilege then null;
end;
$$;
do $$ begin if exists (select 1 from public.item_popularity()) then raise exception 'collector saw popularity'; end if; end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);
