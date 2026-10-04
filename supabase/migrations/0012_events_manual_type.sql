-- Replies you write by hand on WhatsApp are kept as 'manual' events, so they show in the conversation view.
alter table public.events drop constraint if exists events_type_check;
alter table public.events add constraint events_type_check check (type in ('sent','reply','open','bounce','unsubscribe','error','duplicate','manual'));
