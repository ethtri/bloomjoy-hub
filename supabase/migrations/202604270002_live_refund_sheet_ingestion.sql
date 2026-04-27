-- Allow live private-sheet refund rows to be distinguished from uploaded exports
-- while reusing the existing refund review ledger and applied adjustment facts.

alter table public.refund_adjustment_review_rows
  drop constraint if exists refund_adjustment_review_rows_source_check;

alter table public.refund_adjustment_review_rows
  add constraint refund_adjustment_review_rows_source_check
  check (source in ('sheet_export', 'sheet_api', 'api_payload', 'manual_csv'));

comment on constraint refund_adjustment_review_rows_source_check on public.refund_adjustment_review_rows is
  'Tracks whether a refund review row came from an uploaded sheet export, live sheet API sync, API payload, or manual CSV import.';
