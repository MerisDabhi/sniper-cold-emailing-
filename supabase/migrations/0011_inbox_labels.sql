-- Inbox: every reply gets a label automatically, and conversations track unread state.
alter table public.leads add column if not exists label text;
alter table public.leads add column if not exists label_manual boolean not null default false;
alter table public.leads add column if not exists last_reply_at bigint;
alter table public.leads add column if not exists read_at bigint;
create index if not exists leads_last_reply_idx on public.leads (last_reply_at desc) where last_reply_at is not null;

/** Guess what a reply means from its text. Order matters: "not interested" must win over "interested". */
create or replace function public.classify_reply(t text) returns text
language sql immutable set search_path = '' as $$
  select case
    when t is null or btrim(t) = '' then 'replied'
    when t ~* '(out of (the )?office|on (annual |maternity |paternity |sick )?leave|on (vacation|holiday)|away (from|until)|auto(matic)?[- ]?reply|limited access to (my )?e?-?mail|currently (away|travell?ing)|will (be back|return) on)' then 'out_of_office'
    when t ~* '(thank(s| you) for (contacting|reaching out|getting in touch|your (message|e-?mail|enquiry|inquiry|interest))|^\W*(hello[!. ]*\W*)?welcome to |we(''| a)?re (currently )?(unavailable|closed|away)|(respond|reply|get back)( to you)? (as soon as|shortly|soon|within)|this is an automated|how (can|may) we help you)' then 'auto_reply'
    when t ~* '(unsubscribe|remove me|stop (emailing|messaging|texting|contacting)|take me off|opt[ -]?out|not interested|no interest|no,? thanks|no thank you|not (a )?(good |right )?fit|not looking|do ?n[o'']?t (contact|email|message|text)|we(''| a)?re (all )?set|already (have|use|work)|not (at this time|right now|for us|needed|required)|pass on this|please stop|nahi chahiye|no need)' then 'not_interested'
    when t ~* '(wrong (person|number)|not the right (person|contact)|no longer (with|work)|left the company|not responsible for|you should (contact|reach)|please (contact|reach out to) )' then 'wrong_person'
    when t ~* '(calendly|cal\.com/|meet\.google|zoom\.us|book(ed)? (a |the |in )?(call|meeting|time|slot|demo)|schedul(e|ed|ing) (a |the )?(call|meeting|demo|time)|let(''| u)?s (meet|talk|chat|connect|hop on|jump on|have a call|discuss)|set up (a )?(call|meeting|time)|(call|meeting) (is )?(confirmed|booked|scheduled)|calendar invite|invite sent|see you (on|at|then)|(available|free) (on|at|tomorrow|today|this|next)|what time works|when (are you|can we|can you)|call me|give me a call|can we (talk|speak|meet|connect))' then 'meeting_booked'
    when t ~* '(interested|sounds (good|great|interesting)|tell me more|more (info|information|details)|send (me |over |us )?(more|details|pricing|the|some|your)|how much|pricing|price|cost|charges|fees|love to|would like to|keen to|let(''| u)?s do it|can you share|share (the |more |your )?(details|info)|how does (it|this) work|^(yes|sure|ok|okay)\M)' then 'interested'
    else 'replied'
  end
$$;

/** When a reply is recorded, label the conversation (unless the label was chosen by hand). */
create or replace function public.label_lead_on_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.type = 'reply' and new.lead_id is not null then
    update public.leads
       set label = public.classify_reply(new.detail)
     where id = new.lead_id and not label_manual;
  end if;
  return new;
end
$$;

drop trigger if exists events_label_lead on public.events;
create trigger events_label_lead after insert on public.events for each row execute function public.label_lead_on_reply();
revoke execute on function public.label_lead_on_reply() from public, anon, authenticated;

-- Existing replies: label them from their latest reply text.
update public.leads l
   set last_reply_at = coalesce(l.last_reply_at, l.replied_at),
       label = coalesce(l.label, public.classify_reply((select e.detail from public.events e where e.lead_id = l.id and e.type = 'reply' order by e.at desc limit 1)))
 where l.replied_at is not null;

-- Check inboxes every minute so the inbox feels live.
select cron.unschedule('sniper-check-replies') where exists (select 1 from cron.job where jobname = 'sniper-check-replies');
select cron.schedule(
  'sniper-check-replies',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://tdyrsekoicnmiytyulzn.supabase.co/functions/v1/check-replies',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', public.app_secret('cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);
