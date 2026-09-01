begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(26);

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
  (
    '00000000-0000-0000-0000-000000000000',
    'b9100000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'locale-manager@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'b9100000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'locale-outsider@example.invalid', '',
    now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values (
  'b9110000-0000-4000-8000-000000000001',
  'Customer locale fixture',
  'internal'
);

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  'b9120000-0000-4000-8000-000000000001',
  'b9110000-0000-4000-8000-000000000001',
  'Customer locale location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, status
) values (
  'b9130000-0000-4000-8000-000000000001',
  'b9110000-0000-4000-8000-000000000001',
  'b9120000-0000-4000-8000-000000000001',
  'Customer locale machine',
  'active'
);

insert into public.reporting_machine_refund_managers (
  reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  'b9130000-0000-4000-8000-000000000001',
  'b9100000-0000-4000-8000-000000000001',
  'locale-manager@example.invalid',
  'Customer locale authorization fixture'
);

insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, correlation_status, correlation_source,
  intake_meta
) values
  (
    'b9140000-0000-4000-8000-000000000001', 'RF-LOCALE-UNSET',
    'b9130000-0000-4000-8000-000000000001',
    'b9120000-0000-4000-8000-000000000001',
    'locale-unset@example.invalid', 'Existing case without a stored locale',
    statement_timestamp() - interval '2 hours', 'cash', 800,
    'needs_review', 'not_applicable', 'manual', '{}'::jsonb
  ),
  (
    'b9140000-0000-4000-8000-000000000002', 'RF-LOCALE-INTAKE',
    'b9130000-0000-4000-8000-000000000001',
    'b9120000-0000-4000-8000-000000000001',
    'locale-intake@example.invalid', 'New case with a stored locale',
    statement_timestamp() - interval '1 hour', 'card', 700,
    'needs_review', 'needs_nayax', 'nayax',
    '{"customer_locale":"es"}'::jsonb
  );

create temp table locale_case_state_before on commit drop as
select
  status,
  decision,
  refund_completed_at,
  reporting_adjustment_id,
  nayax_refund_execution_status,
  official_action_version
from public.refund_cases
where id = 'b9140000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'authenticated',
    'public.admin_correct_refund_customer_locale(uuid,bigint,bigint,text,text)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_correct_refund_customer_locale(uuid,bigint,bigint,text,text)',
    'execute'
  ),
  'Only authenticated managers can reach the locale correction RPC'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.refund_customer_locale_contract(uuid)',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'public.refund_customer_locale_contract(uuid)',
    'execute'
  ),
  'The locale projector is not a standalone Data API surface'
);

select is(
  public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000001'
  ) ->> 'locale',
  null,
  'An existing case without locale metadata is visibly unset'
);

select is(
  public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000001'
  ) ->> 'source',
  'not_set',
  'An unset locale requires manager review instead of inventing provenance'
);

select is(
  public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000002'
  ) ->> 'locale',
  'es',
  'A new case exposes the persisted Spanish locale'
);

select is(
  public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000002'
  ) ->> 'source',
  'intake_inference',
  'New persisted locale metadata is labeled as captured at intake'
);

set local role authenticated;
select pg_temp.set_auth_claims('b9100000-0000-4000-8000-000000000002');

select ok(
  pg_temp.capture_error($$select public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'es',
    'reviewed_customer_request_language'
  )$$) like 'P4624:Refund case access required%',
  'An unrelated authenticated user cannot correct another case locale'
);

select pg_temp.set_auth_claims('b9100000-0000-4000-8000-000000000001');

select ok(
  pg_temp.capture_error($$select public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 99, 0, 'es',
    'reviewed_customer_request_language'
  )$$) like 'P4625:Refund case changed%',
  'A stale case version cannot correct the customer locale'
);

select ok(
  pg_temp.capture_error($$select public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 4, 'es',
    'reviewed_customer_request_language'
  )$$) like 'P4626:Customer language changed%',
  'A stale locale version cannot overwrite a newer correction'
);

select ok(
  pg_temp.capture_error($$select public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'fr',
    'reviewed_customer_request_language'
  )$$) like 'P4621:Customer language must be English or Spanish%',
  'Only the supported English or Spanish contract is accepted'
);

select ok(
  pg_temp.capture_error($$select public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'es', 'free text'
  )$$) like 'P4622:A reviewed customer-language reason is required%',
  'Locale correction requires one fixed reviewed reason'
);

select is(
  (public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'es',
    'reviewed_customer_request_language'
  ) ->> 'recorded')::boolean,
  true,
  'The mapped manager records the first locale correction'
);

select is(
  (public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'es',
    'reviewed_customer_request_language'
  ) ->> 'localeVersion')::bigint,
  1::bigint,
  'The replay response exposes the resulting locale version'
);

