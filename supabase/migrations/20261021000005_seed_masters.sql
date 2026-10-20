-- =============================================================================
-- SA ERP · 0005 Seed masters (idempotent)
--   * territories and beats from TallySync tsv2.party_erp_beat (2026-10-21)
--   * route days (D-14): Mehkar Tue, Lonar Thu, D Raja Fri; Jalna = city
--   * brands and SKU groups (brief §1); items come with the import (0.4)
--   * Vikram supplier terms (21 days, 1% within 7 days on GST-incl value)
--   * non-customer parties (D-06)
-- =============================================================================

insert into public.territories (name, sort_order)
select v.name, v.sort_order
  from (values ('Jalna', 1), ('Mehkar', 2), ('D Raja', 3), ('Lonar', 4), ('Counter', 5)) v (name, sort_order)
 where not exists (select 1 from public.territories t where lower(t.name) = lower(v.name) and t.deleted_at is null);

insert into public.beats (territory_id, name, route_kind, route_weekday)
select t.id, v.beat, v.kind, v.weekday
  from (values
    ('Jalna',   'Bazaar Line',                 'city',       null::smallint),
    ('Jalna',   'Chandan Zira',                'city',       null),
    ('Jalna',   'Kadrabad',                    'city',       null),
    ('Jalna',   'ManthaChaufully , Kharpudi',  'city',       null),
    ('Jalna',   'New Mondha',                  'city',       null),
    ('Jalna',   'Nutan Vasahat',               'city',       null),
    ('Jalna',   'Nutan Vasahat 2',             'city',       null),
    ('Jalna',   'Old Mondha and Dana Bazaar',  'city',       null),
    ('Jalna',   'Ramnagar',                    'city',       null),
    ('Jalna',   'RP Road',                     'city',       null),
    ('Jalna',   'Sambhaji Nagar',              'city',       null),
    ('Mehkar',  'Mehkar',                      'outstation', 2),
    ('Mehkar',  'Mehkar Rural',                'outstation', 2),
    ('Mehkar',  'Partapur',                    'outstation', 2),
    ('Mehkar',  'Kalyana',                     'outstation', 2),
    ('Mehkar',  'Fardapur',                    'outstation', 2),
    ('Mehkar',  'Kalambeshwar',                'outstation', 2),
    ('Mehkar',  'Shahpur',                     'outstation', 2),
    ('D Raja',  'D Raja',                      'outstation', 5),
    ('D Raja',  'D Mahi-Andera Mera',          'outstation', 5),
    ('Lonar',   'Lonar',                       'outstation', 4),
    ('Counter', 'Mondha Counter',              'counter',    null)
  ) v (territory, beat, kind, weekday)
  join public.territories t on lower(t.name) = lower(v.territory) and t.deleted_at is null
 where not exists (select 1 from public.beats b where lower(b.name) = lower(v.beat) and b.deleted_at is null);

insert into public.sku_groups (code, name, description)
select v.code, v.name, v.description
  from (values
    ('G1', 'Group 1', 'Vikram Kadak Dust, Lion No. 5, Titli'),
    ('G2', 'Group 2', 'Vikram Elaichi, Gold Mix, Vikram Lion, Masala, Green Tea, Klassic, Rupa')
  ) v (code, name, description)
 where not exists (select 1 from public.sku_groups g where g.code = v.code and g.deleted_at is null);

insert into public.brands (name, category)
select v.name, v.category
  from (values
    ('Vikram Kadak Dust', 'tea'), ('Lion No. 5', 'tea'), ('Titli', 'tea'),
    ('Vikram Elaichi', 'tea'), ('Vikram Gold Mix', 'tea'), ('Vikram Gold', 'tea'), ('Vikram Lion', 'tea'),
    ('Vikram Masala', 'tea'), ('Vikram Klassic', 'tea'), ('Green Tea', 'tea'), ('Rupa', 'tea'),
    ('New Sagar', 'tea'), ('Janta Dust', 'tea'),
    ('Vinayak', 'oil'), ('Vilina', 'oil'), ('Thakurji', 'oil'), ('Ruturaj', 'oil'),
    ('Priya', 'other'), ('Zola', 'other')
  ) v (name, category)
 where not exists (select 1 from public.brands b where lower(b.name) = lower(v.name) and b.deleted_at is null);

insert into public.suppliers (name, kind)
select 'Vikram Tea', 'tea'
 where not exists (select 1 from public.suppliers s where lower(s.name) = 'vikram tea' and s.deleted_at is null);

insert into public.supplier_firm_accounts (supplier_id, firm_id, credit_days, cash_discount_pct, cash_discount_days, discount_base)
select s.id, f.id, 21, 1.00, 7, 'gross_incl_gst'
  from public.suppliers s
  join public.firms f on f.code = 'SA'
 where lower(s.name) = 'vikram tea' and s.deleted_at is null
   and not exists (select 1 from public.supplier_firm_accounts a where a.supplier_id = s.id and a.firm_id = f.id and a.deleted_at is null);

insert into public.non_customer_parties (firm_id, tally_ledger_name, reason)
select f.id, v.ledger, v.reason
  from (values
    ('AA', 'Sushil Agencies',              'Inter-firm transaction (Anjali → Sushil), D-06'),
    ('AA', 'SUSHIL AGENCIES (NEW MONDHA)', 'Inter-firm transaction, D-06'),
    ('SA', 'Phone Pay Sales',              'Payment mode, not a customer')
  ) v (firm, ledger, reason)
  join public.firms f on f.code = v.firm
 where not exists (
   select 1 from public.non_customer_parties n
    where n.firm_id = f.id and lower(n.tally_ledger_name) = lower(v.ledger) and n.deleted_at is null
 );
