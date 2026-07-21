begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(7);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception
  when others then
    return sqlstate || ':' || sqlerrm;
end;
$$;

insert into public.customer_accounts (id, name, account_type)
values ('71000000-0000-4000-8000-000000000001', 'Refund recommendation safety test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '72000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'Refund test location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '73000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  'Refund test machine'
);

insert into public.refund_cases (
  id,
  reporting_machine_id,
  reporting_location_id,
  customer_email,
  issue_summary,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  status,
  correlation_status,
  correlation_source,
  matched_nayax_transaction_id,
  nayax_recommendation_state,
  nayax_recommendation_policy_version
)
values
  (
    '74000000-0000-4000-8000-000000000001',
    '73000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'refund-one@example.test',
    'Refund recommendation safety fixture one',
    now(),
    'card',
    700,
    '4242',
    'card_refund_pending',
    'matched',
    'nayax',
    'nayax-test-transaction-1',
    'high_confidence',
    '2026-07-21.v1'
  ),
  (
    '74000000-0000-4000-8000-000000000002',
    '73000000-0000-4000-8000-000000000001',
    '72000000-0000-4000-8000-000000000001',
    'refund-two@example.test',
    'Refund recommendation safety fixture two',
    now(),
    'card',
    700,
    '4242',
    'needs_review',
    'manual_review',
    'nayax',
    null,
    'ambiguous',
    '2026-07-21.v1'
  );

select has_index(
  'public',
  'refund_cases',
  'refund_cases_unique_matched_nayax_transaction_id_idx',
  'Matched Nayax transaction IDs have a race-safe unique index'
);

select is(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set nayax_match_execution_eligible = true
    where id = '74000000-0000-4000-8000-000000000001'
  $sql$),
  null,
  'A non-wallet, high-confidence, matched case may become execution eligible'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set card_wallet_used = true
    where id = '74000000-0000-4000-8000-000000000001'
  $sql$) is not null,
  'An execution-eligible wallet case is rejected by the database constraint'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set
      correlation_status = 'matched',
      matched_nayax_transaction_id = 'nayax-test-transaction-2',
      nayax_match_execution_eligible = true
    where id = '74000000-0000-4000-8000-000000000002'
  $sql$) is not null,
  'An ambiguous recommendation cannot become execution eligible'
);

select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set matched_nayax_transaction_id = 'nayax-test-transaction-1'
    where id = '74000000-0000-4000-8000-000000000002'
  $sql$) like '23505:%',
  'A Nayax transaction cannot be linked to two refund cases'
);

select ok(
  pg_get_functiondef('public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure)
    like '%nayax_match_execution_eligible = true%'
  and pg_get_functiondef('public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure)
    like '%card_wallet_used = false%',
  'The database execution predicate requires eligibility and blocks wallets'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%nayaxLookupCandidates%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%oneClickEligible%',
  'The live overview serializes the versioned recommendation contract'
);

select * from finish();
rollback;
