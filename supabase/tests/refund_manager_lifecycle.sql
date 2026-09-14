begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select no_plan();

create function pg_temp.set_auth_claims(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_user_id, 'role', 'authenticated', 'is_anonymous', false
  )::text, true);
end;
$$;

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
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
  ('00000000-0000-0000-0000-000000000000', '99200000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'routine-refund-manager@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '99200000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'refund-operations@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.admin_roles (user_id, role, active)
values ('99200000-0000-4000-8000-000000000002', 'super_admin', true);

insert into public.customer_accounts (id, name, account_type)
values ('99210000-0000-4000-8000-000000000001', 'Manager lifecycle fixture', 'internal');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '99220000-0000-4000-8000-000000000001',
  '99210000-0000-4000-8000-000000000001',
  'Manager lifecycle location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  '99230000-0000-4000-8000-000000000001',
  '99210000-0000-4000-8000-000000000001',
  '99220000-0000-4000-8000-000000000001',
  'Manager lifecycle machine',
  'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '99230000-0000-4000-8000-000000000001',
  '99200000-0000-4000-8000-000000000001',
  'routine-refund-manager@example.test',
  'Manager lifecycle routine persona'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, incident_timezone,
  payment_method, payment_amount_cents, refund_amount_cents,
  status, correlation_status, deterministic_fact_version,
  nayax_refund_execution_status
) values (
  '99240000-0000-4000-8000-000000000001', 'RF-MANAGER-LIFECYCLE',
  '99230000-0000-4000-8000-000000000001',
  '99220000-0000-4000-8000-000000000001',
  'manager-lifecycle-customer@example.test', 'Manager lifecycle fixture',
  now() - interval '1 hour', 'America/Los_Angeles',
  'card', 500, 500, 'needs_review', 'no_match', 1, 'not_requested'
);

select ok(
  has_function_privilege('authenticated', 'public.admin_get_refund_operations_overview()', 'execute')
  and has_function_privilege('service_role', 'public.admin_get_refund_operations_overview()', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_refund_operations_overview()', 'execute'),
  'The scoped overview remains available only to trusted authenticated and service personas'
);

select ok(
  (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%refundOperationsAccess%'
  and (
    pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_customer_correction_v1()'::regprocedure)
    || pg_get_functiondef('public.admin_get_refund_operations_overview_pre_manager_queue_truth_v1()'::regprocedure)
  )
    like '%is_super_admin%',
  'The overview keeps its legacy internal capability flag server-controlled'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()', 'execute')
  and not has_function_privilege('service_role', 'public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()', 'execute'),
  'No browser or service persona can bypass the manager lifecycle overview wrapper'
);

set local role authenticated;
select pg_temp.set_auth_claims('99200000-0000-4000-8000-000000000001');

select is(
  public.admin_get_refund_operations_overview() ->> 'refundOperationsAccess',
  'false',
  'A routine manager is not granted the legacy internal capability'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.admin_get_refund_manual_nayax_context()',
    'execute'
  ),
  'The retired manual Nayax context writer is unavailable to browser sessions'
);

select ok(
  (public.admin_get_refund_nayax_resolution_readiness(
    '99240000-0000-4000-8000-000000000001'
  ) ->> 'visible') = 'true'
  and (public.admin_get_refund_nayax_resolution_readiness(
    '99240000-0000-4000-8000-000000000001'
  ) ->> 'available') = 'false'
  and (public.admin_get_refund_nayax_resolution_readiness(
    '99240000-0000-4000-8000-000000000001'
  ) ->> 'blockReason') = 'exact_attempt_required'
  and (public.admin_get_refund_nayax_resolution_readiness(
    '99240000-0000-4000-8000-000000000001'
  ) ->> 'payloadRedacted') = 'true',
  'A case manager can see that exact System attempt evidence is required'
);

select ok(
  pg_temp.capture_error($$select public.admin_create_refund_manual_nayax_candidate(
    '99240000-0000-4000-8000-000000000001', 1, 'SAFE-MACHINE',
    'SAFE-TRANSACTION', '2026-08-26T12:00', 500, '4242'
  )$$) like '42501:permission denied for function admin_create_refund_manual_nayax_candidate%',
  'No authenticated user can submit retired manual provider evidence'
);

select ok(
  pg_temp.capture_error($$select public.admin_begin_refund_manual_nayax_portal(
    '99240000-0000-4000-8000-000000000001', 1
  )$$) like '42501:permission denied for function admin_begin_refund_manual_nayax_portal%',
  'No authenticated user can begin the retired manual provider lane'
);

select ok(
  pg_temp.capture_error($$select public.admin_begin_refund_nayax_evidence_only_reconciliation(
    '99240000-0000-4000-8000-000000000001', 1
  )$$) like '42501:permission denied for function admin_begin_refund_nayax_evidence_only_reconciliation%',
  'The retired evidence-only reconciliation action is unavailable'
);

select ok(
  pg_temp.capture_error($$select public.admin_prepare_refund_nayax_resolution_intent(
    '99240000-0000-4000-8000-000000000001',
    '99220000-0000-4000-8000-000000000001',
    'succeeded', 'provider_receipt', 'SAFE-REFERENCE', now(), 'confirmed', 1
  )$$) like '42501:permission denied for function admin_prepare_refund_nayax_resolution_intent%',
  'The retired technical resolution preparation action is unavailable'
);

select ok(
  pg_temp.capture_error($$select public.admin_resolve_refund_nayax_outcome_manager_session(
    '99240000-0000-4000-8000-000000000001',
    '99220000-0000-4000-8000-000000000001',
    'succeeded', 'provider_receipt', 'SAFE-REFERENCE', now(), 'confirmed', 1
  )$$) like '42501:permission denied for function admin_resolve_refund_nayax_outcome_manager_session%',
  'The retired manager-session outcome action is unavailable'
);

select ok(
  not has_function_privilege('authenticated', 'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(uuid,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_get_refund_nayax_resolution_readiness_pre_ops_v1(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_begin_refund_nayax_evidence_reconcile_pre_ops_v1(uuid,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_prepare_refund_nayax_resolution_intent_pre_ops_v1(uuid,uuid,text,text,text,timestamptz,text,bigint)', 'execute')
  and not has_function_privilege('authenticated', 'public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(uuid,uuid,text,text,text,timestamptz,text,bigint)', 'execute'),
  'All pre-wrapper technical functions remain unreachable from browser sessions'
);

select pg_temp.set_auth_claims('99200000-0000-4000-8000-000000000002');

select is(
  public.admin_get_refund_operations_overview() ->> 'refundOperationsAccess',
  'true',
  'A Super-admin retains the legacy internal capability flag'
);

select * from finish();
rollback;
