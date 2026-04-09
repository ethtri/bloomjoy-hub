alter table public.internal_notification_dispatches
  drop constraint if exists internal_notification_dispatches_dispatch_type_check;

update public.internal_notification_dispatches
set
  dispatch_type = 'lead_submission',
  event_key = regexp_replace(event_key, '^lead_quote:', 'lead_submission:')
where dispatch_type = 'lead_quote';

alter table public.internal_notification_dispatches
  add constraint internal_notification_dispatches_dispatch_type_check
  check (
    dispatch_type in (
      'lead_submission',
      'mini_waitlist',
      'order_checkout',
      'plus_subscription_activated'
    )
  );

alter table public.mini_waitlist_submissions
  add column if not exists internal_notification_sent_at timestamptz;

drop policy if exists "lead_submissions_insert_public" on public.lead_submissions;
drop policy if exists "mini_waitlist_submissions_insert_public" on public.mini_waitlist_submissions;
