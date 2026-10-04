-- A command is claimed ("running") before it is executed, so it can never be sent twice.
alter table public.wa_commands drop constraint if exists wa_commands_status_check;
alter table public.wa_commands add constraint wa_commands_status_check check (status in ('pending','running','done','failed'));
