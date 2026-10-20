-- =============================================================================
-- SA ERP · 0002 Seed: firms, godowns, FY 25-26 and 26-27 journey cycles,
-- permissions, default role → permission matrix, settings.
-- Idempotent: safe to re-run.
-- =============================================================================

insert into public.firms (code, name, gst_registered, invoice_prefix, address)
values
  ('SA', 'Sushil Agencies', true,  'SA', 'Jalna, Maharashtra'),
  ('AA', 'Anjali Agency',   false, 'AA', 'Jalna, Maharashtra')
on conflict (code) do nothing;

insert into public.godowns (name, is_counter, address)
values
  ('City Office', false, 'Jalna'),
  ('New Mondha',  true,  'New Mondha, Jalna')
on conflict (name) do nothing;

select public.generate_journey_cycles(2025);
select public.generate_journey_cycles(2026);

insert into public.permissions (key, category, description)
values
  ('users.manage',        'Admin',       'Create users, set roles, firms and beats, reset PINs'),
  ('settings.manage',     'Admin',       'Change app settings'),
  ('audit.view',          'Admin',       'View the audit log'),
  ('masters.manage',      'Masters',     'Edit customers, items, beats, suppliers, vehicles'),
  ('credit.manage',       'Masters',     'Set customer credit limits and credit days'),
  ('approvals.decide',    'Approvals',   'Approve or reject items in the approval queue'),
  ('order.approve',       'Approvals',   'Approve orders that fail the credit check'),
  ('discount.approve',    'Approvals',   'Approve discounts outside the price list'),
  ('return.approve',      'Approvals',   'Approve customer returns'),
  ('receipt.record',      'Collections', 'Record cash, UPI and cheque receipts and promises'),
  ('receipt.cancel',      'Collections', 'Cancel a receipt'),
  ('receipt.reallocate',  'Collections', 'Change which bills a receipt settles'),
  ('handover.count',      'Collections', 'Count and accept collectors'' cash handovers'),
  ('deposit.record',      'Collections', 'Record bank deposits'),
  ('cheque.manage',       'Collections', 'Mark cheques deposited, cleared or bounced'),
  ('order.create',        'Orders',      'Create orders'),
  ('dispatch.manage',     'Dispatch',    'Plan dispatches, assign vehicles, loading'),
  ('delivery.record',     'Dispatch',    'Mark deliveries with proof of delivery'),
  ('stock.manage',        'Stock',       'GRN, transfers, daily stock count'),
  ('purchase.manage',     'Purchase',    'Purchase orders and supplier bills'),
  ('reports.view_all',    'Reports',     'View reports across all beats')
on conflict (key) do nothing;

insert into public.role_permissions (role, permission_key)
select v.role::public.app_role, v.permission_key
  from (values
    ('sales_admin', 'approvals.decide'),
    ('sales_admin', 'order.approve'),
    ('sales_admin', 'discount.approve'),
    ('sales_admin', 'return.approve'),
    ('sales_admin', 'masters.manage'),
    ('sales_admin', 'order.create'),
    ('sales_admin', 'reports.view_all'),
    ('accounts',    'masters.manage'),
    ('accounts',    'receipt.record'),
    ('accounts',    'receipt.cancel'),
    ('accounts',    'receipt.reallocate'),
    ('accounts',    'handover.count'),
    ('accounts',    'deposit.record'),
    ('accounts',    'cheque.manage'),
    ('accounts',    'order.create'),
    ('accounts',    'reports.view_all'),
    ('stores',      'stock.manage'),
    ('dispatch',    'dispatch.manage'),
    ('driver',      'delivery.record'),
    ('driver',      'receipt.record'),
    ('salesman',    'order.create'),
    ('collector',   'receipt.record')
  ) as v (role, permission_key)
 where not exists (
   select 1 from public.role_permissions rp
    where rp.role = v.role::public.app_role
      and rp.permission_key = v.permission_key
      and rp.deleted_at is null
 );

insert into public.app_settings (key, value, description)
values
  ('cheque_bounce_charge',  '500'::jsonb, 'Fixed charge (₹) added to the customer on a bounced cheque (D-12)'),
  ('credit_grace_days',     '0'::jsonb,   'Days allowed beyond credit days before an order needs approval (D-09)'),
  ('pin_max_attempts',      '5'::jsonb,   'Wrong PIN attempts before a field login is locked'),
  ('pin_lock_minutes',      '15'::jsonb,  'Minutes a field login stays locked'),
  ('field_session_days',    '30'::jsonb,  'Days a field phone stays signed in')
on conflict (key) do nothing;
