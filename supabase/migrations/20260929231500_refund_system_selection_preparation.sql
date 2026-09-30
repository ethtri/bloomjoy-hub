-- #628: a scheduled lookup candidate remains System-owned after an authorized
-- Manager selects it. Bind recommendation readiness to that exact current
-- selection proof without rewriting candidate ownership or assigning the case.

do $migration$
declare
  definition text;
  old_candidate_gate text := $old$
          and c.nayax_recommendation_state='manager_confirmed'
          and k.actor_user_id is not null
          and k.reporting_machine_id=c.reporting_machine_id
$old$;
  new_candidate_gate text := $new$
          and c.nayax_recommendation_state='manager_confirmed'
          and k.reporting_machine_id=c.reporting_machine_id
$new$;
  old_proof_gate text := $old$
              and proof.event_type='nayax_match_selected'
              and proof.actor_user_id=k.actor_user_id
              and proof.metadata->>'candidate_token'=k.token::text
$old$;
  new_proof_gate text := $new$
              and proof.event_type='nayax_match_selected'
              and (
                (k.actor_user_id is not null
                  and proof.actor_user_id=k.actor_user_id)
                or (
                  k.actor_user_id is null
                  and proof.actor_user_id is not null
                  and public.can_perform_refund_official_action(
                    proof.actor_user_id,c.id)
                )
              )
              and proof.metadata->>'candidate_token'=k.token::text
$new$;
begin
  definition := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure
  ),E'\r\n',E'\n');

  if cardinality(pg_catalog.string_to_array(definition,old_candidate_gate)) <> 2
    or cardinality(pg_catalog.string_to_array(definition,old_proof_gate)) <> 2 then
    raise exception 'Current decision recommendation does not match the System selection proof anchors';
  end if;

  definition := pg_catalog.replace(
    definition,old_candidate_gate,new_candidate_gate);
  definition := pg_catalog.replace(
    definition,old_proof_gate,new_proof_gate);
  execute definition;
end;
$migration$;

comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only redacted current-evidence recommendation. A scheduled System candidate requires an exact selection proof from a currently authorized machine Manager or Super-admin; no candidate ownership, case assignment, decision, payment, or message is changed.';

select pg_catalog.pg_notify('pgrst','reload schema');
