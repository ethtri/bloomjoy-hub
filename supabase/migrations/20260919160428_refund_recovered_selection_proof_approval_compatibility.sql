-- Keep the write boundary compatible with the recovered proof contract that the
-- manager-readiness projection already accepts. The candidate lookup above this
-- proof check still binds the current case, machine, transaction, identifiers,
-- amount, currency, lookup generation, and candidate evidence hash. This clause
-- accepts only the narrowly recovered, no-side-effect proof emitted by
-- service_recover_safe_legacy_refund_selection_proofs_v1().
do $reserve_recovered_selection_proof_event$
declare
  function_definition text;
  legacy_shape_tail text := $legacy$
      'nayax_official_action_finalized'
    );
$legacy$;
  current_shape_tail text := $current$
      'nayax_official_action_finalized',
      'nayax_refund_execution_authorized',
      'nayax_refund_execution_continued'
    );
$current$;
  selection_event_anchor text := $anchor$
      'nayax_match_selected',
      'official_action_committed',
$anchor$;
  reserved_selection_event_anchor text := $replacement$
      'nayax_match_selected',
      'nayax_match_selection_proof_recovered',
      'official_action_committed',
$replacement$;
  legacy_shape_count integer;
  current_shape_count integer;
  selection_anchor_count integer;
begin
  legacy_shape_tail := replace(legacy_shape_tail, E'\r\n', E'\n');
  current_shape_tail := replace(current_shape_tail, E'\r\n', E'\n');
  selection_event_anchor := replace(selection_event_anchor, E'\r\n', E'\n');
  reserved_selection_event_anchor := replace(
    reserved_selection_event_anchor,
    E'\r\n',
    E'\n'
  );
  function_definition := replace(
    pg_get_functiondef(
      'public.enforce_refund_official_event_boundary()'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );

  legacy_shape_count := cardinality(
    string_to_array(function_definition, legacy_shape_tail)
  ) - 1;
  current_shape_count := cardinality(
    string_to_array(function_definition, current_shape_tail)
  ) - 1;
  selection_anchor_count := cardinality(
    string_to_array(function_definition, selection_event_anchor)
  ) - 1;

  if not (
    (legacy_shape_count = 2 and current_shape_count = 0)
    or (legacy_shape_count = 0 and current_shape_count = 2)
  ) or selection_anchor_count <> 2 then
    raise exception
      'Unexpected official refund event boundary shape; recovered-proof reservation was not applied';
  end if;

  execute replace(
    function_definition,
    selection_event_anchor,
    reserved_selection_event_anchor
  );
end;
$reserve_recovered_selection_proof_event$;

do $recovered_selection_proof_approval_compatibility$
declare
  function_definition text;
  existing_proof_clause text := $existing$
        or (e.event_type='nayax_match_selected'
          and e.metadata->>'candidate_token'=selected.token::text
          and e.metadata->>'candidate_evidence_hash'=candidate_hash
          and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and e.metadata->>'execution_eligible'='true'
          and e.metadata->>'payload_redacted'='true')
$existing$;
  compatible_proof_clause text := $compatible$
        or (e.event_type='nayax_match_selected'
          and e.metadata->>'candidate_token'=selected.token::text
          and e.metadata->>'candidate_evidence_hash'=candidate_hash
          and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and e.metadata->>'execution_eligible'='true'
          and e.metadata->>'payload_redacted'='true')
        or (e.event_type='nayax_match_selection_proof_recovered'
          and e.actor_user_id is null
          and e.metadata->>'candidate_token'=selected.token::text
          and e.metadata->>'candidate_evidence_hash'=candidate_hash
          and e.metadata->>'lookup_generation'=c.nayax_lookup_generation::text
          and e.metadata->>'deterministic_fact_version'=c.deterministic_fact_version::text
          and e.metadata->>'recovery_contract_version'=
            'refund_legacy_selection_proof_recovery_v1'
          and e.metadata->>'execution_eligible'='true'
          and e.metadata->>'provider_call_made'='false'
          and e.metadata->>'approval_created'='false'
          and e.metadata->>'customer_message_created'='false'
          and e.metadata->>'payload_redacted'='true'
          and e.metadata->>'source_selection_event_digest' ~ '^[0-9a-f]{64}$')
$compatible$;
begin
  existing_proof_clause := replace(existing_proof_clause, E'\r\n', E'\n');
  compatible_proof_clause := replace(compatible_proof_clause, E'\r\n', E'\n');
  function_definition := replace(
    pg_get_functiondef(
      'public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)'::regprocedure
    ),
    E'\r\n',
    E'\n'
  );

  if cardinality(string_to_array(function_definition, existing_proof_clause)) <> 2 then
    raise exception
      'Unexpected admin approval selection-proof shape; compatibility patch was not applied';
  end if;

  execute replace(
    function_definition,
    existing_proof_clause,
    compatible_proof_clause
  );
end;
$recovered_selection_proof_approval_compatibility$;

comment on function public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint) is
  'Atomically consumes one authorized manager decision and queues one exact System-owned Nayax attempt. Accepts current native selection proof or the guarded refund_legacy_selection_proof_recovery_v1 compatibility proof; it never calls the provider.';
