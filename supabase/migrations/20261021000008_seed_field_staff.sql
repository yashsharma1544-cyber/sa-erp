-- =============================================================================
-- SA ERP · 0008 Seed field staff from TallySync (tsv2.tc_salesmen,
-- tc_salesman_beats, tc_collectors) as of 2026-10-21. Idempotent.
--   * Names, phones and beats only. No PINs: the owner sets each PIN on the
--     Users screen ("Set up login", then "Set PIN").
--   * "Radhe" (salesman) and "Radhe Suram" (collector) are taken to be one
--     person with both roles (D-36).
--   * Test logins "Yash" and "Trial" are not copied.
--   * Field app in Marathi; access to both firms.
-- =============================================================================

with staff (full_name, whatsapp, roles) as (
  values
    ('Akshay',          '9860748060', array['salesman']),
    ('Ganesh Ankamwar', '7385000101', array['salesman']),
    ('Gopal Chintal',   '9175260955', array['salesman']),
    ('Rajesh Dhoke',    '9049033432', array['salesman']),
    ('Radhe Suram',     null,         array['salesman', 'collector']),
    ('Sahil Tiwari',    null,         array['collector'])
)
insert into public.app_users (full_name, login_kind, phone, whatsapp, locale)
select s.full_name, 'pin', s.whatsapp, s.whatsapp, 'mr'
  from staff s
 where not exists (select 1 from public.app_users u
                    where lower(u.full_name) = lower(s.full_name) and u.deleted_at is null);

insert into public.user_roles (user_id, role)
select u.id, r.role::public.app_role
  from (values
    ('Akshay', 'salesman'), ('Ganesh Ankamwar', 'salesman'), ('Gopal Chintal', 'salesman'),
    ('Rajesh Dhoke', 'salesman'), ('Radhe Suram', 'salesman'), ('Radhe Suram', 'collector'),
    ('Sahil Tiwari', 'collector')
  ) r (full_name, role)
  join public.app_users u on lower(u.full_name) = lower(r.full_name) and u.deleted_at is null
 where not exists (select 1 from public.user_roles x
                    where x.user_id = u.id and x.role = r.role::public.app_role and x.deleted_at is null);

insert into public.user_firms (user_id, firm_id)
select u.id, f.id
  from public.app_users u
  cross join public.firms f
 where lower(u.full_name) in ('akshay', 'ganesh ankamwar', 'gopal chintal', 'rajesh dhoke', 'radhe suram', 'sahil tiwari')
   and u.deleted_at is null and f.deleted_at is null
   and not exists (select 1 from public.user_firms x where x.user_id = u.id and x.firm_id = f.id and x.deleted_at is null);

-- Sales beats as set in TallySync ("No beat" dropped). Akshay and Radhe had
-- every beat there.
insert into public.user_beats (user_id, beat_id, purpose)
select u.id, b.id, 'sales'
  from (values
    ('Akshay', '*'), ('Radhe Suram', '*'),
    ('Ganesh Ankamwar', 'D Mahi-Andera Mera'), ('Ganesh Ankamwar', 'D Raja'), ('Ganesh Ankamwar', 'Lonar'),
    ('Ganesh Ankamwar', 'Mehkar'), ('Ganesh Ankamwar', 'Mehkar Rural'), ('Ganesh Ankamwar', 'New Mondha'),
    ('Gopal Chintal', 'Bazaar Line'), ('Gopal Chintal', 'Chandan Zira'), ('Gopal Chintal', 'Kadrabad'),
    ('Gopal Chintal', 'ManthaChaufully , Kharpudi'), ('Gopal Chintal', 'Ramnagar'), ('Gopal Chintal', 'RP Road'),
    ('Gopal Chintal', 'Sambhaji Nagar'),
    ('Rajesh Dhoke', 'D Mahi-Andera Mera'), ('Rajesh Dhoke', 'D Raja'), ('Rajesh Dhoke', 'Nutan Vasahat'),
    ('Rajesh Dhoke', 'Nutan Vasahat 2'), ('Rajesh Dhoke', 'Old Mondha and Dana Bazaar')
  ) v (full_name, beat)
  join public.app_users u on lower(u.full_name) = lower(v.full_name) and u.deleted_at is null
  join public.beats b on (v.beat = '*' and b.route_kind <> 'counter' or lower(b.name) = lower(v.beat)) and b.deleted_at is null
 where not exists (select 1 from public.user_beats x
                    where x.user_id = u.id and x.beat_id = b.id and x.purpose = 'sales' and x.deleted_at is null);
