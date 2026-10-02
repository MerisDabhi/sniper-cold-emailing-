-- Small key/value settings, e.g. the public domain the app was last opened on
-- (used by background senders to build unsubscribe / tracking links).
create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
