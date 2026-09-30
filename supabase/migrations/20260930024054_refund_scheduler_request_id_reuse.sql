alter table public.refund_automation_scheduler_dispatches
  drop constraint if exists refund_automation_scheduler_dispatches_request_id_key;

comment on column public.refund_automation_scheduler_dispatches.request_id is
  'Transport-local pg_net request identifier. It may be reused after pg_net lifecycle resets; durable dispatch identity is run_key and (mode, bucket_at).';

comment on table public.refund_automation_scheduler_dispatches is
  'Durable primary refund scheduler dispatch ledger keyed by run_key and (mode, bucket_at); request_id is transport-local diagnostic evidence.';
