-- Track notification status for supply procurement requests.

alter table public.lead_submissions
  add column if not exists internal_notification_error text,
  add column if not exists wecom_alert_sent_at timestamptz,
  add column if not exists wecom_alert_error text;

create index if not exists lead_submissions_submission_type_created_at_idx
  on public.lead_submissions (submission_type, created_at desc);

comment on column public.lead_submissions.internal_notification_error is
  'Latest internal email notification failure for quote/procurement intake, if any.';

comment on column public.lead_submissions.wecom_alert_sent_at is
  'Timestamp when a WeCom internal alert was sent for quote/procurement intake.';

comment on column public.lead_submissions.wecom_alert_error is
  'Latest non-blocking WeCom alert failure for quote/procurement intake, if any.';
