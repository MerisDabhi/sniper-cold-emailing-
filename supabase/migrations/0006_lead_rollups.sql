-- Per campaign × sender lead counts, so pages show stats without loading every lead.
-- security_invoker: the views obey the leads table's RLS (no public access).
create view public.lead_rollup with (security_invoker = true) as
select
  campaign_id,
  account_id,
  count(*)::int as leads,
  count(*) filter (where status = 'pending')::int as pending,
  count(*) filter (where status = 'in_progress')::int as in_progress,
  count(*) filter (where status = 'completed')::int as completed,
  count(*) filter (where status = 'replied')::int as replied_status,
  count(*) filter (where status = 'bounced')::int as bounced,
  count(*) filter (where status = 'unsubscribed')::int as unsubscribed,
  count(*) filter (where status = 'failed')::int as failed,
  count(*) filter (where status = 'duplicate')::int as duplicate,
  coalesce(sum(step_index), 0)::int as sent,
  count(*) filter (where step_index > 0)::int as contacted,
  count(replied_at)::int as replied,
  count(opened_at)::int as opened
from public.leads
group by campaign_id, account_id;

-- How many leads have received each step (step_index = n means steps 1..n were sent).
create view public.lead_steps with (security_invoker = true) as
select campaign_id, step_index, count(*)::int as leads
from public.leads
group by campaign_id, step_index;

create index if not exists leads_campaign_seq_idx on public.leads (campaign_id, seq);
create index if not exists events_campaign_type_at_idx on public.events (campaign_id, type, at);
