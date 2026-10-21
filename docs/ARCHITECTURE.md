# SA ERP — Architecture

Status: **DRAFT for owner approval** · Written 2026-10-20 · Decisions referenced as D-nn live in `DECISIONS.md`.

---

## 1. What the ERP is (and isn't)

```
                ┌──────────── Tally Prime (books of account, statutory) ───────────┐
                │  Sushil Agencies 25-26 / 26-27      Anjali Agency 25-26 / 26-27  │
                └───────────────┬──────────────────────────────────▲───────────────┘
                     XML :9000  │ (LAN only)                        │ XML import (later, D-03)
                ┌───────────────▼──────────────┐                    │
                │ TallySync V2 (desktop exe)   │────────────────────┘
                └───────────────┬──────────────┘
                                │ writes
                ┌───────────────▼──────────────┐  read-only pull   ┌──────────────────────┐
                │ tally-data  (zrdv…) tsv2.*   │──────────────────▶│  SA ERP (new project) │
                └──────────────────────────────┘   every 10 min    │  Postgres + Auth +    │
                                                                   │  Storage + Edge Fns   │
   rupyz-tally-erp (aiek…) ──── one-time import ─────────────────▶ │                       │
   mondha-pos (yvalb…)      ──── later (Phase 2) ────────────────▶ └──────────┬───────────┘
                                                                              │
                         ┌─────────────────────┬──────────────────────────────┼─────────────┐
                         ▼                     ▼                              ▼             ▼
                 Office web (EN)       Field PWA (मराठी/EN)            WATi (Marathi)   Owner cockpit
```

- **Tally stays the book of accounts** for both firms (D-02). The ERP is the operations layer.
- **Inbound** (Tally → ERP): Tally is only reachable on the office LAN, so Vercel can't call port 9000. TallySync V2 keeps doing the Tally work. The ERP pulls from `tsv2` on a schedule using a read-only database role (D-05).
- **Outbound** (ERP → Tally):
  - Phase 1: accounts key ERP receipts into Tally. A match screen ties each ERP receipt to the Tally receipt voucher once it syncs back (D-03).
  - Later: an XML push agent, either built into TallySync V2 or as a small local service on the LAN.
- **Sushil tax invoices**, including e-invoice/IRN and e-way bills, keep being made in Tally (D-04). In Phase 2 the ERP prepares the order and dispatch, the Tally invoice syncs back, and it gets linked to the order.
- **Anjali bills** are issued by the ERP (D-04). Until the XML push exists, accounts key them into Tally. That is the first push to build, early in Phase 2.

## 2. Findings in your existing data that shaped this design

I read `tally-data` / `tsv2` read-only on 2026-10-20.

| Finding | Effect on design |
|---|---|
| `tsv2.companies` has 4 Tally companies: Sushil and Anjali × FY 25-26 and 26-27. | The import maps *(Tally company name)* → *(firm_id, fiscal_year)*. A new FY company each April just becomes another mapping row. |
| ~85,000 vouchers, including Sushil purchase/payment/credit-note/debit-note vouchers. Anjali has sales, receipts and a few credit notes, but **no purchase vouchers are synced**. | Phase 3 payables for Anjali need its purchase vouchers synced. Open question Q-4. |
| None of the Sushil sales vouchers in `tsv2` has an `irn` value. | Either TallySync doesn't capture IRN yet, or e-invoicing isn't active. Open question Q-3. |
| `tsv2.non_customer_parties` lists "Sushil Agencies" (inter-company Anjali → Sushil), "SUSHIL AGENCIES (NEW MONDHA)" (inter-branch) and "Phone Pay Sales" (payment mode). There are 152 such vouchers in Anjali. | Implemented as a `non_customer_parties` exclusion list. These parties never become customers and are left out of sales, receivables and targets (D-06). |
| `tsv2.party_erp_beat` has 22 beats in 4 areas plus a "Counter" area (Mondha): Jalna 11, Mehkar 7, D Raja 2, Lonar 1. | This is the seed for beats/territories. "Counter" becomes a special beat for Mondha walk-ins. |
| The **sa-collections** and **target-confirmation** apps already live in `tsv2`: `ca_payments`, `ca_promises`, `cash_handovers` (with denominations), `cash_deposits`, `ca_customer_flags` (15 bad-debt, 4 ignore), `ca_contacts`/`tc_customer_contacts` (WhatsApp numbers), `tc_salesmen`/`tc_collectors` (PIN logins), and `tc_slabs`/`tc_confirmations` (scheme with e-signatures). | Masters, flags, contacts and logins were imported in Phase 0. Payments, promises and handovers were not: they hold no real data, so collections start fresh in the ERP (D-57). The new design keeps their proven ideas: denomination counting and PIN logins. |
| The target scheme config has `group2_multiplier = 5` (Group 2 kg counts 5× in "weighted kg") and a `group2_floor_kg`. | The Phase 4 scheme engine keeps rules **as configuration**, not code. I'll confirm the 95/5 split vs the weighted-kg rule with you before Phase 4. |
| A Supabase project **"Sushil Agencies ERP"** (`lmiypuhauntjqcilsuwi`) already exists, with 1,024 customers, 45 items and 24 beats. | Open question Q-1: is this an earlier attempt to ignore, or a source to import from? |

