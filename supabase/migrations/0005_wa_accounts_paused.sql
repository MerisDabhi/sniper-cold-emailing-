-- Pausing a number is a user setting, separate from its connection status.
alter table public.wa_accounts add column paused boolean not null default false;
alter table public.wa_accounts drop constraint wa_accounts_status_check;
alter table public.wa_accounts add constraint wa_accounts_status_check check (status in ('pending','qr','connected','disconnected','logged_out','remove_requested'));
