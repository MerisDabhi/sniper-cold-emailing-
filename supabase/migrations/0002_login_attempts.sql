-- Failed sign-in attempts, used to lock out brute-force guessing (10 failures / 15 min per IP).
create table public.login_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  at timestamptz not null default now()
);
create index login_attempts_ip_at_idx on public.login_attempts (ip, at);
alter table public.login_attempts enable row level security;