## 3. Conventions that apply everywhere

- **Money** uses `numeric(14,2)`, **weight** uses `numeric(12,3)` kg, and **quantity** uses `numeric(12,3)` units. No floats anywhere: in TypeScript, money travels as strings and is computed with `decimal.js`.
- **Time**: everything is stored as `timestamptz` (UTC). *Business dates* are `date` in IST, for example `bill_date`, `collected_on` and `route_date`. Display uses `Asia/Kolkata`.
- **Display**: `formatINR()` gives `₹12,34,567.00` and `formatKg()` gives `1,23,456.000 kg`. There is no lakh/crore/K shorthand anywhere, including in exports.
- **Standard columns** on every table: `id uuid pk default gen_random_uuid()`, `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at`, `deleted_by`.
- **Soft delete only**: the `authenticated` role has no `DELETE` grant. RLS hides rows with `deleted_at is not null`. "Delete" in the UI is an RPC that stamps `deleted_at`.
- **Audit**: a generic trigger, `audit.log_change()`, is attached to every table. It writes `(table, row_id, action, old jsonb, new jsonb, changed_by, changed_at)` to `audit.change_log`, which is append-only, has no UPDATE/DELETE grants, and is readable by the owner.
- **`firm_id`**: every *transactional* table carries a non-null `firm_id`. These include receipts, bills, orders, invoices, stock movements, purchase bills, targets per firm and messages.
  - *Shared masters* have no single firm: customers, items, beats, godowns, vehicles and staff. They link to firms through per-firm child tables, for example `customer_firm_accounts`. This is my reading of "every business table carries firm_id" (D-10). Please confirm.
- **Idempotent writes from the field**: every field write carries a client-generated `client_op_id uuid unique`, so replaying the offline queue never creates duplicates.

## 4. Data model

The schemas are:
- `public`: app tables, exposed to the API.
- `tally`: the read-only mirror of `tsv2`, not exposed.
- `audit`: the change log.
- `private`: helper functions.

The "Ph" column in the tables below says which phase creates each table.

### 4.1 Foundation (Phase 0)

