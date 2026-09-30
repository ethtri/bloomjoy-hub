-- #1429/#628: current authority belongs to the person making the decision,
-- not the historical reviewer who saved the immutable selection proof.
-- The protected selector checked case-work access when it wrote that proof.
-- Keep candidate, generation, facts, hash, actor attribution and final-decision
-- authorization unchanged; this only repairs the read-only recommendation.
do $migration$
declare
  definition text;
  old_gate text := $old$
                  and proof.actor_user_id is not null
                  and public.can_perform_refund_official_action(
                    proof.actor_user_id,c.id)
$old$;
  new_gate text := $new$
                  and proof.actor_user_id is not null
$new$;
begin
  definition := replace(pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure),
    E'\r\n',E'\n');
  if cardinality(string_to_array(definition,old_gate)) <> 2 then
    raise exception 'Expected current System selection proof authority anchor';
  end if;
  execute replace(definition,old_gate,new_gate);
end;
$migration$;

comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only current-evidence recommendation from the immutable actor-attributed selection proof. The existing decision projection and approval RPC authorize the current assigned Machine Manager or Super-admin independently.';
