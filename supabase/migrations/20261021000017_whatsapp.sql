-- =============================================================================
-- SA ERP · 0017 WhatsApp through WATi (Phase 1, slice 1.5), D-49
--   * wa_templates: the Marathi templates approved in WATi, with their params
--   * wa_messages: every message the ERP sends (or would send), one log
--   * a receipt message is queued the moment a receipt is recorded; the app
--     sends it straight away. A daily job queues reminders from the ladder
--     and promise reminders, closes past promises, and retries.
--   * each receipt has an unguessable link to a Marathi receipt page
--   * customers can be opted out of WhatsApp
-- Nothing is sent until a template is marked approved and active.
-- =============================================================================

alter table public.customers add column if not exists wa_opt_out boolean not null default false;
alter table public.receipts add column if not exists public_token uuid not null default gen_random_uuid();
create unique index if not exists receipts_public_token_uq on public.receipts (public_token);

create table public.wa_templates (
  id                  uuid primary key default gen_random_uuid(),
  key                 text not null unique check (key in ('receipt', 'reminder', 'reminder_firm', 'promise_due')),
  language            text not null default 'mr' check (language = 'mr'),
  wati_template_name  text,
  params              text[] not null,
  body_mr             text not null,
  approved            boolean not null default false,
  active              boolean not null default false,
  created_at          timestamptz not null default now(),
  created_by          uuid default auth.uid(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  deleted_by          uuid,
  constraint wa_templates_ready check (not active or (approved and wati_template_name is not null))
);
select private.standardise_table('public.wa_templates');

create table public.reminder_rules (
  id                 uuid primary key default gen_random_uuid(),
  min_overdue_days   int not null check (min_overdue_days between 0 and 365),
  template_key       text not null references public.wa_templates (key),
  repeat_every_days  int not null check (repeat_every_days between 1 and 60),
  active             boolean not null default false,
  created_at         timestamptz not null default now(),
  created_by         uuid default auth.uid(),
  updated_at         timestamptz not null default now(),
  updated_by         uuid,
  deleted_at         timestamptz,
  deleted_by         uuid
);
create unique index reminder_rules_days_uq on public.reminder_rules (min_overdue_days) where deleted_at is null;
select private.standardise_table('public.reminder_rules');

create table public.wa_messages (
  id               uuid primary key default gen_random_uuid(),
  firm_id          uuid references public.firms (id),
  customer_id      uuid references public.customers (id),
  template_key     text not null references public.wa_templates (key),
  to_number        text not null,
  data             jsonb not null,           -- raw values; the sender formats them
  related_table    text,
  related_id       uuid,
  dedupe_key       text not null unique,     -- one message per receipt / per customer per rule per day
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempts         int not null default 0,
  wati_message_id  text,
  error            text,
  sent_at          timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid,
  deleted_at       timestamptz,
  deleted_by       uuid
);
create index wa_messages_queue_idx on public.wa_messages (created_at) where status = 'queued' and deleted_at is null;
create index wa_messages_customer_idx on public.wa_messages (customer_id, created_at desc) where deleted_at is null;
select private.standardise_table('public.wa_messages');

create policy wa_templates_read on public.wa_templates for select to authenticated using (private.is_office_user());
create policy wa_templates_update on public.wa_templates for update to authenticated
  using (private.is_owner() or private.has_perm('settings.manage'))
  with check (private.is_owner() or private.has_perm('settings.manage'));
create policy reminder_rules_read on public.reminder_rules for select to authenticated using (private.is_office_user());
create policy reminder_rules_update on public.reminder_rules for update to authenticated
  using (private.is_owner() or private.has_perm('settings.manage'))
  with check (private.is_owner() or private.has_perm('settings.manage'));
create policy wa_messages_read on public.wa_messages for select to authenticated
  using (private.is_office_user() and (firm_id is null or firm_id = any(private.my_firm_ids())));
revoke insert on public.wa_templates, public.reminder_rules from authenticated;
revoke insert, update on public.wa_messages from authenticated;

-- Template texts to submit in WATi (Utility category, Marathi). {{n}} follow `params`.
insert into public.wa_templates (key, params, body_mr) values
  ('receipt', array['customer_name', 'firm_name', 'amount', 'mode', 'date', 'receipt_no', 'link'],
   'नमस्कार {{1}}, {{2}} कडे आपला ₹{{3}} चा भरणा ({{4}}) दि. {{5}} रोजी मिळाला. पावती क्र. {{6}}. पावती पहा: {{7}} धन्यवाद!'),
  ('reminder', array['customer_name', 'firm_name', 'outstanding', 'overdue', 'days'],
   'नमस्कार {{1}}, {{2}} ची आपली एकूण बाकी ₹{{3}} आहे. त्यापैकी ₹{{4}} ची बिले {{5}} दिवसांपेक्षा जुनी आहेत. कृपया लवकरात लवकर भरणा करावा. धन्यवाद.'),
  ('reminder_firm', array['customer_name', 'firm_name', 'outstanding', 'overdue', 'days'],
   'नमस्कार {{1}}, {{2}} ची आपली ₹{{4}} ची बिले {{5}} दिवसांपेक्षा जास्त थकीत आहेत (एकूण बाकी ₹{{3}}). कृपया त्वरित भरणा करावा, अन्यथा पुढील माल पाठवणे थांबवावे लागेल.'),
  ('promise_due', array['customer_name', 'promise_date', 'amount', 'firm_name'],
   'नमस्कार {{1}}, आपण दि. {{2}} रोजी ₹{{3}} भरण्याचे सांगितले होते. आमचे प्रतिनिधी आज भेटतील. धन्यवाद – {{4}}')
on conflict (key) do nothing;

-- The reminder ladder (all off until the owner turns them on).
insert into public.reminder_rules (min_overdue_days, template_key, repeat_every_days) values
  (7, 'reminder', 7),
  (30, 'reminder', 7),
  (60, 'reminder_firm', 7)
on conflict do nothing;

create or replace function private.wa_number(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p ~ '^[6-9][0-9]{9}$' then '91' || p
    when p ~ '^91[6-9][0-9]{9}$' then p
    else null
  end
$$;

-- Queue the receipt message when a receipt is recorded.
create or replace function private.wa_queue_receipt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.customers;
  v_to text;
begin
  select * into c from public.customers where id = new.customer_id;
  v_to := private.wa_number(c.whatsapp);
  if v_to is null or c.wa_opt_out
     or not exists (select 1 from public.wa_templates t where t.key = 'receipt' and t.active and t.deleted_at is null) then
    return new;
  end if;
  insert into public.wa_messages (firm_id, customer_id, template_key, to_number, data, related_table, related_id, dedupe_key)
  values (new.firm_id, new.customer_id, 'receipt', v_to,
          jsonb_build_object('customer_name', c.name,
                             'firm_name', (select name from public.firms where id = new.firm_id),
                             'amount', new.amount, 'mode', new.mode, 'date', new.collected_on,
                             'receipt_no', new.receipt_no, 'token', new.public_token),
          'receipts', new.id, 'receipt:' || new.id)
  on conflict (dedupe_key) do nothing;
  return new;
end;
$$;
create trigger wa_queue_receipt after insert on public.receipts
  for each row execute function private.wa_queue_receipt();

-- Daily: close promises whose date has passed (kept / partly kept / broken),
-- against receipts recorded from the promise until the end of its date.
create or replace function public.close_due_promises()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if auth.uid() is not null and not private.is_owner() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.promises p
     set status = case when x.paid >= p.amount then 'kept' when x.paid > 0 then 'partly_kept' else 'broken' end
    from (
      select pr.id,
             coalesce((select sum(r.amount) from public.receipts r
                        where r.customer_id = pr.customer_id and r.firm_id = pr.firm_id and r.deleted_at is null
                          and r.status not in ('cancelled', 'bounced')
                          and r.collected_at >= pr.created_at
                          and r.collected_on <= pr.promise_date), 0) as paid
        from public.promises pr
       where pr.status = 'open' and pr.deleted_at is null and pr.promise_date < private.today_ist()
    ) x
   where p.id = x.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Daily: queue overdue reminders from the active ladder, and promise-day
-- reminders. Skips opted-out and bad-debt/ignore customers, customers with an
-- open promise still ahead, and anyone who paid in the last 7 days.
create or replace function public.wa_queue_reminders()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := private.today_ist();
  n_rem int := 0;
  n_pro int := 0;
begin
  if auth.uid() is not null and not private.is_owner() then
    raise exception 'Not allowed' using errcode = 'insufficient_privilege';
  end if;

  with dues as (
    select b.firm_id, b.customer_id, b.balance,
           coalesce(sum(x.pending) filter (where x.bill_date is null or x.bill_date + coalesce(a.credit_days, 0) < v_today), 0) as overdue,
           max(case when x.bill_date is null then 999 else v_today - x.bill_date - coalesce(a.credit_days, 0) end) as worst_days
      from tally.mv_ar_balances b
      join public.customer_firm_accounts a on a.customer_id = b.customer_id and a.firm_id = b.firm_id and a.deleted_at is null
      join tally.mv_ar_bills x on x.firm_id = b.firm_id and x.nm = b.nm
     where b.customer_id is not null and b.balance > 0
     group by b.firm_id, b.customer_id, b.balance
  ),
  picked as (
    select d.*, r.template_key, r.repeat_every_days, r.min_overdue_days,
           row_number() over (partition by d.firm_id, d.customer_id order by r.min_overdue_days desc) as rn
      from dues d
      join public.reminder_rules r on r.active and r.deleted_at is null and d.worst_days >= r.min_overdue_days
      join public.wa_templates t on t.key = r.template_key and t.active and t.deleted_at is null
     where d.overdue > 0
  ),
  ins as (
    insert into public.wa_messages (firm_id, customer_id, template_key, to_number, data, related_table, related_id, dedupe_key)
    select p.firm_id, p.customer_id, p.template_key, private.wa_number(c.whatsapp),
           jsonb_build_object('customer_name', c.name, 'firm_name', f.name, 'outstanding', p.balance,
                              'overdue', p.overdue, 'days', p.min_overdue_days),
           'reminder_rules', null,
           'reminder:' || p.firm_id || ':' || p.customer_id || ':' || v_today
      from picked p
      join public.customers c on c.id = p.customer_id
      join public.firms f on f.id = p.firm_id
     where p.rn = 1
       and c.deleted_at is null and c.status = 'active' and not c.wa_opt_out
       and private.wa_number(c.whatsapp) is not null
       and not exists (select 1 from public.wa_messages m
                        where m.customer_id = p.customer_id and m.firm_id = p.firm_id
                          and m.template_key in ('reminder', 'reminder_firm') and m.status in ('queued', 'sent')
                          and m.created_at > now() - make_interval(days => p.repeat_every_days))
       and not exists (select 1 from public.promises pr
                        where pr.customer_id = p.customer_id and pr.firm_id = p.firm_id and pr.status = 'open'
                          and pr.promise_date >= v_today and pr.deleted_at is null)
       and not exists (select 1 from public.receipts r
                        where r.customer_id = p.customer_id and r.firm_id = p.firm_id and r.deleted_at is null
                          and r.status not in ('cancelled', 'bounced') and r.collected_on > v_today - 7)
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into n_rem from ins;

  with ins as (
    insert into public.wa_messages (firm_id, customer_id, template_key, to_number, data, related_table, related_id, dedupe_key)
    select pr.firm_id, pr.customer_id, 'promise_due', private.wa_number(c.whatsapp),
           jsonb_build_object('customer_name', c.name, 'promise_date', pr.promise_date, 'amount', pr.amount, 'firm_name', f.name),
           'promises', pr.id, 'promise:' || pr.id
      from public.promises pr
      join public.customers c on c.id = pr.customer_id
      join public.firms f on f.id = pr.firm_id
      join public.wa_templates t on t.key = 'promise_due' and t.active
     where pr.status = 'open' and pr.deleted_at is null and pr.promise_date = v_today
       and c.deleted_at is null and not c.wa_opt_out and private.wa_number(c.whatsapp) is not null
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*) into n_pro from ins;

  return jsonb_build_object('reminders', n_rem, 'promises', n_pro);
end;
$$;

-- The sender (server, service role) records each attempt.
create or replace function public.wa_mark(p_id uuid, p_status text, p_wati_id text default null, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.wa_messages
     set status = p_status, wati_message_id = coalesce(p_wati_id, wati_message_id), error = p_error,
         attempts = attempts + 1, sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id
$$;

-- Office: put a failed message back in the queue.
create or replace function public.wa_retry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_office_user() then raise exception 'Not allowed' using errcode = 'insufficient_privilege'; end if;
  update public.wa_messages set status = 'queued', error = null
   where id = p_id and status in ('failed', 'skipped') and (firm_id is null or firm_id = any(private.my_firm_ids()));
  if not found then raise exception 'Only a failed message can be retried' using errcode = 'check_violation'; end if;
end;
$$;

-- Public receipt page (no login): only through the receipt's random token.
create or replace function public.receipt_by_token(p_token uuid)
returns table (
  receipt_no text, collected_on date, amount numeric, mode text, cheque_no text, cheque_date date, cheque_bank text,
  upi_ref text, status text, customer_name text, firm_name text, firm_address text, firm_gstin text, collector_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.receipt_no, r.collected_on, r.amount, r.mode, r.cheque_no, r.cheque_date, r.cheque_bank, r.upi_ref, r.status,
         c.name, f.name, f.address, f.gstin, u.full_name
    from public.receipts r
    join public.customers c on c.id = r.customer_id
    join public.firms f on f.id = r.firm_id
    join public.app_users u on u.id = r.collected_by
   where r.public_token = p_token and r.deleted_at is null
$$;

revoke execute on function public.close_due_promises(), public.wa_queue_reminders(), public.wa_mark(uuid, text, text, text),
  public.wa_retry(uuid), public.receipt_by_token(uuid) from public, anon, authenticated;
grant execute on function public.close_due_promises(), public.wa_queue_reminders(), public.wa_mark(uuid, text, text, text),
  public.receipt_by_token(uuid) to service_role;
grant execute on function public.wa_retry(uuid) to authenticated;
