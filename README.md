# Sniper: personal cold outreach

A personal cold-outreach tool built with Next.js, for **email and WhatsApp**. It reads leads from Google Sheets, sends personalized sequences through up to 25 of your own Gmail inboxes and up to 25 linked WhatsApp numbers at a human pace, and tracks replies, bounces and unsubscribes. Data is stored in Supabase.

## 1. Google Cloud setup (one time)

Open [console.cloud.google.com](https://console.cloud.google.com) and pick the project that owns your OAuth client.

1. **APIs & Services → Library**: enable **Gmail API** and **Google Sheets API**.
2. **APIs & Services → Credentials → your OAuth client (Web application)**. Add these under **Authorized redirect URIs**:
   ```
   http://localhost:3000/api/auth/google/callback
   https://your-domain.com/api/auth/google/callback
   ```
3. **OAuth consent screen**:
   - While the app is in **Testing**, add every Gmail address you will connect as a **Test user** (up to 100).
   - In Testing mode Google expires refresh tokens after **7 days**, so you would have to reconnect your inboxes every week. To avoid that, click **Publish app** (switch it to *In production*). For personal use you don't need verification. You will just see a "Google hasn't verified this app" screen. Click **Advanced → Go to app**.

## 2. Environment variables

Copy `.env.example` to `.env.local` for local use; on Vercel, add the same variables in the project settings.

| Variable | What it is |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Your Google OAuth client |
| `APP_URL` | `http://localhost:3000` locally, `https://your-domain.com` in production |
| `SESSION_SECRET` | Random string, **at least 32 characters**, that signs the login cookie. The app refuses to sign anyone in without it in production. |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys (**secret** key, server only) |
| `APP_USERNAME` | Login username |
| `APP_PASSWORD_HASH` | Hash of your login password. Generate it with `node scripts/hash-password.mjs "your-password"`. The plain password is never stored. |
| `CRON_SECRET` | Long random string that protects `/api/cron/tick` |
| `WHATSAPP_ENABLED` | Optional. Set to `false` to stop `npm run dev` / `npm start` from running WhatsApp (e.g. when a separate worker does it) |
| `WORKER_EMAIL` | Optional. Set to `false` so `npm run worker` handles only WhatsApp |

Generate a random secret with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The database schema is in `supabase/migrations/`.

## 3. Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:3000 and sign in with your username and password. While it runs, it also sends emails and keeps your WhatsApp numbers connected. Close it and sending pauses until you start it again.

## 4. Hosting

There are two parts:

- **The web app** (dashboard, campaigns, login). It runs anywhere, including Vercel.
- **The always-on worker**, started with `npm run worker`. It keeps WhatsApp numbers connected and sends WhatsApp messages, plus email unless `WORKER_EMAIL=false`. WhatsApp needs a live connection, like WhatsApp Web, so the worker must run somewhere that never sleeps:
  - **Railway, Render or a VPS** (recommended, about $5/month): create a service from this repo with start command `npm run worker` and the same environment variables.
  - **Your own PC:** keep `npm run worker` (or `npm run dev`) running.

Only one worker holds the WhatsApp connections at a time, so it's safe if your PC and the server both run.

The simplest setup is one Railway/Render service running `npm run build && npm start` with **no** separate worker: the app does everything itself.

## 5. Deploy the web app on Vercel

1. Import the GitHub repo in Vercel.
2. Add all the environment variables above. Set `APP_URL` to your domain, and use a **new** `SESSION_SECRET` and `CRON_SECRET` for production.
3. Add your domain in Vercel and its redirect URI in Google Cloud (step 1).
4. **Email sending.** If the always-on worker (see Hosting) runs with email on (the default), you're done. Otherwise something must call the email sender once a minute:
   - **Free:** create a job at [cron-job.org](https://cron-job.org) that calls `https://your-domain.com/api/cron/tick` **every minute**, with the request header `Authorization: Bearer <your CRON_SECRET>`.
   - **Vercel Pro:** add a `vercel.json` with `{ "crons": [{ "path": "/api/cron/tick", "schedule": "* * * * *" }] }`. Vercel sends the `CRON_SECRET` automatically. The Hobby plan only allows daily crons, and a per-minute cron there will fail the deploy.

Each run sends at most one email per inbox (respecting gaps, sending windows and daily limits), checks replies every third minute, and writes sheet statuses.

## 6. Workflow

1. **Sign in** with your username and password.
2. **Connect Google Sheets** with the Google account that owns your lead sheets.
3. **Email inboxes → Add Gmail account**: repeat for each inbox (max 25) and tick both Gmail checkboxes on Google's screen. Set each inbox's daily limit and signature.
4. **WhatsApp numbers → Link a number**: on your phone open WhatsApp → **Linked devices → Link a device** and scan the QR code. Repeat for each number (max 25). Your phone stays the main device.
5. **Campaigns → New campaign**: choose **Email** or **WhatsApp**:
   - **Sheet & mapping**: paste the sheet URL, pick the tab, and map Email (or Phone for WhatsApp) / First name / Last name / Company. Every column becomes a variable, e.g. `Post Name` → `{{post_name}}`. For WhatsApp, set a default country code for numbers without one.
   - **Sequence**: write step 1 and your follow-ups. Leave a follow-up subject empty to reply in the same thread.
     - Variables: `{{first_name}}`, with a fallback: `{{first_name|there}}`
     - Spintax: `{Hi|Hey|Hello}` picks one at random per lead
   - **Schedule**: days, hours, timezone, emails per day, and the random gap between emails.
   - **Inboxes**: pick which inboxes send.
   - **Send test**, then **Launch**.

## Production checklist

- [ ] Node.js **20.12 or newer** on the host.
- [ ] All environment variables set. Use a **new** `SESSION_SECRET` and `CRON_SECRET` for production, and change any secret that was ever shared in plain text (Google client secret, Supabase secret key, your password).
- [ ] `APP_URL` is your real `https://` domain, and `https://your-domain.com/api/auth/google/callback` is in Google Cloud's redirect URIs.
- [ ] Google OAuth app **published** (otherwise Gmail logins expire every 7 days).
- [ ] Exactly one always-on process for WhatsApp (`npm run worker` or `npm start`). Email runs from it too, or from cron-job.org calling `/api/cron/tick`.
- [ ] Before a real campaign, send a **test** email and WhatsApp message to yourself.

## Security

- Every page and API route requires sign-in, except the login page, recipients' unsubscribe links, the open-tracking pixel, and the cron endpoint (which needs `CRON_SECRET`).
- The password is checked against a scrypt hash. Sign-in locks for 15 minutes after 10 wrong attempts from one IP, or 50 from anywhere. During an attack that may briefly lock you out too, but nobody can keep guessing.
- Security headers are sent on every page: no framing, HSTS, nosniff, a strict referrer policy.
- Supabase has Row Level Security on with no policies, so the public API exposes nothing. Only the server, using the secret key, can read or write.

## How sending works

- **Even split:** 200 emails/day across 10 inboxes means 20 per inbox. Leads are assigned evenly, and each lead's follow-ups always come from the same inbox, in the same thread.
- **Human pacing:** each inbox sends one email at a time, then waits a random 1–3 minutes (configurable) before its next one. Inboxes work in parallel, so it never sends everything at once.
- **Sending window:** emails only go out on your chosen days and hours.
- **Follow-ups first:** due follow-ups go out before new leads, so sequences stay on schedule.
- **Reply detection:** every 3 minutes each inbox checks its threads. A reply stops the sequence. A reply that says "unsubscribe" / "remove me" adds the person to the global unsubscribe list. Bounces (mailer-daemon) are marked automatically.
- **Safety:** each inbox has a hard rolling-24h cap. If Gmail rate-limits an inbox it pauses that inbox for 30 minutes, and an expired login is flagged on the Email Accounts page with a Reconnect button.

## WhatsApp: how it sends

- **Human pacing:** each number sends one message at a time, with 3–8 minute random gaps by default and 20/day per campaign split across numbers. Each number also has its own daily limit (default 15).
- **Typing indicator:** before each message the number comes online, opens the chat, and shows "typing…" for about as long as a person would take to type it, with a pause on long messages. Then it sends.
- **Number checks:** numbers that aren't on WhatsApp are skipped, marked "Not on WhatsApp" in your sheet, and counted under "Not on WhatsApp".
- **Replies** are recorded the moment they arrive and stop the sequence. "STOP", "unsubscribe", "not interested" and similar replies unsubscribe the person from every campaign.
- **Follow-ups** go to the same chat from the same number after the delay you set.

> **Important:** this links numbers the same way WhatsApp Web does. WhatsApp's terms don't allow automated or bulk messaging, and it bans numbers that send many unsolicited messages. Use established numbers, keep volumes low (10–20 new chats per number per day), personalize every message, and only contact people who'd reasonably expect to hear from you. For high volume, the official WhatsApp Business Platform (Cloud API, which needs opt-in and approved templates) is the compliant route.

## No duplicate cold outreach

Duplicates are blocked by unique keys in the database, so it holds even after a crash, a restart, or two sender runs overlapping:

- **One cold message per person, ever, per channel.** The first time an email address or WhatsApp number gets step 1, it is recorded in the `contacts` table. Any other campaign or inbox that tries to cold-email that address is skipped, and the lead is marked **Already contacted**. This also applies to campaigns you deleted.
- **Each step goes out once.** A step is claimed in the `sends` table *before* Gmail is called. If the step is already claimed, it is never sent again. If Gmail rejects the email, the claim is released so it can be retried.
- **Within one sheet:** repeated rows with the same address are imported once; the extra rows are marked "Skipped · duplicate row".

## Google Sheet status column

After every event the app writes the lead's status into a column of your sheet. The column is called **Outreach Status** by default, is created automatically, and can be renamed or turned off in the campaign's Options tab. Example values:

`Queued` → `Sent · step 1/2 · Oct 2, 14:05 · from you@gmail.com` → `Replied · Oct 3, 09:12` (or `Bounced`, `Unsubscribed`, `Failed · …`, `Skipped · already contacted (Campaign X)`, `Skipped · invalid email`).

Rows are matched by email address, so sorting or inserting rows is safe. This needs edit access to your sheets: if Settings shows "Read-only", click **Reconnect**.

## Open tracking & unsubscribe links

These need a public URL (your domain), because recipients' email clients must be able to reach the app. On localhost they are disabled automatically, and reply-based unsubscribe still works.

## How data is handled

Every page request, sender run and incoming WhatsApp message loads fresh data from Supabase and saves its changes before it finishes. That's why the web app (local or Vercel), the email sender and the WhatsApp worker can all work at the same time. Sender runs load only the leads that are due, which keeps database traffic small. WhatsApp sessions are stored in Supabase too, so the worker can restart or move to another server without a new QR scan.
