alter table public.refund_adjustment_review_rows
  add column if not exists source_reporting_machine_id uuid;

create index if not exists refund_adjustment_review_rows_source_reporting_machine_idx
  on public.refund_adjustment_review_rows (source_reporting_machine_id, refund_date desc)
  where source_reporting_machine_id is not null;

comment on column public.refund_adjustment_review_rows.source_reporting_machine_id is
  'Canonical Bloomjoy reporting machine ID captured from refund intake when provided; intentionally not foreign-keyed so unknown, deleted, or inactive source IDs can be retained for audit/review while source_location remains the historical source text.';

select pg_notify('pgrst', 'reload schema');