select ok(
  (
    select refund_case.intake_meta ->> 'customer_locale' = 'es'
      and refund_case.intake_meta ->> 'customer_locale_source' = 'manager_correction'
      and refund_case.intake_meta ->> 'customer_locale_reason'
        = 'reviewed_customer_request_language'
      and refund_case.intake_meta ->> 'customer_locale_version' = '1'
    from public.refund_cases refund_case
    where refund_case.id = 'b9140000-0000-4000-8000-000000000001'
  ),
  'The correction persists only bounded locale, source, reason, time, and version metadata'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events event
    where event.refund_case_id = 'b9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_locale_corrected'
  ),
  1,
  'The first correction creates exactly one immutable audit event'
);

select ok(
  (
    select event.actor_user_id = 'b9100000-0000-4000-8000-000000000001'
      and event.metadata ->> 'locale' = 'es'
      and event.metadata ->> 'previous_locale_version' = '0'
      and event.metadata ->> 'result_locale_version' = '1'
      and (event.metadata ->> 'payload_redacted')::boolean
    from public.refund_case_events event
    where event.refund_case_id = 'b9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_locale_corrected'
  ),
  'The immutable event stores actor and bounded redacted provenance'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_messages message
    where message.refund_case_id = 'b9140000-0000-4000-8000-000000000001'
  ),
  0,
  'Correcting locale creates no customer message'
);

reset role;

select is(
  (
    select jsonb_build_object(
      'status', refund_case.status,
      'decision', refund_case.decision,
      'refundCompletedAt', refund_case.refund_completed_at,
      'reportingAdjustmentId', refund_case.reporting_adjustment_id,
      'nayaxRefundExecutionStatus', refund_case.nayax_refund_execution_status,
      'officialActionVersion', refund_case.official_action_version
    )
    from public.refund_cases refund_case
    where refund_case.id = 'b9140000-0000-4000-8000-000000000001'
  ),
  (
    select jsonb_build_object(
      'status', snapshot.status,
      'decision', snapshot.decision,
      'refundCompletedAt', snapshot.refund_completed_at,
      'reportingAdjustmentId', snapshot.reporting_adjustment_id,
      'nayaxRefundExecutionStatus', snapshot.nayax_refund_execution_status,
      'officialActionVersion', snapshot.official_action_version
    )
    from pg_temp.locale_case_state_before snapshot
  ),
  'Locale correction changes no decision, payment, provider, reporting, or official-action state'
);

select is(
  public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000001'
  ) ->> 'source',
  'manager_correction',
  'The projection shows manager-reviewed provenance after correction'
);

select is(
  (public.refund_customer_locale_contract(
    'b9140000-0000-4000-8000-000000000001'
  ) ->> 'version')::bigint,
  1::bigint,
  'The projection exposes the current locale version'
);

set local role authenticated;
select pg_temp.set_auth_claims('b9100000-0000-4000-8000-000000000001');

select is(
  (public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 0, 'es',
    'reviewed_customer_request_language'
  ) ->> 'replayed')::boolean,
  true,
  'Replaying the same locale operation is explicitly idempotent'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events event
    where event.refund_case_id = 'b9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_locale_corrected'
  ),
  1,
  'A replay cannot duplicate the locale audit event'
);

select is(
  (public.admin_correct_refund_customer_locale(
    'b9140000-0000-4000-8000-000000000001', 1, 1, 'en',
    'customer_confirmed_language'
  ) ->> 'localeVersion')::bigint,
  2::bigint,
  'A later reviewed correction advances its independent locale version'
);

select is(
  (
    select count(*)::integer
    from public.refund_case_events event
    where event.refund_case_id = 'b9140000-0000-4000-8000-000000000001'
      and event.event_type = 'customer_locale_corrected'
  ),
  2,
  'A genuinely later correction retains a second immutable audit event'
);

select is(
  public.admin_get_refund_operations_overview()
    ->> 'customerLocaleContractVersion',
  'refund_customer_locale_v1',
  'The overview versions the customer-locale contract'
);

select ok(
  (
    select item.case_json -> 'customerLocale' ->> 'locale' = 'en'
      and (item.case_json -> 'customerLocale' ->> 'version')::bigint = 2
      and item.case_json -> 'customerLocale' ->> 'source' = 'manager_correction'
      and (item.case_json -> 'customerLocale' ->> 'payloadRedacted')::boolean
    from jsonb_array_elements(
      public.admin_get_refund_operations_overview() -> 'cases'
    ) item(case_json)
    where item.case_json ->> 'id' = 'b9140000-0000-4000-8000-000000000001'
  ),
  'The actor-scoped manager overview publishes the current redacted locale contract'
);

select * from finish();
rollback;