| Table | Key columns | Notes |
|---|---|---|
| `firms` | code (`SA`/`AA`), name, gst_registered, gstin, address, invoice_prefix | 2 rows |
| `fiscal_years` | label `26-27`, start_date, end_date | |
| `journey_cycles` | fiscal_year_id, jc_number 1–13, start_date, end_date, days | **Generated** by `generate_journey_cycles(fy)`: JC1 starts 1 April and each JC is 28 days. JC13 runs to 31 March, so it has 29 days, or 30 in a leap FY (D-07). |
| `tally_companies` | tally_name, firm_id, fiscal_year_id | Maps the 4 (later more) Tally companies |
| `godowns` | name (City Office, New Mondha), is_counter | Shared by both firms |
| `app_users` | auth_user_id, full_name, login_kind (`email`/`pin`), phone, whatsapp, pin_hash, pin_failed_count, locked_until, locale (`mr`/`en`), active | One row per person |
| `user_roles` | user_id, role | Roles: `owner`, `sales_admin`, `accounts`, `stores`, `dispatch`, `driver`, `salesman`, `collector`. A person can have several roles, e.g. salesman + collector. |
| `user_firms` | user_id, firm_id | Which firms an office user may see. Field users inherit visibility from their beats. |
| `user_beats` | user_id, beat_id, purpose (`sales`/`collection`) | Field visibility |
| `permissions` | key, description | e.g. `order.approve`, `credit.override`, `discount.approve`, `receipt.cancel`, `return.approve` |
| `role_permissions` | role, permission_key | The permissions matrix, editable by the owner |
| `approval_delegations` | delegate_user_id, permission_key, max_amount, valid_from, valid_to, active | Delegated approval (D-11) |
| `approval_requests` | firm_id, kind, subject_table, subject_id, amount, reason, requested_by, status, decided_by, decided_at, decision_note | The single approval queue for every approval kind |
| `app_settings` | key, value jsonb | e.g. bounce charge ₹500, grace days, reminder ladder |

### 4.2 Masters (Phase 0)

| Table | Key columns | Notes |
|---|---|---|
| `territories` | name | Lonar, D Raja, Mehkar, Jalna (editable) |
| `beats` | territory_id, name, route_kind (`city`/`outstation`/`counter`), route_weekday (0–6, null for city), active | Mehkar beats run Tue, Lonar Thu, D Raja Fri. Jalna outstation weekdays are still to come (Q-5). |
| `brands` | name | Vikram Kadak Dust, Lion, Titli… |
| `sku_groups` | name, code | Group 1, Group 2 |
| `sku_group_members` | sku_group_id, item_id \| brand_id, valid_from, valid_to | Editable, with history |
| `items` | name, brand_id, category (`tea`/`oil`/`other`), unit (pc/pkt/jar/tin), units_per_case, pack_size_g, kg_per_unit numeric(12,3), hsn, gst_rate (Sushil), mrp, active | |
| `item_aliases` | item_id, source (`tally`/`rupyz`/`mondha`), alias_name | Many Tally item names map to one item |
| `customers` | name, display_name_mr, customer_type (kirana/retailer/wholesaler/hotel/counter), beat_id, whatsapp, phone, gstin, address, lat, lng, status (`active`/`bad_debt`/`ignore`), status_note | One record per real customer |
| `customer_firm_accounts` | customer_id, **firm_id**, tally_ledger_name, credit_limit numeric(14,2), credit_days int, opening_balance, active | Balances are per firm and never combined (D-08) |
| `party_matches` | firm_id, tally_ledger_name, customer_id, match_method (`auto_exact`/`auto_fuzzy`/`manual`), confidence, confirmed_by | Feeds the matching screen |
| `non_customer_parties` | firm_id, tally_ledger_name, reason | Inter-firm and other non-customer parties, excluded from all sales and receivables numbers (D-06) |
| `suppliers` | name, kind (`tea`/`oil`/`other`), whatsapp, gstin | |
| `supplier_firm_accounts` | supplier_id, firm_id, tally_ledger_name, credit_days (Vikram 21, oil 15), cash_discount_pct (1.00), cash_discount_days (7), discount_base (`gross_incl_gst`) | |
| `vehicles` | reg_no, ownership (`own`/`borrowed_vikram`), capacity_kg, active | |
| `bank_accounts` | firm_id, bank, account_no_last4, ledger_name | Deposit targets |

### 4.3 Tally mirror (Phase 0/1, `tally` schema, read-only for the app)

| Table | Source | Notes |
|---|---|---|
| `tally.vouchers`, `tally.voucher_lines`, `tally.voucher_allocations` | `tsv2.*` | Pulled incrementally by `updated_at`, keeping `is_voided` |
| `tally.outstandings` | `tsv2.outstandings` | Bill-wise pending as of the last sync, matching Tally to the paisa |
| `tally.ledger_balances` | `tsv2.ledger_balances` | Supplier payables, cross-checks |
| `tally.sync_log` | — | Last pulled `updated_at` per source table, row counts, errors |

