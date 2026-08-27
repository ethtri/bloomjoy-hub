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

select ok(
  has_function_privilege('authenticated', 'public.admin_get_refund_operations_overview()', 'execute')
  and has_function_privilege('service_role', 'public.admin_get_refund_operations_overview()', 'execute')
  and not has_function_privilege('anon', 'public.admin_get_refund_operations_overview()', 'execute'),
  'The scoped overview remains available only to trusted authenticated and service personas'
);

select ok(
  pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%refundOperationsAccess%'
  and pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure)
    like '%is_super_admin%',
  'The overview publishes the explicit Refund Operations capability from server-side authorization'
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
  'A routine manager is not granted Refund Operations access'
);

select is(
  public.admin_get_refund_manual_nayax_context(),
  '[]'::jsonb,
  'A routine manager receives no provider or manual Nayax context'
);

select ok(
  public.admin_get_refund_nayax_resolution_readiness(
    '99210000-0000-4000-8000-000000000001'
  ) = jsonb_build_object(
    'visible', false,
    'available', false,
    'blockReason', 'refund_operations_access_required',
    'payloadRedacted', true
  ),
  'A routine manager receives only a redacted hidden reconciliation response'
);

select ok(
  pg_temp.capture_error($$select public.admin_create_refund_manual_nayax_candidate(
    '99210000-0000-4000-8000-000000000001', 1, 'SAFE-MACHINE',
    'SAFE-TRANSACTION', '2026-08-26T12:00', 500, '4242'
  )$$) like '42501:Refund Operations administrator required%',
  'A routine manager cannot submit manual provider evidence'
);

select ok(
  pg_temp.capture_error($$select public.admin_begin_refund_manual_nayax_portal(
    '99210000-0000-4000-8000-000000000001', 1
  )$$) like '42501:Refund Operations administrator required%',
  'A routine manager cannot begin a manual provider approval'
);

select ok(
  pg_temp.capture_error($$select public.admin_begin_refund_nayax_evidence_only_reconciliation(
    '99210000-0000-4000-8000-000000000001', 1
  )$$) like '42501:Refund Operations administrator required%',
  'A routine manager cannot begin evidence-only reconciliation'
);

select ok(
  pg_temp.capture_error($$select public.admin_prepare_refund_nayax_resolution_intent(
    '99210000-0000-4000-8000-000000000001',
    '99220000-0000-4000-8000-000000000001',
    'succeeded', 'provider_receipt', 'SAFE-REFERENCE', now(), 'confirmed', 1
  )$$) like '42501:Refund Operations administrator required%',
  'A routine manager cannot prepare a technical resolution intent'
);

select ok(
  pg_temp.capture_error($$select public.admin_resolve_refund_nayax_outcome_manager_session(
    '99210000-0000-4000-8000-000000000001',
    '99220000-0000-4000-8000-000000000001',
    'succeeded', 'provider_receipt', 'SAFE-REFERENCE', now(), 'confirmed', 1
  )$$) like '42501:Refund Operations administrator required%',
  'A routine manager cannot record an authoritative provider resolution'
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
  'A Super Admin receives the Refund Operations capability'
);

select * from finish();
rollback;
