-- Campaigns can be email or WhatsApp.
alter table public.campaigns add column channel text not null default 'email' check (channel in ('email','whatsapp'));
-- Country code added to sheet phone numbers that don't include one (e.g. '91').
alter table public.campaigns add column country_code text not null default '';

-- WhatsApp leads are identified by phone instead of email.
alter table public.leads alter column email drop not null;
alter table public.leads add column phone text;
alter table public.leads add column wa_jid text;
alter table public.leads add constraint leads_campaign_phone_key unique (campaign_id, phone);
alter table public.leads add constraint leads_has_address check (email is not null or phone is not null);
create index leads_phone_idx on public.leads (phone);
create index leads_wa_jid_idx on public.leads (wa_jid);

-- Connected WhatsApp numbers (linked by scanning a QR code, like WhatsApp Web).
create table public.wa_accounts (
  id text primary key,
  label text not null default '',
  phone text,
  name text,
  status text not null default 'pending' check (status in ('pending','qr','connected','disconnected','paused','logged_out','remove_requested')),
  qr text,
  error text,
  daily_limit int not null default 15,
  next_send_at bigint not null default 0,
  last_seen_at timestamptz,
  connected_at timestamptz,
  created_at timestamptz not null default now()
);

-- WhatsApp session keys per number, so the worker can restart without a new QR scan.
create table public.wa_auth (
  account_id text not null references public.wa_accounts(id) on delete cascade,
  key text not null,
  value jsonb not null,
  primary key (account_id, key)
);

-- Commands from the app to the WhatsApp worker (test messages, unlink).
create table public.wa_commands (
  id text primary key,
  account_id text not null references public.wa_accounts(id) on delete cascade,
  type text not null check (type in ('test','logout')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','done','failed')),
  result text,
  created_at timestamptz not null default now()
);
create index wa_commands_pending_idx on public.wa_commands (status, created_at);

-- Worker heartbeats and a lease so only one worker ever holds the WhatsApp connections.
create table public.workers (
  name text primary key,
  holder text not null,
  heartbeat_at timestamptz not null default now(),
  lease_until timestamptz not null
);

create or replace function public.acquire_worker_lease(p_name text, p_holder text, p_seconds int)
returns boolean language plpgsql security definer set search_path = public as $$
declare got boolean;
begin
  insert into workers(name, holder, heartbeat_at, lease_until)
  values (p_name, p_holder, now(), now() + make_interval(secs => p_seconds))
  on conflict (name) do update
    set holder = excluded.holder, heartbeat_at = now(), lease_until = excluded.lease_until
    where workers.holder = excluded.holder or workers.lease_until < now()
  returning true into got;
  return coalesce(got, false);
end $$;
revoke all on function public.acquire_worker_lease(text, text, int) from public, anon, authenticated;
grant execute on function public.acquire_worker_lease(text, text, int) to service_role;

alter table public.wa_accounts enable row level security;
alter table public.wa_auth enable row level security;
alter table public.wa_commands enable row level security;
alter table public.workers enable row level security;
