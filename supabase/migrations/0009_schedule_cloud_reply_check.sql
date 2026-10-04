-- Every 3 minutes: check all inboxes for replies/bounces/unsubscribes (Edge Function `check-replies`).
select cron.unschedule('sniper-check-replies') where exists (select 1 from cron.job where jobname = 'sniper-check-replies');
select cron.schedule(
  'sniper-check-replies',
  '*/3 * * * *',
  $$
  select net.http_post(
    url := 'https://tdyrsekoicnmiytyulzn.supabase.co/functions/v1/check-replies',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.app_secret('cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
