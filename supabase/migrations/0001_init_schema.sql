-- Applied to Supabase project "sniper-outreach" (tdyrsekoicnmiytyulzn).

-- Workspace owner (Google account that owns the lead sheets). Single row.
create table public.owner (
  id text primary key default 'owner' check (id = 'owner'),
  email text not null,
  name text not null default '',
  picture text,
  tokens jsonb not null default '{}'::jsonb,
  connected_at timestamptz not null default now()
);

-- Connected Gmail sending inboxes (max 25, enforced in the app).
create table public.accounts (
  id text primary key,
  email text not null unique,
  name text not null default '',
  picture text,
  tokens jsonb not null default '{}'::jsonb,
  status text not null default 'active' check (status in ('active','paused','error')),
  error text,
  daily_limit int not null default 30,
  signature text not null default '',
  next_send_at bigint not null default 0,
  connected_at timestamptz not null default now()
);

create table public.campaigns (
  id text primary key,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','completed')),
  sheet jsonb,
  mapping jsonb,
  steps jsonb not null default '[]'::jsonb,
  schedule jsonb not null,
  daily_limit int not null default 50,
  account_ids text[] not null default '{}',
  stop_on_reply boolean not null default true,
  track_opens boolean not null default false,
  unsubscribe_footer boolean not null default true,
  unsubscribe_text text not null default '',
  sheet_status boolean not null default true,
  sheet_status_column text not null default 'Outreach Status',
  created_at timestamptz not null default now(),
  launched_at timestamptz,
  last_synced_at timestamptz
);

create table public.leads (
  id text primary key,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  email text not null,
  data jsonb not null default '{}'::jsonb,
  account_id text not null,
  status text not null check (status in ('pending','in_progress','completed','replied','bounced','unsubscribed','failed','duplicate')),
  step_index int not null default 0,
  next_at bigint not null default 0,
  thread_id text,
  first_message_id text,
  first_subject text,
  last_sent_at bigint,
  replied_at bigint,
  opened_at bigint,
  last_checked_at bigint,
  error text,
  token text not null unique,
  unique (campaign_id, email)
);
create index leads_campaign_status_idx on public.leads (campaign_id, status);
create index leads_email_idx on public.leads (email);

create table public.events (
  id text primary key,
  type text not null check (type in ('sent','reply','open','bounce','unsubscribe','error','duplicate')),
  at bigint not null,
  campaign_id text,
  account_id text,
  lead_id text,
  email text,
  step int,
  detail text
);
create index events_at_idx on public.events (at);
create index events_campaign_idx on public.events (campaign_id, at);

create table public.unsubscribes (
  email text primary key,
  at bigint not null,
  source text not null
);

-- Duplicate protection #1: every address that has ever received a cold (step 1) email.
-- The unique key makes it impossible for two campaigns/inboxes to cold-email the same person.
create table public.contacts (
  email text primary key,
  lead_id text not null,
  campaign_id text not null,
  account_id text not null,
  first_contacted_at timestamptz not null default now()
);

-- Duplicate protection #2: each sequence step can be sent to a lead at most once.
-- A row is claimed *before* Gmail is called, so crashes/retries can never double-send.
create table public.sends (
  lead_id text not null,
  step int not null,
  campaign_id text not null,
  account_id text not null,
  email text not null,
  gmail_message_id text,
  created_at timestamptz not null default now(),
  primary key (lead_id, step)
);

-- No public access. The app's server uses the secret key, which bypasses RLS.
alter table public.owner enable row level security;
alter table public.accounts enable row level security;
alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.events enable row level security;
alter table public.unsubscribes enable row level security;
alter table public.contacts enable row level security;
alter table public.sends enable row level security;
