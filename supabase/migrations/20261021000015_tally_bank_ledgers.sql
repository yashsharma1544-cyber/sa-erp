-- =============================================================================
-- SA ERP · 0015 Bank ledgers from Tally, to pick deposit accounts from
-- =============================================================================
create or replace function public.tally_bank_ledgers()
returns table (firm_id uuid, ledger_name text, tally_group text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct cf.firm_id, l.ledger_name, l."group"
    from tally.ledger_balances l
    join tally.v_company_firm cf on cf.company_id = l.company_id
    join tally.companies c on c.id = l.company_id
   where private.is_office_user()
     and cf.firm_id = any(private.my_firm_ids())
     and private.today_ist() between c.fy_start_date and c.fy_end_date
     and l.removed_at is null and not coalesce(l.is_voided, false)
     and l."group" in ('Bank Accounts', 'Bank OD A/c')
   order by 1, 2
$$;
revoke execute on function public.tally_bank_ledgers() from public, anon;
grant execute on function public.tally_bank_ledgers() to authenticated;