The ERP derives firm-scoped views from the mirror and joins them to `customer_firm_accounts`:
- `v_customer_bills`: open bills.
- `v_customer_ledger`: ledger lines.
- `v_sales_lines`: sales in kg and ₹ by item, date, JC and beat.

### 4.4 Receivables and collections (Phase 1)

| Table | Key columns | Notes |
|---|---|---|
| `receipts` | **firm_id**, customer_id, receipt_no (per firm and FY), collected_on, collected_by, mode (`cash`/`upi`/`cheque`/`bank`), amount, upi_ref, cheque_no, cheque_date, cheque_bank, cheque_photo_path, lat, lng, status, tally_voucher_id, client_op_id | Statuses: `recorded` → `handed_over` → `counted` → `deposited`/`cleared` → `tally_matched`; or `cancelled`/`bounced` |
| `receipt_allocations` | receipt_id, bill_ref, bill_date, amount | Allocated **oldest bill first, automatically** (D-12). Accounts can re-allocate, and every change is audited. |
| `promises` | firm_id, customer_id, promise_date, amount, made_to, status (`open`/`kept`/`partly_kept`/`broken`), client_op_id | Auto-closed against receipts |
| `collection_visits` | user_id, customer_id, visited_at, outcome (`paid`/`promised`/`not_available`/`refused`/`closed`), note, lat, lng | Feeds staff discipline (Phase 5) |
| `customer_notes` | customer_id, firm_id null, note, by | |
| `cash_handovers` | collector_id, handed_on, expected_cash (sum of that person's cash receipts), counted (n500, n200, n100, n50, n20, n10, coins), counted_total, variance = counted − expected, counted_by, status (`submitted`/`counted`/`accepted`), deposit_id | **Counted and reconciled per person before pooling** |
| `cash_handover_receipts` | handover_id, receipt_id | The exact receipts in this handover |
| `deposits` | firm_id, bank_account_id, deposited_on, slip_no, slip_photo_path, amount, expected_amount, variance | Pools accepted handovers. Cash is pooled across collectors, but each deposit belongs to one firm's bank account. |
| `cheques` | receipt_id, status (`in_hand`/`deposited`/`cleared`/`bounced`/`returned`), deposited_on, cleared_on, bounced_on, bounce_reason | |
| `cheque_bounces` | cheque_id, firm_id, charge_amount (₹500 from settings), reversal_status, debit_note_ref | A bounce reverses the receipt allocation, raises the charge as a pending Tally debit note, and alerts the owner |
| `wa_templates` | key, language `mr`, wati_template_name, params, approved | |
| `wa_messages` | firm_id, customer_id, template_key, params, related_table/id, status, wati_message_id, error | The send log |
| `reminder_rules` | min_overdue_days, template_key, repeat_every_days, active | The reminder ladder |

**Calculations**

These are SQL views/functions so the dashboard and exports agree.

- **Outstanding per bill** = Tally bill pending − ERP receipts allocated to that bill but not yet matched to a Tally voucher (D-03).
- **Ageing buckets** by bill date: 0–15, 16–30, 31–45, 46–60, 60+. **Overdue** = bill date + credit days < today.
- **DSO** = latest outstanding ÷ credit sales in the period × days in the period. Available for a JC, a month or any date range.
- **Working totals** exclude customers whose status is `bad_debt` or `ignore`. Those customers are shown in a separate section.
- **Credit check** `credit_check(firm, customer, order_amount)`: fails if
  - outstanding + order value > credit limit, **or**
  - the oldest unpaid bill is older than credit days + grace days.

  Grace days defaults to 0 and is set in app settings. Mondha counter cash sales skip the check (D-09). A failed check creates an `approval_requests` row instead of letting the order be billed.

### 4.5 Orders, dispatch and delivery (Phase 2)

| Table | Key columns |
|---|---|
| `orders` | firm_id, customer_id, source (`salesman`/`office`/`whatsapp_paste`/`counter`/`rupyz`), salesman_id, order_date, status (`draft`/`pending_approval`/`approved`/`loading`/`invoiced`/`dispatched`/`delivered`/`closed`/`cancelled`), credit_check jsonb, client_op_id |
| `order_lines` | order_id, item_id, qty_units, qty_kg, rate, discount, qty_invoiced, qty_open (generated) |
| `order_events` | order_id, from_status, to_status, by, at |
| `dispatches` | route_date, vehicle_id, driver_id, helpers, status, loaded_at, departed_at, returned_at |
| `dispatch_orders` | dispatch_id, order_id, sequence |
| `number_series` | firm_id, fiscal_year_id, doc_type, prefix, next_no — uses gap-free row locking |
| `invoices` | **firm_id**, invoice_no, invoice_date, customer_id, order_id, dispatch_id, kind (`tax_invoice`/`bill_of_supply`), taxable, cgst, sgst, igst, round_off, total, source (`erp`/`tally`), tally_voucher_id |
| `invoice_lines` | invoice_id, item_id, qty_units, qty_kg, rate, taxable, gst_rate, tax |
| `deliveries` | invoice_id, status (`delivered`/`partial`/`returned`), pod_photo_path, signature_path, cod_amount, receipt_id, lat, lng, at |

### 4.6 Purchase, stock, returns and payables (Phase 3)

| Table | Key columns |
|---|---|
| `purchase_orders` / `po_lines` | firm_id, supplier_id, po_date, status, wa_message_text; item, suggested_qty, ordered_qty, kg |
| `grns` / `grn_lines` | firm_id, po_id, godown_id, supplier_invoice_no, received_on; item, qty, kg, batch (nullable), mfg_date (nullable) |
| `stock_moves` | **firm_id**, godown_id, item_id, qty_units (±), qty_kg (±), move_type (`grn`/`sale`/`transfer_out`/`transfer_in`/`return_in`/`count_adjust`), source_table, source_id, moved_at — an append-only ledger. Stock on hand is a view. |
| `stock_transfers` | from_godown, to_godown, lines, status |
| `stock_counts` / `stock_count_lines` | godown_id, counted_on, counted_by; item, system_qty, counted_qty, variance, reason |
| `stock_cover_settings` | item_id, max_days_cover |
| `returns` / `return_lines` | firm_id, customer_id, reason, original_invoice_id, status (`requested`/`approved`/`rejected`), approval_request_id; item, qty, invoice_date, age_days, check_result |
| `supplier_bills` | firm_id, supplier_id, bill_no, bill_date, amount_incl_gst, due_date, cd_eligible_until, cd_amount, cd_credit_note_status (`not_due`/`expected`/`received`/`missed`), paid_on, tally_voucher_id |

Vikram invoices carry no batch or manufacturing date (D-13). The returns check therefore uses the **age since our sale invoice to that customer**, plus the item's shelf life if we record it. Batch fields stay nullable.

### 4.7 Targets and schemes (Phase 4)

| Table | Key columns |
|---|---|
| `primary_targets` | jc_id, firm_id null (null = combined commitment), sku_group_id/item_id, target_kg |
| `secondary_targets` | jc_id, level (`territory`/`beat`/`customer`), ref_id, sku_group_id, target_kg, method (`sales_share`/`manual`) |
| `schemes`, `scheme_rules` (jsonb, versioned), `scheme_slabs`, `scheme_enrolments` (customer, slab, signature_path, status, approval_request_id), `coupon_rules`, `coupon_awards` | Imported from the `tsv2.tc_*` and `scheme_*` tables |

### 4.8 Owner cockpit and discipline (Phase 5)

`oil_rates` (rate_date, item_id, rate, set_by), `staff_tasks` (user_id, task_date, kind, expected, actual, status), and `v_owner_cockpit` (one view feeding the daily screen).

## 5. Roles, permissions and RLS

**Logins**
- Office and owner users sign in with Supabase email login (magic link + password).
- Field users sign in with **name + 4-digit PIN**:
  1. The login screen lists active field users. The app downloads the list once and caches it.
  2. A server route checks the bcrypt PIN hash. It locks the account for 15 minutes after 5 wrong tries.
  3. It then signs in that person's hidden Supabase Auth user, using a random server-side password, and returns a normal session.

  The session lasts 30 days on the device, so a person doesn't need signal every morning. The owner can reset any PIN.

**Helper functions** (in `private`, `security definer`, `stable`):
- `me()`: the current `app_users.id`.
- `has_role(role)`, `has_perm(key)`: delegation-aware.
- `my_firms()`.
- `my_beats()`.
- `can_see_customer(customer_id)`.

**Policies by role**

| Role | Can read | Can write |
|---|---|---|
| owner | everything | everything; approves |
| sales_admin | everything in their firms | approvals up to the delegated limits (D-11), orders, customers |
| accounts | everything in their firms | receipts (cancel, re-allocate), handover counting, deposits, cheques, Tally match, invoices |
| stores | stock, items, GRN, counts, transfers, returns (inspect) | the same |
| dispatch | approved orders, dispatches, invoices for loading | dispatch, loading status |
| driver | own dispatches and their invoices and customers | deliveries, POD, COD receipts |
| salesman | customers in own beats (`user_beats` purpose `sales`), their bills, items, history | orders, visits, notes |
| collector | customers in own collection beats, their bills | receipts, promises, visits, handovers (own) |

Rules that apply on top of the table:
- RLS is enabled on **every** table. There is no `DELETE` grant anywhere.
- Money-changing actions go through `security definer` RPCs. These validate the change, write the audit row and apply the approval rules: cancel receipt, re-allocate, bounce, approve order, count handover and post deposit.
- Field users can **insert** their own receipts and promises but never edit them after sync. Corrections are made by accounts and are audited.

## 6. Field PWA and offline

- Built with Next.js App Router, Serwist service worker and Dexie (IndexedDB).
- **Read cache:** at login and each morning, the app downloads the user's day list: customers, open bills, promises due, items and price lists. A typical beat is about 300 KB.
- **Write outbox:** every action is stored locally first, with a `client_op_id`. It syncs through `/api/field/sync` when the phone is online, with retry and backoff. Photos upload separately and get attached later.
- The UI clearly shows "N entries waiting to sync". Receipts get a **provisional receipt number** on the device (`<user>-<seq>`). The final firm number is assigned on sync, and the WhatsApp receipt is sent only after sync, by the server.
- Marathi is the default for field users, with an English toggle. Text lives in `messages/mr.json` and `messages/en.json`. Customer WhatsApp texts use "टार्गेट", not "लक्ष्य".
- The app is built for cheap phones: no heavy charts on field screens, the JS bundle stays under 200 KB, and images are compressed on the device before upload.

## 7. Integrations

| Integration | How |
|---|---|
| **tsv2 pull** | A Vercel cron (every 10 minutes from 07:00 to 22:00 IST) calls `/api/sync/tally`. It reads `tsv2` through a dedicated read-only Postgres role (`erp_reader`, `SELECT` only on `tsv2`) and upserts into the `tally.*` mirror. The mirror is idempotent and keyed on tsv2 ids, and the pull never writes to `tally-data`. You create `erp_reader` with SQL I'll give you, and nothing runs until you approve it. |
| **WATi** | A server-side client with the token in Vercel env. Uses Marathi templates only, and every send is logged in `wa_messages`. Receipt PDFs are rendered with `@react-pdf/renderer`, stored in Supabase Storage, and linked by a signed URL. |
| **Rupyz** | Not synced (D-55). |
| **Whatsapp Orders** (`derzrxlrudyfkqtzwktg`) | Read-only `erp_reader` via postgres_fdw: groups, salesmen, messages, order lines → `wa_orders` every 5 minutes (D-63). |
| **mondha-pos** | Phase 2: either its sales are pulled into the ERP, or Mondha billing moves into the ERP counter screen. To be decided with you then. |
| **Tally push** | Later: XML import of Anjali bills, receipts and credit notes through a LAN agent. Each push is logged and checked by reading the voucher back through TallySync. |

## 8. Folder structure (repo `sa-erp`)

```
sa-erp/
├─ app/
│  ├─ (auth)/login, pin-login
│  ├─ (office)/                 # English, desktop-first
│  │  ├─ cockpit/               # owner daily screen
│  │  ├─ receivables/ collections/ handovers/ deposits/ cheques/
│  │  ├─ approvals/
│  │  ├─ masters/ customers/ items/ beats/ suppliers/ vehicles/ users/
│  │  ├─ import/ matching/
│  │  ├─ orders/ dispatch/ invoices/        (Ph 2)
│  │  ├─ purchase/ stock/ returns/ payables/ (Ph 3)
│  │  └─ targets/ schemes/                   (Ph 4)
│  ├─ (field)/f/                # Marathi PWA, mobile-first
│  │  ├─ today/ customer/[id]/ receipt/ promise/ handover/
│  │  ├─ order/ (Ph 2)  delivery/ (Ph 2)
│  └─ api/  sync/tally  field/sync  wati/webhook  cron/*  export/*
├─ components/  ui/  office/  field/
├─ lib/
│  ├─ supabase/ (server, client, admin)
│  ├─ format.ts (INR, kg, IST)   jc.ts   money.ts (decimal.js)
│  ├─ offline/ (dexie db, outbox, sync)
│  ├─ wati/   pdf/   export/ (xlsx, pdf)
│  └─ i18n/
├─ messages/ mr.json en.json
├─ supabase/
│  ├─ migrations/  0001_foundation.sql, 0002_audit.sql, …
│  ├─ functions/   (edge functions if needed)
│  └─ seed/        (non-secret seed: firms, roles, permissions)
├─ tests/  unit (vitest) · db (pgTAP-style SQL tests) · e2e (playwright, later)
└─ docs/  ARCHITECTURE.md  DECISIONS.md  RUNBOOK.md
```

Stack: Next.js 15 (App Router), React 19, TypeScript strict, Tailwind, shadcn/ui, Supabase JS v2, Zod, decimal.js, Dexie, Serwist, ExcelJS, @react-pdf/renderer, and Vitest.

## 9. Phase plan and definition of done

Every slice must:
- pass migrations, typecheck, lint and tests;
- be committed;
- be deployable to Vercel preview;
- come with a short "what you can do now / what you must do by hand / next" note.

### Phase 0 — Foundation

| Slice | Contents |
|---|---|
| 0.1 | Repo scaffold, Supabase project, Vercel. Firms, fiscal years, JC generator, users/roles/permissions, email login, audit trigger, soft-delete pattern |
| 0.2 | Field PIN login, delegation table, approval queue skeleton |
| 0.3 | Masters CRUD: territories, beats (with weekday), brands, SKU groups, items (+aliases), customers (+firm accounts), suppliers, vehicles, bank accounts |
| 0.4 | Tally mirror pull (read-only role) and import of masters from tsv2 and rupyz-tally-erp: parties, beats, items, flags, WhatsApp numbers, field users |
| 0.5 | Party matching screen: auto exact/fuzzy matches, then manual confirmation of the rest |

**Done when:**
- you can log in by email, and a field user can log in by PIN on a phone;
- the 13 JCs for FY 26-27 exist and are correct;
- every Tally party with a balance is matched to a customer or marked non-customer;
- every edit appears in the audit log;
- nothing can be hard-deleted.

### Phase 1 — Receivables and collections

| Slice | Contents |
|---|---|
| 1.1 | Receivables screen: bill-wise per firm, ageing, overdue, DSO by JC/month/range, bad-debt/ignore section, Excel/PDF export. Numbers tie to Tally/Biz Analyst. |
| 1.2 | Collector PWA: day list by beat sorted by overdue, record cash/UPI/cheque (photo), promises, visit outcome, works offline |
| 1.3 | Cash handover per collector with denominations, per-person short/excess, then deposit slip with variance |
| 1.4 | Cheque lifecycle, bounce (reversal + ₹500 charge + owner alert), Tally match screen for ERP receipts |
| 1.5 | WATi: Marathi receipt with PDF, reminder ladder, promise reminders (templates approved by you) |
| 1.6 | Credit limits/days per customer per firm, `credit_check()`, approval queue for orders that fail it (orders come from the ERP itself, D-55) |
| 1.7 | Owner dashboard: collected today/JC, to collect, by collector/beat/territory, promises due today |
| 1.8 | Dropped (D-57): sa-collections holds no real data, so collections start fresh in the ERP |

**Done when:**
- for a sample of 20 customers, ERP outstanding equals Tally outstanding to the paisa, after adjusting for unmatched ERP receipts;
- each collector's cash is reconciled before pooling, so a shortage names a person;
- a receipt reaches the customer on WhatsApp in Marathi within 2 minutes of syncing;
- the collector app works with mobile data off, and syncs without duplicates when back online.

### Phase 2 — Orders → dispatch → delivery

The salesman order app has history and kg. Office entry and WhatsApp paste parsing create draft orders, and Mondha counter orders come in as well. Then:
- approval with the credit check;
- partial fulfilment;
- dispatch planning by route day (city same/next day, outstation weekday);
- vehicle and driver assignment, loading sheet;
- Tally bills of both firms linked back to orders (D-73);
- driver app with POD and COD;
- status board;
- Tally XML push of Anjali bills.

| Slice | Contents |
|---|---|
| 2.1 | Price list per firm (from Tally rates), orders with credit check and discount approval, office order entry and list |
| 2.2 | WhatsApp paste → order lines to check (no salesman app: orders come from Rupyz and WhatsApp, D-62) |
| 2.3 | Orders from the salesmen's WhatsApp groups (owner's Whatsapp Orders project) synced every 5 minutes, placed automatically or checked on WhatsApp orders (D-63…D-66) |
| 2.3b | Mondha counter orders |
| 2.4 | Dispatch planning by route day, vehicle/driver, loading sheet (D-71, D-72); oil out of the ERP (D-70) |
| 2.5 | Tally bills of both firms linked back to orders, invoiced status (D-73, D-74); ERP billing of Anjali left for 2.7 if wanted |
| 2.6 | Driver app: proof of delivery, cash on delivery |
| 2.7 | Status board; Tally XML push of Anjali bills |
| later | Rupyz order intake, if still needed (D-62) |

