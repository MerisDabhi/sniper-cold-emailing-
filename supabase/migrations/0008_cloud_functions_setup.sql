-- Scheduling + outgoing HTTP for the cloud reply checker.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Secrets for Edge Functions live encrypted in Vault. Only the server (service_role) can read or set them.
create or replace function public.app_secret(p_name text)
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

create or replace function public.set_app_secret(p_name text, p_value text)
returns void language plpgsql security definer set search_path = '' as $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = p_name;
  if existing is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(existing, p_value);
  end if;
end $$;

revoke all on function public.app_secret(text) from public, anon, authenticated;
revoke all on function public.set_app_secret(text, text) from public, anon, authenticated;
grant execute on function public.app_secret(text) to service_role;
grant execute on function public.set_app_secret(text, text) to service_role;
