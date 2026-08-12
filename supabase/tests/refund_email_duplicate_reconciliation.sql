begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

select plan(36);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '93000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'email-reconciliation-manager@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '93000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'unassigned-email-manager@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values ('93100000-0000-4000-8000-000000000001', 'Email reconciliation test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '93200000-0000-4000-8000-000000000001',
  '93100000-0000-4000-8000-000000000001',
  'Email reconciliation location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type,
  nayax_refunds_enabled, nayax_machine_id, nayax_refund_max_amount_cents
) values
  (
    '93300000-0000-4000-8000-000000000001',
    '93100000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'Email reconciliation machine A', 'commercial', true,
    'email-reconciliation-nayax-a', 2000
  ),
  (
    '93300000-0000-4000-8000-000000000002',
    '93100000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'Email reconciliation machine B', 'commercial', true,
    'email-reconciliation-nayax-b', 2000
  );

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '93400000-0000-4000-8000-000000000001',
  '93300000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  'email-reconciliation-manager@example.test',
  'Email-only duplicate reconciliation test'
);

select has_table(
  'public', 'refund_case_reconciliation_reviews',
  'PII-minimized email reconciliation table exists'
);
select has_column(
  'public', 'refund_cases', 'duplicate_of_refund_case_id',
  'Refund cases can point to one canonical case'
);
select has_column(
  'public', 'refund_case_reconciliation_reviews', 'left_fact_fingerprint',
  'Duplicate review binds the left case facts'
);
select has_column(
  'public', 'refund_case_reconciliation_reviews', 'right_fact_fingerprint',
  'Duplicate review binds the right case facts'
);
select has_function(
  'public', 'admin_get_refund_case_reconciliation', array['uuid'],
  'Scoped reconciliation context exists'
);
select has_function(
  'public', 'admin_resolve_refund_case_reconciliation',
  array['uuid','text','uuid','text'],
  'Scoped reconciliation resolution exists'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.refund_case_reconciliation_reviews', 'select'
  ),
  'Browser clients cannot read comparison rows directly'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  customer_name, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, card_wallet_used, status,
  correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Synthetic Customer',
    'Website form fixture', '2026-08-05 18:00:00+00',
    'card', 700, '4242', false, 'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'SAME-EMAIL-CUSTOMER@example.test', 'Synthetic Customer',
    'Gmail fixture', '2026-08-05 18:08:00+00',
    'card', 700, '4242', false, 'needs_review', 'manual_review', 'gmail'
  );

select is(
  (select count(*)::integer from public.refund_case_reconciliation_reviews),
  1,
  'Matching website and Gmail cases create one race-safe review pair'
);
select is(
  (select match_class from public.refund_case_reconciliation_reviews),
  'exact',
  'The complete high-confidence fact set is exact'
);
select ok(
  (
    select reason_codes @> array[
      'customer_email_exact', 'machine_exact',
      'incident_within_15_minutes', 'amount_exact',
      'payment_method_exact', 'card_last4_exact', 'wallet_state_exact'
    ]::text[]
    from public.refund_case_reconciliation_reviews
  ),
  'Only fixed, non-PII match reasons are persisted'
);
select ok(
  (
    select left_fact_fingerprint ~ '^[a-f0-9]{64}$'
      and right_fact_fingerprint ~ '^[a-f0-9]{64}$'
      and left_fact_fingerprint !~ 'same-email-customer|4242'
      and right_fact_fingerprint !~ 'same-email-customer|4242'
    from public.refund_case_reconciliation_reviews
  ),
  'Fact bindings are one-way fixed-length fingerprints without raw customer facts'
);
select ok(
  public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  ),
  'A candidate blocks the case pending manager review'
);
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '94000000-0000-4000-8000-000000000001'
  $sql$) like '%Resolve possible duplicate refund cases%',
  'A pending review blocks an official case decision'
);
select ok(
  not public.can_perform_refund_official_action(
    '93000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001'
  ),
  'The current manager cannot prepare step-up while a duplicate review is pending'
);
select ok(
  pg_get_functiondef(
    'public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure
  ) like '%can_perform_refund_official_action%',
  'Nayax readiness retains PR 701 manager/TOTP authority delegation'
);

select set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000001',
  true
);
select is(
  (
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ) ->> 'actionBlocked'
  )::boolean,
  true,
  'The assigned manager sees the case as action-blocked'
);
select is(
  jsonb_array_length(
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ) -> 'reviews'
  ),
  1,
  'The assigned manager sees one linked review'
);
select ok(
  public.admin_get_refund_case_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  )::text !~ 'same-email-customer@example.test|Website form fixture|Gmail fixture'
  and not jsonb_path_exists(
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ),
    '$.** ? (@ == "4242")'
  ),
  'The comparison contract omits email, complaint text, and card digits'
);

