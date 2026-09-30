-- #1370: a reporting-account move must not strand research for the exact
-- machine selected at intake. Reuse the existing reviewed binding correction;
-- do not relax the lookup begin guard or authorize a financial operation.
alter function public.service_refund_location_binding_correction_context(uuid)
  rename to service_refund_location_binding_context_pre_catalog_move_v1;
revoke all on function public.service_refund_location_binding_context_pre_catalog_move_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.service_refund_location_binding_correction_context(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases;
  m public.reporting_machines;
  original_location public.reporting_locations;
  current_location public.reporting_locations;
  inventory public.refund_nayax_machine_inventory;
  move public.admin_audit_log;
  eligible boolean;
  digest text;
begin
  select * into c from public.refund_cases where id=p_case_id;
  select * into m from public.reporting_machines where id=c.reporting_machine_id;
  if c.id is null or m.id is null or m.location_id=c.reporting_location_id then
    return public.service_refund_location_binding_context_pre_catalog_move_v1(p_case_id);
  end if;
  select * into original_location from public.reporting_locations where id=c.reporting_location_id;
  select * into current_location from public.reporting_locations where id=m.location_id;
  select * into inventory from public.refund_nayax_machine_inventory
    where reporting_machine_id=m.id and nayax_machine_id=m.nayax_machine_id
      and account_key=m.nayax_account_key;
  select * into move from public.admin_audit_log a
    where a.entity_id=m.id::text and a.action='reporting_machine.upserted'
      and a.before->>'location_id'=c.reporting_location_id::text
      and a.after->>'location_id'=m.location_id::text
      and a.before->>'account_id'=original_location.account_id::text
      and a.after->>'account_id'=m.account_id::text
      and a.before->>'nayax_machine_id'=m.nayax_machine_id
      and a.after->>'nayax_machine_id'=m.nayax_machine_id
      and a.before->>'nayax_account_key'=m.nayax_account_key
      and a.after->>'nayax_account_key'=m.nayax_account_key
      and a.created_at>c.created_at
    order by a.created_at desc,a.id desc limit 1;
  if move.id is null then
    return public.service_refund_location_binding_context_pre_catalog_move_v1(p_case_id);
  end if;
  eligible:=coalesce(
    c.case_population='customer' and c.payment_method='card'
    and c.status in ('submitted','needs_review','correlated','approved')
    and (c.decision is null or c.decision='approved')
    and c.intake_selection_kind='exact_machine'
    and c.intake_selection_machine_ids=array[m.id]
    and c.intake_selection_key=public.refund_public_selection_key('machine|'||m.id::text)
    and c.incident_at is not null and c.incident_local_datetime is not null
    and c.incident_timezone=original_location.timezone
    and original_location.status='active' and current_location.status='active'
    and original_location.name=current_location.name
    and current_location.account_id=m.account_id
    and (current_location.timezone=original_location.timezone or
      (current_location.timezone='America/Los_Angeles'
        and current_location.city is null and current_location.state is null))
    and m.status='active' and m.nayax_manual_portal_enabled is not true
    and inventory.provider_is_active and inventory.reconciliation_state='published'
    and inventory.missing_successful_snapshots=0
    and c.matched_nayax_transaction_id is null and c.matched_sales_fact_id is null
    and c.nayax_refund_execution_status='not_requested'
    and c.refund_completed_at is null and c.reporting_adjustment_id is null
    and c.manual_refund_reference is null and c.duplicate_of_refund_case_id is null
    and not public.refund_case_has_unresolved_reconciliation(c.id)
    and not exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    and not exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=c.id)
    and (c.decision is null or (
      c.nayax_lookup_status='manual_exception'
      and c.nayax_lookup_started_at is not null and c.nayax_lookup_finished_at is not null
      and c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$'
      and nullif(c.nayax_recommendation_policy_version,'') is not null
      and c.nayax_recommendation_policy_version<>'manual-nayax-portal-v1'
      and not exists(select 1 from public.refund_case_events e where e.refund_case_id=c.id
        and e.event_type in('manual_nayax_evidence_entered','nayax_match_preselection_disputed')
        and e.created_at>=c.nayax_lookup_finished_at)))
    and not exists(select 1 from public.refund_nayax_lookup_candidates k
      where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
        and k.expires_at>statement_timestamp()),false);
  digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    to_jsonb(c),to_jsonb(m),to_jsonb(original_location),to_jsonb(current_location),
    to_jsonb(inventory),move.id,move.before,move.after)::text,'UTF8'),'sha256'),'hex');
  return jsonb_build_object('status','review_required','correctionKind','same_machine_catalog_move',
    'eligible',eligible,'caseId',c.id,'expectedCaseVersion',c.official_action_version,
    'expectedFactVersion',c.deterministic_fact_version,'expectedSourceMachineId',m.id,
    'expectedSourceLocationId',c.reporting_location_id,'targetLocationId',m.location_id,
    'caseDigest',digest,'preservedIncidentTimezone',c.incident_timezone,
    'providerCallMade',false,'customerMessageCreated',false,'paymentAction',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_refund_location_binding_correction_context(uuid)
  from public,anon,authenticated;
grant execute on function public.service_refund_location_binding_correction_context(uuid) to service_role;

alter function public.service_correct_refund_location_binding(uuid,text,bigint,bigint,uuid,uuid,boolean)
  rename to service_correct_refund_location_binding_pre_catalog_move_v1;
revoke all on function public.service_correct_refund_location_binding_pre_catalog_move_v1(
  uuid,text,bigint,bigint,uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function public.service_correct_refund_location_binding(
  p_case_id uuid,p_expected_case_digest text,p_expected_case_version bigint,
  p_expected_fact_version bigint,p_expected_source_machine_id uuid,
  p_expected_source_location_id uuid,p_reviewed_existing_customer_report boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases;
  updated public.refund_cases;
  m public.reporting_machines;
  source public.reporting_locations;
  target public.reporting_locations;
  context jsonb;
  prior public.refund_case_events;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'refund-nayax-lookup-v1|'||p_case_id::text,0));
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into prior from public.refund_case_events e where e.refund_case_id=p_case_id
    and e.event_type='location_binding_corrected'
    and e.metadata->>'correction_kind'='same_machine_catalog_move';
  if prior.id is not null then
    if prior.metadata->>'source_case_digest'=p_expected_case_digest
      and c.reporting_machine_id::text=prior.metadata->>'new_machine_id'
      and c.reporting_location_id::text=prior.metadata->>'new_location_id' then
      return jsonb_build_object('status','already_corrected','caseId',c.id,'payloadRedacted',true);
    end if;
    raise exception 'Different catalog binding correction already recorded' using errcode='P4681';
  end if;
  select * into m from public.reporting_machines where id=c.reporting_machine_id for update;
  -- Use a stable lock order for shared catalog locations.
  perform 1 from public.reporting_locations where id in(c.reporting_location_id,m.location_id)
    order by id for update;
  select * into source from public.reporting_locations where id=c.reporting_location_id;
  select * into target from public.reporting_locations where id=m.location_id;
  perform 1 from public.refund_nayax_machine_inventory where reporting_machine_id=m.id for update;
  context:=public.service_refund_location_binding_correction_context(p_case_id);
  if context->>'correctionKind' is distinct from 'same_machine_catalog_move' then
    return public.service_correct_refund_location_binding_pre_catalog_move_v1(
      p_case_id,p_expected_case_digest,p_expected_case_version,p_expected_fact_version,
      p_expected_source_machine_id,p_expected_source_location_id,p_reviewed_existing_customer_report);
  end if;
  if p_reviewed_existing_customer_report is distinct from true
    or context->>'eligible' is distinct from 'true'
    or context->>'caseDigest' is distinct from p_expected_case_digest
    or c.official_action_version is distinct from p_expected_case_version
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or c.reporting_machine_id is distinct from p_expected_source_machine_id
    or c.reporting_location_id is distinct from p_expected_source_location_id then
    raise exception 'Exact reviewed catalog-move context required' using errcode='P4681';
  end if;
  -- Preserve the venue clock from the original exact-machine intake. The new
  -- account's empty/default catalog row is not customer timezone evidence.
  update public.reporting_locations set timezone=source.timezone,
    city=coalesce(target.city,source.city),state=coalesce(target.state,source.state)
    where id=target.id;
  update public.refund_cases set reporting_location_id=target.id,
    intake_meta=coalesce(intake_meta,'{}'::jsonb)||jsonb_build_object('location_binding_correction',
      jsonb_build_object('policy','customer_reported_location_binding_v1',
        'correction_kind','same_machine_catalog_move','previous_location_id',source.id,
        'source_case_digest',p_expected_case_digest,'raw_submission_unchanged',true)),
    updated_at=statement_timestamp()
    where id=c.id returning * into updated;
  if updated.reporting_machine_id is distinct from c.reporting_machine_id
    or updated.incident_at is distinct from c.incident_at
    or updated.incident_local_datetime is distinct from c.incident_local_datetime
    or updated.incident_timezone is distinct from c.incident_timezone
    or updated.intake_selection_key is distinct from c.intake_selection_key
    or updated.intake_selection_machine_ids is distinct from c.intake_selection_machine_ids
    or row(updated.decision,updated.decision_reason,updated.decided_by,updated.decided_at,
      updated.refund_amount_cents,updated.payment_amount_cents)
      is distinct from row(c.decision,c.decision_reason,c.decided_by,c.decided_at,
        c.refund_amount_cents,c.payment_amount_cents)
    or updated.deterministic_fact_version<>c.deterministic_fact_version+1
    or updated.official_action_version<>c.official_action_version+1
    or updated.nayax_lookup_status<>'not_started' then
    raise exception 'Catalog correction changed financial or occurrence facts' using errcode='P4681';
  end if;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata) values(
    c.id,'location_binding_corrected','The existing exact-machine intake was reconciled after a reporting catalog move. No message or payment was issued.',
    jsonb_build_object('policy','customer_reported_location_binding_v1',
      'correction_kind','same_machine_catalog_move','source_case_digest',p_expected_case_digest,
      'old_machine_id',m.id,'new_machine_id',m.id,'old_location_id',source.id,'new_location_id',target.id,
      'prior_case_version',c.official_action_version,'resulting_case_version',updated.official_action_version,
      'prior_fact_version',c.deterministic_fact_version,'resulting_fact_version',updated.deterministic_fact_version,
      'scope_digest',public.refund_approved_card_research_scope_digest(c.id),
      'approved_amount_cents',updated.refund_amount_cents,'decided_by',updated.decided_by,
      'decided_at',updated.decided_at,'refund_business_fingerprint',updated.refund_business_fingerprint,
      'approval_preserved',true,'original_venue_clock_preserved',true,
      'old_catalog_timezone',target.timezone,'new_catalog_timezone',source.timezone,
      'customer_message_created',false,'provider_call_made',false,'payment_action',false,'payload_redacted',true));
  return jsonb_build_object('status','corrected','caseId',c.id,'caseVersion',updated.official_action_version,
    'factVersion',updated.deterministic_fact_version,'lookupInvalidated',true,
    'approvalPreserved',true,'providerCallMade',false,'customerMessageCreated',false,'paymentAction',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_correct_refund_location_binding(
  uuid,text,bigint,bigint,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.service_correct_refund_location_binding(
  uuid,text,bigint,bigint,uuid,uuid,boolean) to service_role;

-- A pure catalog binding repair invalidates the old read snapshot. Continue
-- the same saved approval through the existing atomic read-only claimant.
-- The immutable correction event binds the exact new facts and machine scope;
-- it neither selects a purchase nor changes the separate payment executor.
do $migration$
declare
  definition text;
  recovery text := $recovery$exists(select 1 from public.refund_case_events catalog_repair
    where catalog_repair.refund_case_id=ROW_ALIAS.id
      and catalog_repair.event_type='location_binding_corrected'
      and catalog_repair.metadata->>'correction_kind'='same_machine_catalog_move'
      and catalog_repair.metadata->>'resulting_fact_version'=ROW_ALIAS.deterministic_fact_version::text
      and catalog_repair.metadata->>'resulting_case_version'=ROW_ALIAS.official_action_version::text
      and catalog_repair.metadata->>'scope_digest'=public.refund_approved_card_research_scope_digest(ROW_ALIAS.id)
      and catalog_repair.metadata->>'approved_amount_cents'=ROW_ALIAS.refund_amount_cents::text
      and catalog_repair.metadata->>'decided_by'=ROW_ALIAS.decided_by::text
      and (catalog_repair.metadata->>'decided_at')::timestamptz=ROW_ALIAS.decided_at
      and catalog_repair.metadata->>'refund_business_fingerprint'=ROW_ALIAS.refund_business_fingerprint
      and not exists(select 1 from public.refund_case_events later_manual
        where later_manual.refund_case_id=ROW_ALIAS.id
          and later_manual.event_type in('manual_nayax_evidence_entered','nayax_match_preselection_disputed')
          and later_manual.created_at>=catalog_repair.created_at))$recovery$;
  due_recovery text;
  claim_recovery text;
begin
  due_recovery:=replace(recovery,'ROW_ALIAS','candidate');
  claim_recovery:=replace(recovery,'ROW_ALIAS','c');
  definition:=pg_get_functiondef('public.refund_due_approved_card_nayax_research()'::regprocedure);
  if position('and candidate.nayax_lookup_finished_at is not null' in definition)=0
    or position('and candidate.nayax_lookup_started_at is not null' in definition)=0
    or position('(candidate.nayax_lookup_status=''manual_exception''' in definition)=0 then
    raise exception 'Exact approved read-only due predicate required';
  end if;
  definition:=replace(definition,'and candidate.nayax_lookup_finished_at is not null',
    'and (candidate.nayax_lookup_finished_at is not null or '||due_recovery||')');
  definition:=replace(definition,'and candidate.nayax_lookup_started_at is not null',
    'and (candidate.nayax_lookup_started_at is not null or '||due_recovery||')');
  definition:=replace(definition,'(candidate.nayax_lookup_status=''manual_exception''',
    '(candidate.nayax_lookup_status=''not_started'' and '||due_recovery||') or (candidate.nayax_lookup_status=''manual_exception''');
  definition:=replace(definition,'candidate.nayax_lookup_finished_at,',
    'coalesce(candidate.nayax_lookup_finished_at,candidate.deterministic_facts_updated_at),');
  definition:=replace(definition,'''expired_results'' else ''safe_failed_read''',
    '''expired_results'' when candidate.nayax_lookup_status=''not_started'' then ''catalog_binding_corrected'' else ''safe_failed_read''');
  execute definition;
  definition:=pg_get_functiondef('public.service_claim_due_approved_card_nayax_research(integer)'::regprocedure);
  if position('or c.nayax_lookup_finished_at is null' in definition)=0
    or position('or c.nayax_lookup_started_at is null' in definition)=0 then
    raise exception 'Exact approved read-only claim predicate required';
  end if;
  definition:=replace(definition,'or c.nayax_lookup_finished_at is null',
    'or (c.nayax_lookup_finished_at is null and not ('||claim_recovery||'))');
  definition:=replace(definition,'or c.nayax_lookup_started_at is null',
    'or (c.nayax_lookup_started_at is null and not ('||claim_recovery||'))');
  definition:=replace(definition,'due_at := c.nayax_lookup_finished_at;',
    'due_at := coalesce(c.nayax_lookup_finished_at,c.deterministic_facts_updated_at);');
  execute definition;
end;
$migration$;
