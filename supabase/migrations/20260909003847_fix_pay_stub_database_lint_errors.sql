-- #1254: repair the three production Pay Stub lint/runtime errors without
-- changing existing statement records or compensation calculations.

alter table public.customer_accounts
  add column if not exists legal_name text;

comment on column public.customer_accounts.legal_name is
  'Optional legal payer name displayed on compensation statements; payout display name remains the operational label.';

-- The legacy issuer has a local variable named statement_payload as well as a
-- target-table column with that name. Its revision update is intended to extend
-- the existing statement column, so make that resolution explicit for this
-- function rather than relying on the cluster-wide PL/pgSQL default.
alter function public.admin_issue_pay_statements(uuid, text, text)
  set plpgsql.variable_conflict = 'use_column';