**Done when** one full day of orders runs through the ERP end to end, both firms are invoiced correctly, and Rupyz order capture is retired.

### Phase 3 — Purchase, stock and returns

- PO suggestions, WhatsApp PO text, GRN into a godown;
- stock ledger per godown in units and kg, transfers, daily count with variance reasons;
- days-of-cover and overstock alerts, primary vs secondary by JC/SKU;
- returns with reason, age check and approval → credit note in the right firm;
- payables with due dates, and the Vikram 1% within-7-days alert and credit-note tracking.

**Done when** the stores manager's daily count is done in the app, system stock is within the agreed tolerance, and every Vikram bill shows its discount deadline.

### Phase 4 — Targets and schemes

- Primary targets and pacing;
- secondary cascade territory → beat → customer by sales share (a salesman's target = the full target of their beats, while org totals count each customer once);
- customer target scheme with slabs, the G1/G2 split, rewards, e-signature, approval and Marathi welcome;
- configurable coupon engine (1 coupon at 60 kg, 3 per full 100 kg, +1 if the remainder is ≥ 60 kg);
- drill-down company → territory → beat → customer → salesman.

**Done when** the target-confirmation app and Sales Monitor targets are retired, with their data imported.

### Phase 5 — Owner cockpit and staff discipline

- A single daily cockpit;
- the daily oil rate list with WhatsApp share;
- staff activity: visits, collection list hit-rate, dispatch on time, late/missed per person;
- Excel/PDF export on every report.

**Done when** the cockpit is the one screen you open each morning.

## 10. Risks and how they're handled

- **Double counting receipts** between ERP and Tally: handled by the Tally match state on every receipt and an "unmatched > 2 days" alert.
- **Tally sync gaps**, i.e. TallySync not running: the cockpit shows the last sync time in red when it is more than 2 hours old.
- **Bad connectivity**: offline outbox, idempotent sync and provisional receipt numbers.
- **WATi template approval delay**: messages are queued and sent once a template is approved, and the rest of the receipt flow doesn't wait for it.
- **Data protection**: customer phone numbers and GSTINs are visible only to roles that need them, the service-role key is used only on the server, and Storage buckets are private with signed URLs.
