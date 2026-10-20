# SA ERP — Decision Log

Newest decisions are added at the bottom. Each entry gives the date, the decision, and who decided it.

| ID | Date | Decision | By |
|---|---|---|---|
| D-01 | 2026-10-20 | The ERP is a **new repo `sa-erp`** with a **new Supabase project** in Mumbai (`ap-south-1`) on the Pro plan. `rupyz-tally-erp`, `tally-data`, `mondha-pos` and the other existing projects are read-only import sources. | Owner |
| D-02 | 2026-10-20 | **Tally stays the book of accounts** for both firms. The ERP is the operations layer. | Owner |
| D-03 | 2026-10-20 | Phase 1: accounts key ERP receipts into Tally by hand, and a match screen links each one to its Tally voucher. ERP outstanding = Tally outstanding − unmatched ERP receipts. The Tally XML push stays in "Later". | Owner |
| D-04 | 2026-10-20 | Sushil e-invoices and e-way bills are made **in Tally** today and will continue to be. Sushil tax invoices stay in Tally, and the ERP links them back to orders. The ERP issues Anjali bills. `mondha-pos` stays as it is until Phase 2. | Owner |
| D-05 | 2026-10-20 | `tsv2` holds both firms. The ERP pulls from `tsv2` on a schedule using a read-only key. Claude may run read-only queries on the existing projects. | Owner |
| D-06 | 2026-10-20 | Inter-firm parties ("Sushil Agencies" in Anjali, "SUSHIL AGENCIES (NEW MONDHA)") are **inter-firm transactions**. They are kept in a non-customer list and left out of sales, receivables and targets. | Owner |
| D-07 | 2026-10-20 | JC1 starts on 1 April every year. Each JC is 28 days, and JC13 takes the remaining days up to 31 March (29 days, or 30 in a leap FY). | Owner |
| D-08 | 2026-10-20 | Credit limit and credit days are set **per customer per firm**. Customer status (active / bad debt / ignore) is set **per customer**. | Owner |
| D-09 | 2026-10-20 | Grace days default to 0 and can be changed in settings. Mondha counter cash sales skip the credit check. | Owner |
| D-10 | 2026-10-20 | *Proposed, needs approval:* transactional tables carry a non-null `firm_id`. Shared masters (customers, items, beats, godowns, vehicles, staff) link to firms through per-firm child tables instead. | Pending |
| D-11 | 2026-10-20 | A new role, **`sales_admin`**, can approve orders, discounts and credit when the owner is away. Approval from a WhatsApp link on the owner's phone is allowed. The limit is still to be set (Q-2). | Owner |
| D-12 | 2026-10-20 | Receipts settle the **oldest bills first** automatically. A cheque bounce charge is a **fixed ₹500**. | Owner |
| D-13 | 2026-10-20 | Vikram invoices show only the invoice number, date, items and rates, with no batch or manufacturing date. The return age check uses the date of our sale invoice to that customer. The return age limit will be set in Phase 3. | Owner |
| D-14 | 2026-10-20 | Outstation route days: **Mehkar territory on Tuesday, Lonar on Thursday, D Raja on Friday**. Jalna city deliveries go the same or next day. Beat lists come from Rupyz plus the overrides. Each field person has their own phone. GPS is recorded at the moment of an action. Item master comes from Tally stock items. Claude drafts the Marathi WATi templates and the owner approves them. | Owner |
| D-15 | 2026-10-20 | Accepted assumptions: cash collected by drivers on delivery goes through the same per-person handover. One login can hold several roles. PIN lockout after 5 wrong tries. Oil is sold by both firms, and the daily oil rate is shared across firms. History import covers FY 25-26 and FY 26-27. | Owner |

## Open questions

| ID | Question |
|---|---|
| Q-1 | Supabase project **"Sushil Agencies ERP"** (`lmiypuhauntjqcilsuwi`, 1,024 customers, 45 items, 24 beats) already exists. Should I ignore it, import from it, or reuse it as the new ERP project? |
| Q-2 | Who is the **sales admin**: one named person or several? What limit should apply, for example the most they can approve above a credit limit, and can they approve for bad-debt customers? |
| Q-3 | None of the Sushil sales vouchers in `tsv2` has an IRN. Is e-invoicing active in Tally, and should TallySync start capturing IRN? |
| Q-4 | `tsv2` has no Anjali purchase vouchers. How does Anjali buy stock? Phase 3 payables depends on this. |
| Q-5 | Which Jalna-territory beats are outstation, and which weekday does each one run? Right now they're treated as city routes (same or next day). |
| Q-6 | Is the ₹500 bounce charge in Sushil billed with GST as a debit note, or without GST? |

