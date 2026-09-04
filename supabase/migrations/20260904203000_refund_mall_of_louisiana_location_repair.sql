-- #890/#1109: add the missing customer-safe Mall of Louisiana location while
-- keeping provider access, Sunze reporting, refund execution and customer
-- communication outside this repair.

create function public.ensure_refund_mall_of_louisiana_catalog()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cohort_labels constant text[] := array[
    'Altamonte Mall', 'Asheville Mall', 'Carolina Place', 'Columbiana Centre',
    'Commerce Tanger Outlet', 'Gonzales Tanger Outlet', 'Locust Grove Tanger Outlet',
    'Nashville Tanger Outlets', 'Norfolk Premium Outlets', 'Oakwood Mall Gretna',
    'Southridge Mall', 'Uptown Christiansburg'
  ];
  cohort_count integer;
  cohort_account_count integer;
  cohort_manager_count integer;
  cohort_manager_identity_count integer;
  cohort_account_id uuid;
  cohort_manager public.reporting_machine_refund_managers%rowtype;
  target_location public.reporting_locations%rowtype;
  target_machine public.reporting_machines%rowtype;
  target_location_count integer;
  target_machine_count integer;
  target_manager_count integer;
  created_location boolean := false;
  created_machine boolean := false;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund_catalog:mall_of_louisiana', 890)
  );

  select count(*)::integer, count(distinct machine.account_id)::integer
  into cohort_count, cohort_account_count
  from public.reporting_machines machine
  where machine.refund_public_display_label = any(cohort_labels);

  -- Empty disposable databases have no production inventory. Any partial
  -- production-like cohort is a hard stop rather than a reason to guess.
  if cohort_count = 0 then
    return jsonb_build_object(
      'status', 'skipped_no_cohort',
      'catalogCreated', false,
      'providerAccessChanged', false,
      'sourceMappingChanged', false,
      'payloadRedacted', true
    );
  end if;
  if cohort_count <> 12 or cohort_account_count <> 1 then
    raise exception 'Exact single-account Adam manual cohort required'
      using errcode = 'P4680';
  end if;

  select machine.account_id
  into cohort_account_id
  from public.reporting_machines machine
  where machine.refund_public_display_label = any(cohort_labels)
  limit 1;

  if exists (
    select 1
    from unnest(cohort_labels) expected(label)
    where 1 <> (
      select count(*)
      from public.reporting_machines machine
      where machine.refund_public_display_label = expected.label
        and machine.account_id = cohort_account_id
        and machine.status = 'active'
        and machine.machine_type in ('commercial', 'mini')
        and machine.nayax_machine_id is null
        and machine.nayax_account_key is null
        and machine.nayax_refunds_enabled is false
        and machine.nayax_manual_portal_enabled is true
        and machine.nayax_manual_account_scope = 'bloomjoy_nc_adam'
        and machine.nayax_manual_portal_timezone in (
          'America/New_York', 'America/Chicago'
        )
    )
  ) then
    raise exception 'Complete active payment-disabled Adam manual cohort required'
      using errcode = 'P4680';
  end if;

  select
    count(*)::integer,
    count(distinct (mapping.manager_user_id, lower(btrim(mapping.manager_email))))::integer
  into cohort_manager_count, cohort_manager_identity_count
  from public.reporting_machine_refund_managers mapping
  join public.reporting_machines machine
    on machine.id = mapping.reporting_machine_id
  where machine.refund_public_display_label = any(cohort_labels)
    and mapping.status = 'active'
    and mapping.revoked_at is null;

  if cohort_manager_count <> 12 or cohort_manager_identity_count <> 1 then
    raise exception 'One shared sole current manager is required for the manual cohort'
      using errcode = 'P4680';
  end if;

  select mapping.*
  into cohort_manager
  from public.reporting_machine_refund_managers mapping
  join public.reporting_machines machine
    on machine.id = mapping.reporting_machine_id
  where machine.refund_public_display_label = cohort_labels[1]
    and mapping.status = 'active'
    and mapping.revoked_at is null;

  select count(*)::integer
  into target_location_count
  from public.reporting_locations location
  where location.account_id = cohort_account_id
    and lower(btrim(location.name)) = 'mall of louisiana';

  if target_location_count > 1 then
    raise exception 'Mall of Louisiana location must be unique within the cohort account'
      using errcode = 'P4680';
  elsif target_location_count = 0 then
    insert into public.reporting_locations (
      account_id, name, city, state, timezone, status, notes
    ) values (
      cohort_account_id,
      'Mall of Louisiana',
      'Baton Rouge',
      'LA',
      'America/Chicago',
      'active',
      'Customer-safe refund location; provider clock and source-sales mapping remain unverified.'
    ) returning * into target_location;
    created_location := true;
  else
    select * into target_location
    from public.reporting_locations location
    where location.account_id = cohort_account_id
      and lower(btrim(location.name)) = 'mall of louisiana';
    if target_location.name is distinct from 'Mall of Louisiana'
      or target_location.city is distinct from 'Baton Rouge'
      or target_location.state is distinct from 'LA'
      or target_location.timezone is distinct from 'America/Chicago'
      or target_location.status is distinct from 'active' then
      raise exception 'Existing Mall of Louisiana location conflicts with reviewed facts'
        using errcode = 'P4680';
    end if;
  end if;

  select count(*)::integer
  into target_machine_count
  from public.reporting_machines machine
  where machine.account_id = cohort_account_id
    and (
      lower(btrim(machine.machine_label)) = 'mall of louisiana'
      or lower(btrim(coalesce(machine.refund_public_display_label, ''))) =
        'mall of louisiana'
    );

  if target_machine_count > 1 then
    raise exception 'Mall of Louisiana machine must be unique within the cohort account'
      using errcode = 'P4680';
  elsif target_machine_count = 0 then
    insert into public.reporting_machines (
      account_id, location_id, machine_label, machine_type, sunze_machine_id,
      status, nayax_machine_id, nayax_account_key, nayax_refunds_enabled,
      refund_intake_enabled, refund_public_display_label,
      nayax_manual_portal_enabled, nayax_manual_account_scope,
      nayax_manual_portal_timezone, notes
    ) values (
      cohort_account_id,
      target_location.id,
      'Mall of Louisiana',
      'commercial',
      null,
      'active',
      null,
      null,
      false,
      false,
      'Mall of Louisiana',
      true,
      'bloomjoy_nc_adam',
      'America/Chicago',
      'Manual refund route only; provider identity and source-sales mapping intentionally unset.'
    ) returning * into target_machine;
    created_machine := true;
  else
    select * into target_machine
    from public.reporting_machines machine
    where machine.account_id = cohort_account_id
      and (
        lower(btrim(machine.machine_label)) = 'mall of louisiana'
        or lower(btrim(coalesce(machine.refund_public_display_label, ''))) =
          'mall of louisiana'
      );
    if target_machine.location_id is distinct from target_location.id
      or target_machine.machine_label is distinct from 'Mall of Louisiana'
      or target_machine.machine_type is distinct from 'commercial'
      or target_machine.status is distinct from 'active'
      or target_machine.sunze_machine_id is not null
      or target_machine.nayax_machine_id is not null
      or target_machine.nayax_account_key is not null
      or target_machine.nayax_refunds_enabled is distinct from false
      or target_machine.refund_intake_enabled is distinct from false
      or target_machine.refund_public_display_label is distinct from 'Mall of Louisiana'
      or target_machine.nayax_manual_portal_enabled is distinct from true
      or target_machine.nayax_manual_account_scope is distinct from 'bloomjoy_nc_adam'
      or target_machine.nayax_manual_portal_timezone is distinct from 'America/Chicago' then
      raise exception 'Existing Mall of Louisiana machine conflicts with reviewed safe scope'
        using errcode = 'P4680';
    end if;
  end if;

  select count(*)::integer
  into target_manager_count
  from public.reporting_machine_refund_managers mapping
  where mapping.reporting_machine_id = target_machine.id
    and mapping.status = 'active'
    and mapping.revoked_at is null;

  if target_manager_count = 0 then
    insert into public.reporting_machine_refund_managers (
      reporting_machine_id, manager_user_id, manager_email, status,
      grant_reason, granted_by
    ) values (
      target_machine.id,
      cohort_manager.manager_user_id,
      cohort_manager.manager_email,
      'active',
      'Reviewed Mall of Louisiana refund route',
      cohort_manager.granted_by
    );
  elsif target_manager_count <> 1 or not exists (
    select 1
    from public.reporting_machine_refund_managers mapping
    where mapping.reporting_machine_id = target_machine.id
      and mapping.manager_user_id = cohort_manager.manager_user_id
      and lower(btrim(mapping.manager_email)) =
        lower(btrim(cohort_manager.manager_email))
      and mapping.status = 'active'
      and mapping.revoked_at is null
  ) then
    raise exception 'Mall of Louisiana must retain the cohort sole-manager route'
      using errcode = 'P4680';
  end if;

  if (select count(*) from public.public_refund_selections() selection
      where selection.display_label = 'Mall of Louisiana'
        and selection.selection_kind = 'exact_machine') <> 1 then
    raise exception 'Mall of Louisiana must be one unique exact public selection'
      using errcode = 'P4680';
  end if;

  if created_machine then
    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, before, after, meta
    ) values (
      null,
      'reporting_machine.refund_catalog_location_added',
      'reporting_machine',
      target_machine.id::text,
      '{}'::jsonb,
      jsonb_build_object(
        'location_name', 'Mall of Louisiana',
        'city', 'Baton Rouge',
        'state', 'LA',
        'timezone', 'America/Chicago',
        'manual_account_scope', 'bloomjoy_nc_adam',
        'provider_identity_present', false,
        'source_mapping_present', false
      ),
      jsonb_build_object(
        'policy', 'refund_customer_catalog_location_repair_v1',
        'location_created', created_location,
        'payment_enabled', false,
        'payload_redacted', true
      )
    );
  end if;

  return jsonb_build_object(
    'status', case when created_machine then 'created' else 'already_present' end,
    'locationId', target_location.id,
    'machineId', target_machine.id,
    'catalogCreated', created_machine,
    'providerAccessChanged', false,
    'sourceMappingChanged', false,
    'paymentEnabled', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.ensure_refund_mall_of_louisiana_catalog()
  from public, anon, authenticated, service_role;

select public.ensure_refund_mall_of_louisiana_catalog();

create function public.refund_location_binding_case_digest(p_case_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(
    extensions.digest(convert_to(to_jsonb(refund_case)::text, 'UTF8'), 'sha256'),
    'hex'
  )
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;
$$;

revoke all on function public.refund_location_binding_case_digest(uuid)
  from public, anon, authenticated, service_role;

create function public.service_refund_location_binding_correction_context(
  p_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  source_machine public.reporting_machines%rowtype;
  target_machine public.reporting_machines%rowtype;
  target_location public.reporting_locations%rowtype;
  message_count integer;
  candidate_count integer;
  attempt_count integer;
  receipt_count integer;
  adjustment_count integer;
begin
  select * into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;
  if case_row.id is null then
    return jsonb_build_object(
      'status', 'not_found', 'eligible', false, 'payloadRedacted', true
    );
  end if;

  select * into source_machine
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id;
  select machine, location
  into target_machine, target_location
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.account_id = source_machine.account_id
    and machine.machine_label = 'Mall of Louisiana'
    and machine.refund_public_display_label = 'Mall of Louisiana'
  limit 1;

  select count(*)::integer into message_count
  from public.refund_case_messages message where message.refund_case_id = case_row.id;
  select count(*)::integer into candidate_count
  from public.refund_nayax_lookup_candidates candidate where candidate.refund_case_id = case_row.id;
  select count(*)::integer into attempt_count
  from public.refund_case_nayax_refund_attempts attempt where attempt.refund_case_id = case_row.id;
  select count(*)::integer into receipt_count
  from public.refund_authoritative_receipts receipt where receipt.refund_case_id = case_row.id;
  select count(*)::integer into adjustment_count
  from public.sales_adjustment_facts adjustment where adjustment.refund_case_id = case_row.id;

  return jsonb_build_object(
    'status', 'review_required',
    'caseId', case_row.id,
    'expectedCaseVersion', case_row.official_action_version,
    'expectedFactVersion', case_row.deterministic_fact_version,
    'expectedSourceMachineId', case_row.reporting_machine_id,
    'expectedSourceLocationId', case_row.reporting_location_id,
    'caseDigest', public.refund_location_binding_case_digest(case_row.id),
    'customerLocationEvidencePresent',
      position('mall of louisiana' in lower(case_row.issue_summary)) > 0
      and position('baton rouge' in lower(case_row.issue_summary)) > 0,
    'targetCatalogReady',
      target_machine.id is not null
      and target_location.id is not null
      and target_location.timezone = 'America/Chicago'
      and target_machine.sunze_machine_id is null
      and target_machine.nayax_machine_id is null
      and target_machine.nayax_account_key is null
      and target_machine.nayax_refunds_enabled is false
      and target_machine.nayax_manual_portal_enabled is true
      and target_machine.nayax_manual_account_scope = 'bloomjoy_nc_adam'
      and target_machine.nayax_manual_portal_timezone = 'America/Chicago',
    'eligible',
      case_row.status = 'needs_review'
      and case_row.case_population = 'customer'
      and case_row.payment_method = 'card'
      and case_row.decision is null
      and case_row.duplicate_of_refund_case_id is null
      and case_row.refund_completed_at is null
      and case_row.reporting_adjustment_id is null
      and case_row.matched_sales_fact_id is null
      and case_row.matched_nayax_transaction_id is null
      and case_row.nayax_refund_execution_status = 'not_requested'
      and source_machine.machine_label = 'Gonzales Tanger Outlet'
      and case_row.intake_selection_kind = 'exact_machine'
      and case_row.intake_selection_machine_ids = array[case_row.reporting_machine_id]
      and position('mall of louisiana' in lower(case_row.issue_summary)) > 0
      and position('baton rouge' in lower(case_row.issue_summary)) > 0
      and target_machine.id is not null
      and target_location.id is not null
      and candidate_count = 0
      and attempt_count = 0
      and receipt_count = 0
      and adjustment_count = 0,
    'messageCount', message_count,
    'candidateCount', candidate_count,
    'attemptCount', attempt_count,
    'receiptCount', receipt_count,
    'adjustmentCount', adjustment_count,
    'providerCallMade', false,
    'customerMessageCreated', false,
    'paymentAction', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_refund_location_binding_correction_context(uuid)
  from public, anon, authenticated;
grant execute on function public.service_refund_location_binding_correction_context(uuid)
  to service_role;

create function public.guard_refund_location_binding_correction_event()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op <> 'INSERT' and old.event_type = 'location_binding_corrected')
    or (
      tg_op <> 'DELETE'
      and new.event_type = 'location_binding_corrected'
      and (tg_op <> 'INSERT' or current_user in ('anon', 'authenticated', 'service_role'))
    ) then
    raise exception 'Location-binding correction evidence is immutable and requires its service path'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.guard_refund_location_binding_correction_event()
  from public, anon, authenticated, service_role;
create trigger refund_case_events_guard_location_binding_correction
before insert or update or delete on public.refund_case_events
for each row execute function public.guard_refund_location_binding_correction_event();

create unique index refund_location_binding_correction_once
  on public.refund_case_events (refund_case_id)
  where event_type = 'location_binding_corrected'
    and metadata ->> 'policy' = 'customer_reported_location_binding_v1';

create function public.service_correct_refund_location_binding(
  p_case_id uuid,
  p_expected_case_digest text,
  p_expected_case_version bigint,
  p_expected_fact_version bigint,
  p_expected_source_machine_id uuid,
  p_expected_source_location_id uuid,
  p_reviewed_existing_customer_report boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
  updated_case public.refund_cases%rowtype;
  source_machine public.reporting_machines%rowtype;
  target_machine public.reporting_machines%rowtype;
  target_location public.reporting_locations%rowtype;
  prior_event public.refund_case_events%rowtype;
  message_count integer;
  candidate_count integer;
  attempt_count integer;
  receipt_count integer;
  adjustment_count integer;
  event_count integer;
begin
  if p_case_id is null
    or p_expected_case_digest is null
    or p_expected_case_digest !~ '^[a-f0-9]{64}$'
    or p_expected_case_version is null or p_expected_case_version < 1
    or p_expected_fact_version is null or p_expected_fact_version < 1
    or p_expected_source_machine_id is null
    or p_expected_source_location_id is null
    or p_reviewed_existing_customer_report is distinct from true then
    raise exception 'Exact private review inputs are required' using errcode = 'P4681';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund_location_binding:' || p_case_id::text, 890)
  );
  select * into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;
  if case_row.id is null then
    raise exception 'Exact current refund case required' using errcode = 'P4681';
  end if;

  select * into prior_event
  from public.refund_case_events event
  where event.refund_case_id = case_row.id
    and event.event_type = 'location_binding_corrected'
    and event.metadata ->> 'policy' = 'customer_reported_location_binding_v1';
  if prior_event.id is not null then
    if prior_event.metadata ->> 'source_case_digest' is distinct from p_expected_case_digest
      or case_row.reporting_machine_id::text is distinct from
        prior_event.metadata ->> 'new_machine_id'
      or case_row.reporting_location_id::text is distinct from
        prior_event.metadata ->> 'new_location_id'
      or case_row.incident_timezone is distinct from 'America/Chicago' then
      raise exception 'A different location correction is already recorded'
        using errcode = 'P4681';
    end if;
    return jsonb_build_object(
      'status', 'already_corrected',
      'caseId', case_row.id,
      'caseIdentityPreserved', true,
      'providerCallMade', false,
      'customerMessageCreated', false,
      'refundAttemptCreated', false,
      'receiptCreated', false,
      'adjustmentCreated', false,
      'paymentAction', false,
      'payloadRedacted', true
    );
  end if;

  select * into source_machine
  from public.reporting_machines machine
  where machine.id = case_row.reporting_machine_id;
  select machine, location
  into target_machine, target_location
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.account_id = source_machine.account_id
    and machine.machine_label = 'Mall of Louisiana'
    and machine.refund_public_display_label = 'Mall of Louisiana'
  limit 1;

  select count(*)::integer into message_count
  from public.refund_case_messages message where message.refund_case_id = case_row.id;
  select count(*)::integer into candidate_count
  from public.refund_nayax_lookup_candidates candidate where candidate.refund_case_id = case_row.id;
  select count(*)::integer into attempt_count
  from public.refund_case_nayax_refund_attempts attempt where attempt.refund_case_id = case_row.id;
  select count(*)::integer into receipt_count
  from public.refund_authoritative_receipts receipt where receipt.refund_case_id = case_row.id;
  select count(*)::integer into adjustment_count
  from public.sales_adjustment_facts adjustment where adjustment.refund_case_id = case_row.id;
  select count(*)::integer into event_count
  from public.refund_case_events event where event.refund_case_id = case_row.id;

  if public.refund_location_binding_case_digest(case_row.id) is distinct from
      p_expected_case_digest
    or case_row.official_action_version is distinct from p_expected_case_version
    or case_row.deterministic_fact_version is distinct from p_expected_fact_version
    or case_row.reporting_machine_id is distinct from p_expected_source_machine_id
    or case_row.reporting_location_id is distinct from p_expected_source_location_id
    or case_row.status is distinct from 'needs_review'
    or case_row.case_population is distinct from 'customer'
    or case_row.payment_method is distinct from 'card'
    or case_row.decision is not null
    or case_row.duplicate_of_refund_case_id is not null
    or case_row.refund_completed_at is not null
    or case_row.reporting_adjustment_id is not null
    or case_row.matched_sales_fact_id is not null
    or case_row.matched_nayax_transaction_id is not null
    or case_row.nayax_refund_execution_status is distinct from 'not_requested'
    or source_machine.id is null
    or source_machine.machine_label is distinct from 'Gonzales Tanger Outlet'
    or source_machine.location_id is distinct from case_row.reporting_location_id
    or source_machine.account_id is distinct from target_machine.account_id
    or source_machine.nayax_manual_portal_enabled is distinct from true
    or source_machine.nayax_manual_account_scope is distinct from 'bloomjoy_nc_adam'
    or source_machine.nayax_manual_portal_timezone is distinct from 'America/Chicago'
    or target_machine.id is null
    or target_location.id is null
    or target_location.city is distinct from 'Baton Rouge'
    or target_location.state is distinct from 'LA'
    or target_location.timezone is distinct from 'America/Chicago'
    or target_location.status is distinct from 'active'
    or target_machine.location_id is distinct from target_location.id
    or target_machine.status is distinct from 'active'
    or target_machine.machine_type is distinct from 'commercial'
    or target_machine.sunze_machine_id is not null
    or target_machine.nayax_machine_id is not null
    or target_machine.nayax_account_key is not null
    or target_machine.nayax_refunds_enabled is distinct from false
    or target_machine.nayax_manual_portal_enabled is distinct from true
    or target_machine.nayax_manual_account_scope is distinct from 'bloomjoy_nc_adam'
    or target_machine.nayax_manual_portal_timezone is distinct from 'America/Chicago'
    or case_row.intake_selection_kind is distinct from 'exact_machine'
    or case_row.intake_selection_key is distinct from
      public.refund_public_selection_key('machine|' || source_machine.id::text)
    or case_row.intake_selection_machine_ids is distinct from array[source_machine.id]
    or position('mall of louisiana' in lower(case_row.issue_summary)) = 0
    or position('baton rouge' in lower(case_row.issue_summary)) = 0
    or candidate_count <> 0
    or attempt_count <> 0
    or receipt_count <> 0
    or adjustment_count <> 0
    or (select count(*) from public.reporting_machine_refund_managers mapping
        where mapping.reporting_machine_id = source_machine.id
          and mapping.status = 'active' and mapping.revoked_at is null) <> 1
    or (select count(*) from public.reporting_machine_refund_managers mapping
        where mapping.reporting_machine_id = target_machine.id
          and mapping.status = 'active' and mapping.revoked_at is null) <> 1
    or exists (
      (select mapping.manager_user_id
       from public.reporting_machine_refund_managers mapping
       where mapping.reporting_machine_id = source_machine.id
         and mapping.status = 'active' and mapping.revoked_at is null)
      except
      (select mapping.manager_user_id
       from public.reporting_machine_refund_managers mapping
       where mapping.reporting_machine_id = target_machine.id
         and mapping.status = 'active' and mapping.revoked_at is null)
    ) then
    raise exception 'Exact unresolved customer-reported location correction required'
      using errcode = 'P4681';
  end if;

  update public.refund_cases refund_case
  set
    reporting_machine_id = target_machine.id,
    reporting_location_id = target_location.id,
    incident_timezone = 'America/Chicago',
    intake_selection_key = public.refund_public_selection_key(
      'machine|' || target_machine.id::text
    ),
    intake_selection_kind = 'exact_machine',
    intake_selection_machine_ids = array[target_machine.id],
    intake_meta = coalesce(refund_case.intake_meta, '{}'::jsonb) ||
      jsonb_build_object(
        'location_binding_correction', jsonb_build_object(
          'policy', 'customer_reported_location_binding_v1',
          'evidence_source', 'existing_customer_submission',
          'normalized_location', 'Mall of Louisiana',
          'normalized_city', 'Baton Rouge',
          'normalized_state', 'LA',
          'previous_machine_id', source_machine.id,
          'previous_location_id', case_row.reporting_location_id,
          'source_case_digest', p_expected_case_digest,
          'raw_submission_unchanged', true,
          'corrected_at', statement_timestamp()
        )
      ),
    updated_at = statement_timestamp()
  where refund_case.id = case_row.id
  returning * into updated_case;

  if updated_case.id is distinct from case_row.id
    or updated_case.public_reference is distinct from case_row.public_reference
    or updated_case.customer_email is distinct from case_row.customer_email
    or updated_case.customer_name is distinct from case_row.customer_name
    or updated_case.customer_phone is distinct from case_row.customer_phone
    or updated_case.issue_summary is distinct from case_row.issue_summary
    or updated_case.incident_at is distinct from case_row.incident_at
    or updated_case.incident_local_datetime is distinct from case_row.incident_local_datetime
    or updated_case.payment_amount_cents is distinct from case_row.payment_amount_cents
    or updated_case.card_last4 is distinct from case_row.card_last4
    or updated_case.official_action_version <> case_row.official_action_version + 1
    or updated_case.deterministic_fact_version <> case_row.deterministic_fact_version + 1
    or updated_case.nayax_lookup_status is distinct from 'not_started'
    or updated_case.nayax_lookup_retry_count <> 0
    or updated_case.nayax_lookup_retry_fact_version is distinct from
      updated_case.deterministic_fact_version
    or updated_case.nayax_lookup_started_at is not null
    or updated_case.nayax_lookup_finished_at is not null
    or updated_case.nayax_lookup_safe_retry_eligible is distinct from false
    or updated_case.nayax_lookup_correlation_digest is not null then
    raise exception 'Case identity, raw submission or lookup invalidation changed unexpectedly'
      using errcode = 'P4681';
  end if;

  if message_count <> (select count(*) from public.refund_case_messages where refund_case_id = case_row.id)
    or candidate_count <> (select count(*) from public.refund_nayax_lookup_candidates where refund_case_id = case_row.id)
    or attempt_count <> (select count(*) from public.refund_case_nayax_refund_attempts where refund_case_id = case_row.id)
    or receipt_count <> (select count(*) from public.refund_authoritative_receipts where refund_case_id = case_row.id)
    or adjustment_count <> (select count(*) from public.sales_adjustment_facts where refund_case_id = case_row.id) then
    raise exception 'Location correction created an unauthorized side effect'
      using errcode = 'P4681';
  end if;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  ) values (
    case_row.id,
    null,
    'location_binding_corrected',
    'Refund Operations corrected the existing customer-reported location binding. No message or payment was issued.',
    jsonb_build_object(
      'policy', 'customer_reported_location_binding_v1',
      'source_case_digest', p_expected_case_digest,
      'old_machine_id', source_machine.id,
      'old_location_id', case_row.reporting_location_id,
      'new_machine_id', target_machine.id,
      'new_location_id', target_location.id,
      'prior_case_version', case_row.official_action_version,
      'resulting_case_version', updated_case.official_action_version,
      'prior_fact_version', case_row.deterministic_fact_version,
      'resulting_fact_version', updated_case.deterministic_fact_version,
      'raw_submission_unchanged', true,
      'customer_message_created', false,
      'provider_call_made', false,
      'refund_attempt_created', false,
      'receipt_created', false,
      'adjustment_created', false,
      'payment_action', false,
      'payload_redacted', true
    )
  );

  if event_count + 1 <> (
    select count(*) from public.refund_case_events where refund_case_id = case_row.id
  ) then
    raise exception 'Exactly one redacted correction event is required'
      using errcode = 'P4681';
  end if;

  return jsonb_build_object(
    'status', 'corrected',
    'caseId', updated_case.id,
    'caseIdentityPreserved', true,
    'caseVersion', updated_case.official_action_version,
    'factVersion', updated_case.deterministic_fact_version,
    'lookupInvalidated', true,
    'customerMessageCreated', false,
    'providerCallMade', false,
    'refundAttemptCreated', false,
    'receiptCreated', false,
    'adjustmentCreated', false,
    'paymentAction', false,
    'payloadRedacted', true
  );
end;
$$;

revoke all on function public.service_correct_refund_location_binding(
  uuid, text, bigint, bigint, uuid, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.service_correct_refund_location_binding(
  uuid, text, bigint, bigint, uuid, uuid, boolean
) to service_role;

comment on function public.service_correct_refund_location_binding(
  uuid, text, bigint, bigint, uuid, uuid, boolean
) is
  'Private, digest-bound same-case correction for the reviewed Mall of Louisiana catalog gap. It invalidates lookup facts and cannot message a customer, call a provider, create a refund attempt/receipt/adjustment, or issue payment.';

select pg_notify('pgrst', 'reload schema');
