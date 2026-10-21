# SA ERP — Runbook

## Local checks (what every slice must pass)

```powershell
npm ci
npm run typecheck
npm run lint
npm test            # unit tests (formatting, JC calendar)
```

`npm run test:db` applies every migration to a throwaway Postgres and runs `tests/db/*_test.sql`. It needs Postgres 15+ on Linux or Mac (Claude runs it on every slice). It's optional on Windows.

## First-time setup

Done so far: steps 1–3 (Supabase project `lkyevpdxhayuyvvnypmi`, migrations 0001–0003, owner bootstrap) and step 5 (Vercel: https://sa-erp-blond.vercel.app). Remaining: step 4 (Auth URLs) and your first sign-in.

1. **Supabase project.** Create a new project in region Mumbai (`ap-south-1`).
2. **Migrations.** In Supabase → SQL Editor, run each file in `supabase/migrations/` **in filename order**. Run one file at a time and wait for "Success" before starting the next.
3. **Owner login.**
   1. Supabase → Authentication → Users → *Add user* → enter your email and a password, and tick *Auto confirm*.
   2. In the SQL Editor, run:
      ```sql
      select private.bootstrap_owner('your-email@example.com', 'Your Name');
      ```
4. **Auth URLs.** Supabase → Authentication → URL Configuration:
   - Site URL = your Vercel URL.
   - Add `https://<your-vercel-url>/auth/callback` to the Redirect URLs.
5. **Vercel.**
   - Import the GitHub repo.
   - Add these environment variables (Production and Preview):
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `SUPABASE_SERVICE_ROLE_KEY`
     - `FIELD_AUTH_SECRET`: a random string of 32 or more characters. To generate one in PowerShell:
       `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))`

## Import from Tally (one-time)

The masters were imported on 2026-10-21 from TallySync (`tsv2`, read-only).
To finish it, open **Admin → Import from Tally**:

1. Pick **Anjali Agency**, tab **To match**.
2. For each ledger: **Link** (to the suggested customer), **Other…** (search
   and pick a customer), **New** (it's a different shop), **Not a customer**
   (cash/bank/office ledgers) or **Skip**.
3. When the rest are all different shops, use **Create all as new**.
4. Any decision can be undone from its tab.

Then open **Customers** and give a beat to customers that have none.

## Connect TallySync (one-time)

The ERP keeps a read-only copy of TallySync (D-37). The `erp_reader` role
already exists in **tally-data**. It can only read 6 tsv2 tables and can't
log in until it has a password. Pick a long password (letters and digits, no
quotes) and use it in both steps. Never put it in Git or a chat.

1. Supabase → **tally-data** → SQL Editor:

   ```sql
   alter role erp_reader with login password 'YOUR-LONG-PASSWORD';
   ```

2. Supabase → **sa-erp** → SQL Editor (the first sync copies everything and
   takes a minute or two):

   ```sql
   select tally.connect_source('db.zrdvmgxnmcqnxvlitonz.supabase.co', 5432, 'postgres', 'erp_reader', 'YOUR-LONG-PASSWORD');
   select tally.run_sync();
   ```

   The result should say `"status": "ok"`. If it says the server can't be
   reached, open tally-data → **Connect** → **Session pooler**, and run
   `connect_source` again with that host, and with user
   `erp_reader.zrdvmgxnmcqnxvlitonz`.

3. Turn on the schedule (sa-erp → SQL Editor). It runs every 10 minutes from
   06:30 to 22:20 IST, plus a full re-check at 03:00 IST:

   ```sql
   create extension if not exists pg_cron;
   select cron.schedule('tally-sync', '*/10 1-16 * * *', 'select tally.run_sync(false)');
   select cron.schedule('tally-sync-full', '30 21 * * *', 'select tally.run_sync(true)');
   ```

   To stop it: `select cron.unschedule('tally-sync'); select cron.unschedule('tally-sync-full');`

The status and a **Sync now** button are on **Setup → Firms & settings**.

## Connect WhatsApp orders (one-time)

The ERP reads the salesmen's WhatsApp orders from the **Whatsapp Orders**
project through a read-only role (D-63). It can read 4 tables only, never the
WhatsApp login (`wa_auth`). Pick a long password (letters and digits, no
quotes); you need it in steps 1 and 2. Never put it in Git or a chat.

1. Supabase → **Whatsapp Orders** → SQL Editor:

   ```sql
   create role erp_reader login password 'YOUR-LONG-PASSWORD';
   grant usage on schema public to erp_reader;
   grant select on public.wa_groups, public.wa_salesmen, public.wa_messages, public.wa_order_lines to erp_reader;
   create policy erp_reader_read on public.wa_groups      for select to erp_reader using (true);
   create policy erp_reader_read on public.wa_salesmen    for select to erp_reader using (true);
   create policy erp_reader_read on public.wa_messages    for select to erp_reader using (true);
   create policy erp_reader_read on public.wa_order_lines for select to erp_reader using (true);
   ```

2. Supabase → **sa-erp** → SQL Editor:

   ```sql
   select wa.connect_source('db.derzrxlrudyfkqtzwktg.supabase.co', 5432, 'postgres', 'erp_reader', 'YOUR-LONG-PASSWORD');
   select wa.run_sync('manual');
   ```

   The result should say `"status": "ok"` with how many orders came in and
   how many were placed. If the server can't be reached, open Whatsapp Orders
   → **Connect** → **Session pooler**, and run `connect_source` again with that
   host, and with user `erp_reader.derzrxlrudyfkqtzwktg`.

3. Turn on the schedule (sa-erp → SQL Editor). It runs every 5 minutes from
   06:30 to 23:00 IST:

   ```sql
   select cron.schedule('wa-orders-sync', '*/5 1-17 * * *', 'select wa.run_sync()');
   ```

   To stop it: `select cron.unschedule('wa-orders-sync');`

## WhatsApp orders (daily)

- **Sales → WhatsApp orders** lists what came in over the last 7 days. The
  menu badge counts the orders waiting for a check.
- Orders with everything known are placed by themselves. They show the ERP
  order number and go through credit check and approvals as usual.
- **To check** shows each order's problems:
  - Customer not linked: tap the right shop from the closest names. The link is
    remembered, so the next order from that shop comes in on its own.
  - Line unclear, unit not understood, or kg not a whole number of packets:
    **Fix**, pick the item and the quantity in its billing unit, **Save**.
  - Item has no rate: add the rate on **Price list**, then **Sync now** or
    **Place order**.
- **Not an order** (with a reason) for enquiries and duplicates.
- **Sync now** pulls new messages straight away.

## Collector app (field)

1. On **Admin → Users**, open the collector and tick their **collection
   beats**. Sales beats don't count for collection.
2. Set their PIN and tell them to open the site on their phone, log in with
   the PIN, then tap **वसुली**. In Chrome use ⋮ → *Add to Home screen*.
3. Open it once with network at the start of the day. After that it works
   without network, and entries are sent when the network is back.
4. The pending count on top shows anything not yet sent. Entries the office
   should look at show in red with the reason.

## Cash handover and deposits

1. **Once:** on **Setup → Firms & settings → Bank accounts**, add the account
   each firm deposits cash into.
2. **Evening:** the collector opens **रोख जमा करा** on the phone, counts their
   notes and taps **हँडओव्हर करा**. Or accounts presses **Take handover** on
   **Collections → Cash & deposits** while the collector is there.
3. Accounts presses **Count**, types the notes, and accepts. A difference needs
   a note and stays on that collector's record.
4. **Deposit:** on the **Deposit** tab pick the firm, tick the counted cash
   going in, choose the bank, enter the slip number and amount, and record it.

## Cheques

**Collections → Cheques**, per firm:
- **In hand:** tick the cheques going to the bank (post-dated ones can't be
  ticked until their date), then **Deposit**.
- **Deposited:** mark **Cleared** when the bank credits it, or **Bounced** with
  the bank's reason. A bounce alerts the owner and books the ₹500 charge.
- **Bounced:** once the debit note is made in Tally, press **Charge…** and
  enter its number. Only the owner can waive a charge.

## Tally match

**Collections → Tally match** shows ERP receipts that aren't in Tally yet.
Most match by themselves after each sync. For the rest, press **Find in
Tally** and pick the right voucher. Anything waiting more than 2 days still
needs to be keyed into Tally.

## WhatsApp (WATi)

1. **Vercel → sa-erp → Settings → Environment Variables** (Production), then
   redeploy:
   - `WATI_API_ENDPOINT`: from WATi → API Docs, e.g.
     `https://live-mt-server.wati.io/123456`
   - `WATI_API_TOKEN`: the access token from the same page
   - `CRON_SECRET`: any long random text (the daily 9 am job needs it)
2. In **WATi → Template Messages**, create the four templates (Marathi,
   Utility). Copy each text exactly from **Collections → WhatsApp →
   Templates & reminders**, including the `{{1}}`… placeholders. The receipt
   one ends with the receipt link.
3. Once WhatsApp approves a template, type its WATi name on that screen, tick
   **Approved** and **Switched on**, and save. Start with the receipt.
4. Keep the **reminder ladder** off until credit days are set on **Masters → Credit terms**.
5. Turn off WhatsApp for a customer with the checkbox under WhatsApp on their
   customer page.

## Credit terms and the credit check

1. Open **Masters → Credit terms** and pick the firm (Sushil / Anjali).
2. Choose **Terms not set**, narrow by territory or beat, tick the header box
   to select all shown, type the limit and/or days, and press **Set for
   selected**. Leave a box blank to keep what each customer already has.
3. A 0 limit or 0 days means that rule isn't checked yet (D-51).
4. Grace days: **Firms & settings → credit_grace_days** (default 0).
5. To try a figure for one customer, open the customer page and use
   **Credit check** under the firm account.


## Owner dashboard (Home)

- The top cards show collected today, collected this JC, to collect, and
  promises due today. The firm buttons switch between both firms, Sushil only
  and Anjali only.
- **By collector:** money taken in the field app, per person, plus cash still
  in their hand. "Office / Tally" is money entered straight in Tally.
  "Overdue in their beats" needs collection beats on **Admin → Users**.
- **By territory / By beat:** where the money came from and where it is still
  owed. The worst overdue is listed first.
- A Tally receipt shows up once TallySync has sent it (every 10 minutes from
  06:30 to 22:30).

## Price list

- **Masters → Price list**, pick the firm, type the new rate (before GST, per
  Tally unit) and press **Save**. It applies from today. Oil rates change
  daily, so update them each morning before orders come in.
- "from Tally" means the rate came from the last Tally bill when the price
  list was first made.
- Items without a rate can still be ordered, but the order taker must type a
  rate.

## Orders

- **Sales → Orders → New order**: pick the firm and customer, tap items from
  "Usually buys" or search for them, and enter quantities in the Tally unit.
  The right-hand box shows the total, the GST and the credit check as you
  type.
- **Paste WhatsApp order** (on Orders): paste the whole message and press
  **Read message**. Each line becomes an order line. Lines marked **check**
  or **Not matched** need you to pick the right item; the quoted text under
  each line is what the message said. The shop name in the message is
  searched as the customer. Whatever you fix is remembered for next time.
- A failed credit check or a rate below the list sends the order to
  **Approvals**. Once every request is approved, the order is approved.
- To cancel, open the order → **Cancel order**, with a reason. This is only
  possible until loading starts.

## Adding a new financial year

Each March, open **JC calendar** → **+ Generate FY xx-yy** (owner only). The SQL alternative is `select public.generate_journey_cycles(2027);`.

## Adding staff

The six field staff from TallySync are already in (D-36). For each one, on
**Admin → Users** press **Set up login**, then set their PIN and tell them.

Open **Users** → **+ Add user**.
- **Field staff** (salesman, collector, driver) get **Field (name + PIN)**. Choose a 4-digit PIN. Easy PINs like 1234 and 0000 are refused.
- **Office staff** and the **sales admin** get **Office (email)**. An invite email is sent to them.
- After 5 wrong PIN tries, a field login is locked for 15 minutes. **Reset PIN** sets a new PIN and clears the lock straight away.

## Approval limits

The **Approval limits** screen is owner only.
- Add a row to cap the sales admin, for example: Sales admin · Approve orders that fail the credit check · ₹50,000.
- Add a row with dates to give someone an approval power only while you're away.
- Bad-debt customers can only ever be approved by the owner.
