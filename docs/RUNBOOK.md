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

## Collector app (field)

1. On **Admin → Users**, open the collector and tick their **collection
   beats**. Sales beats don't count for collection.
2. Set their PIN and tell them to open the site on their phone, log in with
   the PIN, then tap **वसुली**. In Chrome use ⋮ → *Add to Home screen*.
3. Open it once with network at the start of the day. After that it works
   without network, and entries are sent when the network is back.
4. The pending count on top shows anything not yet sent. Entries the office
   should look at show in red with the reason.

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
