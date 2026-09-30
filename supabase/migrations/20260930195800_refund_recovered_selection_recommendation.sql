-- #1429/#628: use the same immutable native/recovered selection proof contract
-- already accepted by preparation and approval. RF-26DB7861 has a guarded
-- System-recovered proof for an actor-bound candidate, not a native selection
-- event. Current decision authority belongs to the deciding Manager; historic
-- selection attribution is retained without reauthorizing that old actor.
do $migration$
declare
  definition text;
  old_gate text := $old$
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
$old$;
  new_gate text := $new$
              and (
                (proof.event_type='nayax_match_selected'
                  and (
                    (k.actor_user_id is not null
                      and proof.actor_user_id=k.actor_user_id)
                    or (k.actor_user_id is null
                      and proof.actor_user_id is not null)
                  ))
                or (proof.event_type='nayax_match_selection_proof_recovered'
                  and proof.actor_user_id is null
                  and proof.metadata->>'recovery_contract_version'=
                    'refund_legacy_selection_proof_recovery_v1'
                  and proof.metadata->>'execution_eligible'='true'
                  and proof.metadata->>'approval_created'='false'
                  and proof.metadata->>'source_selection_event_digest' ~ '^[0-9a-f]{64}$')
              )
$new$;
begin
  definition := replace(pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure),
    E'\r\n',E'\n');
  if cardinality(string_to_array(definition,old_gate)) <> 2 then
    raise exception 'Expected current native selection recommendation proof anchor';
  end if;
  execute replace(definition,old_gate,new_gate);
end;
$migration$;

comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only current-evidence recommendation from the exact immutable native selection or guarded refund_legacy_selection_proof_recovery_v1 proof. Current candidate/fact/generation/hash and no-side-effect metadata remain required. The existing decision projection and approval RPC independently authorize the current assigned Machine Manager or Super-admin.';
