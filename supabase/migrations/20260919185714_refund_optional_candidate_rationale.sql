-- A manager's selection of an otherwise review-safe transaction must not be
-- rejected because an optional presentation rationale is absent, stale, or no
-- longer supported by the candidate's timestamp evidence. The authoritative
-- candidate RPC continues to own actor, case-version, exact identity, expiry,
-- duplicate, amount/currency, and execution-eligibility checks.

do $migration$
declare
  function_definition text;
  required_reason_guard text := $old$
  if not candidate_recommended
    and normalized_disagreement_reason not in (
      'closer_time', 'correct_amount', 'correct_card',
      'customer_confirmation', 'provider_data_issue', 'other_review_reason'
    ) then
    raise exception 'Choose why this alternate Nayax transaction is the correct one'
      using errcode = 'P4604';
  end if;
$old$;
  optional_reason_normalization text := $new$
  -- This field is optional audit context, not transaction authority. Preserve
  -- a supported value when it still describes the reviewed evidence; otherwise
  -- omit it without changing candidate eligibility.
  if normalized_disagreement_reason not in (
    'closer_time', 'correct_amount', 'correct_card',
    'customer_confirmation', 'provider_data_issue', 'other_review_reason'
  ) then
    normalized_disagreement_reason := '';
  end if;
  if normalized_disagreement_reason = 'closer_time'
    and (
      candidate.evidence_summary ->> 'transaction_occurrence_comparable' = 'true'
      and refund_case.incident_time_resolution in ('exact', 'legacy_absolute')
      and refund_case.incident_time_confidence is distinct from 'rough'
    ) is distinct from true then
    normalized_disagreement_reason := '';
  end if;
$new$;
  reason_event_field text := $old$
      'disagreement_reason_code', case when candidate_recommended
        then null else normalized_disagreement_reason end,
$old$;
  optional_reason_event_field text := $new$
      'disagreement_reason_code', case when candidate_recommended
        then null else nullif(normalized_disagreement_reason, '') end,
$new$;
  closer_time_guard text := $old$
  if normalized_disagreement_reason = 'closer_time'
    and candidate_time_comparable is distinct from true then
    raise exception 'Closer transaction time requires comparable purchase-event evidence'
      using errcode = 'P4604';
  end if;
$old$;
begin
  function_definition := pg_catalog.replace(
    pg_catalog.pg_get_functiondef(
      'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
    ),
    E'\r\n', E'\n'
  );
  if pg_catalog.strpos(function_definition, required_reason_guard) = 0
    or pg_catalog.strpos(function_definition, reason_event_field) = 0 then
    raise exception 'Current candidate-selection routine does not match the optional-rationale patch anchors';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    required_reason_guard,
    optional_reason_normalization
  );
  function_definition := pg_catalog.replace(
    function_definition,
    reason_event_field,
    optional_reason_event_field
  );
  execute function_definition;

  function_definition := pg_catalog.replace(
    pg_catalog.pg_get_functiondef(
      'public.admin_select_refund_nayax_candidate_current_user_v1(uuid,bigint,uuid,text)'::regprocedure
    ),
    E'\r\n', E'\n'
  );
  if pg_catalog.strpos(function_definition, closer_time_guard) = 0 then
    raise exception 'Current manager candidate wrapper does not match the optional-rationale patch anchor';
  end if;
  function_definition := pg_catalog.replace(
    function_definition,
    closer_time_guard,
    E'  -- Timestamp comparability only controls whether closer_time is retained as optional audit context.\n'
  );
  execute function_definition;
end;
$migration$;

revoke all on function public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
  uuid, uuid, bigint, uuid, text
) from public, anon, authenticated, service_role;

revoke all on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid, bigint, uuid, text
) from public, anon, service_role;
grant execute on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid, bigint, uuid, text
) to authenticated;

comment on function public.admin_select_refund_nayax_candidate_current_user_v1(
  uuid, bigint, uuid, text
) is
  'Selects an exact current review-safe Nayax candidate. Optional alternate-selection rationale is retained only when supported and never grants or revokes selection authority.';