select public.admin_resolve_refund_case_reconciliation(
  (select id from public.refund_case_reconciliation_reviews),
  'duplicate',
  '94000000-0000-4000-8000-000000000001',
  'same_incident'
);
select is(
  (
    select duplicate_of_refund_case_id
    from public.refund_cases
    where id = '94000000-0000-4000-8000-000000000002'
  ),
  '94000000-0000-4000-8000-000000000001'::uuid,
  'The manager marks the second case as duplicate of the canonical case'
);
select ok(
  not public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  ),
  'Resolving the pair releases the canonical case review hold'
);
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '94000000-0000-4000-8000-000000000002'
  $sql$) like '%confirmed duplicate case%',
  'The confirmed duplicate remains permanently blocked from official action'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000003',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'possible-email-customer@example.test', 'Website possible fixture',
    '2026-08-05 20:00:00+00', 'card', 900, '1111', false,
    'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000004',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'possible-email-customer@example.test', 'Gmail possible fixture',
    '2026-08-05 23:00:00+00', 'card', 900, '2222', true,
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select match_class
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'possible',
  'A wallet/last-four mismatch is reviewable but never silently merged'
);
select public.admin_resolve_refund_case_reconciliation(
  (
    select id from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'distinct',
  null,
  'different_purchase'
);
select is(
  (
    select status from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'confirmed_distinct',
  'A manager can confirm genuinely different purchases'
);
update public.refund_cases
set
  incident_at = '2026-08-05 20:08:00+00',
  card_last4 = '1111',
  card_wallet_used = false
where id = '94000000-0000-4000-8000-000000000004';
select is(
  (
    select status from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'pending',
  'Changing comparison facts reopens a stale distinct resolution'
);
select is(
  (
    select match_class from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'exact',
  'The reopened review reflects the newly exact fact match'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000008',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'midnight-customer@example.test', 'Before midnight fixture',
    '2026-08-05 23:58:00+00', 'card', 650, '9090', false,
    'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000009',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'MIDNIGHT-CUSTOMER@example.test', 'After midnight fixture',
    '2026-08-06 00:05:00+00', 'card', 650, '9090', false,
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000009' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  1,
  'Cross-midnight cases inside the candidate window share one review scope'
);
select is(
  public.refund_reconciliation_scope_lock_key(
    'midnight-customer@example.test',
    '93300000-0000-4000-8000-000000000001'
  ),
  public.refund_reconciliation_scope_lock_key(
    'MIDNIGHT-CUSTOMER@example.test',
    '93300000-0000-4000-8000-000000000001'
  ),
  'The reconciliation lock key is case-insensitive and independent of incident date'
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect(
    'reconcile_lock_a',
    local_connection
  );
  perform extensions.dblink_connect(
    'reconcile_lock_b',
    local_connection
  );
  perform extensions.dblink_exec('reconcile_lock_a', 'begin');
  perform extensions.dblink_exec('reconcile_lock_b', 'begin');
  perform extensions.dblink_exec(
    'reconcile_lock_a',
    format(
      'do $lock$ begin perform pg_advisory_xact_lock(%s); end $lock$;',
      public.refund_reconciliation_scope_lock_key(
        'concurrent-customer@example.test',
        '93300000-0000-4000-8000-000000000001'
      )
    )
  );
end;
$$;
select is(
  (
    select acquired
    from extensions.dblink(
      'reconcile_lock_b',
      format(
        'select pg_try_advisory_xact_lock(%s)',
        public.refund_reconciliation_scope_lock_key(
          'CONCURRENT-CUSTOMER@example.test',
          '93300000-0000-4000-8000-000000000001'
        )
      )
    ) as result(acquired boolean)
  ),
  false,
  'A second database session cannot enter the same reconciliation scope concurrently'
);
do $$
begin
  perform extensions.dblink_exec('reconcile_lock_a', 'commit');
end;
$$;
select is(
  (
    select acquired
    from extensions.dblink(
      'reconcile_lock_b',
      format(
        'select pg_try_advisory_xact_lock(%s)',
        public.refund_reconciliation_scope_lock_key(
          'concurrent-customer@example.test',
          '93300000-0000-4000-8000-000000000001'
        )
      )
    ) as result(acquired boolean)
  ),
  true,
  'The waiting reconciliation scope becomes available after the first transaction commits'
);
do $$
begin
  perform extensions.dblink_exec('reconcile_lock_b', 'rollback');
  perform extensions.dblink_disconnect('reconcile_lock_a');
  perform extensions.dblink_disconnect('reconcile_lock_b');
end;
$$;

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000005',
    '93300000-0000-4000-8000-000000000002',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Different machine fixture',
    '2026-08-05 18:05:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  ),
  (
    '94000000-0000-4000-8000-000000000006',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'different-customer@example.test', 'Different customer fixture',
    '2026-08-05 18:05:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  ),
  (
    '94000000-0000-4000-8000-000000000007',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Outside window fixture',
    '2026-08-06 06:30:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000005' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A different machine does not create a false-positive review'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000006' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A different customer does not create a false-positive review'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000007' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A purchase outside the six-hour window does not create a false-positive review'
);
select ok(
  (
    public.admin_get_refund_reconciliation_health() ->> 'pendingReviewCount'
  )::integer >= 1
  and (
    public.admin_get_refund_reconciliation_health() ->> 'payloadRedacted'
  )::boolean,
  'Aggregate health reports pending work without raw customer facts'
);
select ok(
  pg_get_functiondef(
    'public.reconcile_refund_email_case_candidates()'::regprocedure
  ) like '%pg_advisory_xact_lock%'
  and pg_get_constraintdef(
    (
      select oid from pg_constraint
      where conname = 'refund_case_reconciliation_pair_unique'
    )
  ) like '%UNIQUE%',
  'Concurrent intake is serialized and the case pair is unique'
);
select ok(
  pg_get_functiondef(
    'public.assert_refund_adjustment_reconciliation_safe()'::regprocedure
  ) like '%before settlement%'
  and pg_get_functiondef(
    'public.assert_refund_case_nayax_reconciliation_safe()'::regprocedure
  ) like '%before provider execution%',
  'Settlement and provider guards both fail closed'
);

select set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000002',
  true
);
select ok(
  pg_temp.capture_error($sql$
    select public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    )
  $sql$) like '%Refund case access required%',
  'An unassigned manager cannot read reconciliation context'
);

select * from finish();
rollback;