## Later decisions

| ID | Date | Decision | By |
|---|---|---|---|
| D-16 | 2026-10-20 | `docs/ARCHITECTURE.md` approved. Building starts with Phase 0, slice 0.1. | Owner |
| D-17 | 2026-10-20 | Soft-deleted rows are visible only to people who may edit that table, so they can restore them. Everyone else never sees them. Hard delete is blocked by a database trigger, even for admin connections. | Claude (convention) |
| D-18 | 2026-10-20 | The audit log never stores PIN hashes. The changed field name is still recorded. | Claude (convention) |
| D-19 | 2026-10-20 | ~~The sales admin is the accounts staff.~~ **Withdrawn the same day:** the owner corrected it, and the sales admin is *not* accounts. Who the sales admin is remains open (Q-2). | Owner |
| D-20 | 2026-10-20 | The sales admin is **a new person**. The owner adds their login with the `sales_admin` role once they join. | Owner |
| D-21 | 2026-10-20 | The sales admin's approval limits are decided later. Until then they have **no rupee cap**, but nobody except the owner can approve for **bad-debt** customers. The owner sets limits on the Approval limits screen. | Owner |
| D-22 | 2026-10-20 | **Field login design:**<br>• Each PIN user has a hidden Supabase login whose password is derived from the server secret `FIELD_AUTH_SECRET`, so it is never stored.<br>• The PIN is bcrypt-hashed and checked in the database.<br>• Easy PINs (1234, 0000…) are refused.<br>• The PIN login screen lists the names of active field staff, so a person can tap their name instead of typing it. | Claude (convention) |
| D-23 | 2026-10-20 | **Approval queue rules:**<br>• Every approval kind (credit, discount, return, order, scheme) goes through one queue.<br>• Requests are raised and decided only through database functions.<br>• Nobody except the owner can decide their own request.<br>• Rejecting is always allowed. Approving checks the person's permission, their firm access and their rupee cap.<br>• Delegations can be limited to dates (e.g. while the owner is away). | Claude (convention) |
| D-24 | 2026-10-20 | The code lives in its own repo, **`yashsharma1544-cyber/sa-erp`** (moved from a temporary folder in `rupyz-tally-erp`). The database is the Supabase project **`sa-erp`** (ref `lkyevpdxhayuyvvnypmi`, Mumbai), created by the owner. Migrations 0001–0003 were applied by Claude. | Owner |
| D-25 | 2026-10-20 | The owner's email is set up as the owner account. The account becomes active on the first sign-in with that email. | Owner |
| D-26 | 2026-10-20 | Supabase's security check flags the `security definer` approval/PIN/audit functions and the audit log table having no read rules. Both are deliberate: each function checks permissions inside, and the audit log is read only through `audit_log()`. | Claude (convention) |
| D-27 | 2026-10-21 | Production runs on Vercel project `sa-erp` at **https://sa-erp-blond.vercel.app**. Next.js was upgraded to 15.5.28 because Vercel blocks 15.5.4 (CVE-2025-66478). `npm audit` for production dependencies is clean. | Claude |
| D-28 | 2026-10-21 | **Beats seeded from TallySync** (`party_erp_beat`): 22 beats in 4 territories (Jalna 11, Mehkar 7, D Raja 2, Lonar 1) plus a "Mondha Counter" beat. **Shahpur** is in Mehkar territory, although the brief's list didn't include it. Route days: Mehkar beats Tuesday, Lonar Thursday, D Raja beats Friday. Jalna beats are set as city routes until Q-5 is answered. | Claude (from data) |
| D-29 | 2026-10-21 | **SKU group** (Group 1 / Group 2) is set on each item and can be changed on the Items screen. The audit log keeps the history of changes. | Claude (convention) |
| D-30 | 2026-10-21 | **Credit limit and credit days** can only be changed with `credit.manage`. By default only the owner has it, and the owner can delegate it on the Approval limits screen. Marking a customer **bad debt / ignore** is owner-only. Both rules are enforced in the database. | Claude (convention, per brief §3) |
| D-31 | 2026-10-21 | **Field visibility:** salesmen, collectors and drivers see only customers in the beats assigned to them on the Users screen (sales beats and collection beats are separate). Office roles see all customers. | Claude (per brief §2) |
