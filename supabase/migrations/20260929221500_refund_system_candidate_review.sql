-- #628: let an authorized reviewer use the exact ambiguous candidate set that
-- the scheduled lookup already saved. This changes no provider, decision, or
-- payment behavior and keeps manual-portal evidence actor-bound.

do $$
declare
  definition text;
  actor_bound_predicate text :=
    'and lookup_candidate.actor_user_id = p_actor_user_id';
  current_system_or_actor_predicate text := $replacement$
    and (
      lookup_candidate.actor_user_id = p_actor_user_id
      or (
        lookup_candidate.actor_user_id is null
        and lookup_candidate.lookup_generation = refund_case.nayax_lookup_generation
        and refund_case.nayax_lookup_status in ('multiple_matches','manual_exception')
        and refund_case.nayax_recommendation_state in ('ambiguous','manual_exception')
        and coalesce(lookup_candidate.evidence_summary ->> 'source','') <> 'manual_nayax_portal'
      )
    )$replacement$;
begin
  definition := replace(pg_catalog.pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');

  if length(definition) - length(replace(definition, actor_bound_predicate, ''))
      <> length(actor_bound_predicate) then
    raise exception 'Current candidate selector does not match the System review patch anchor';
  end if;

  execute replace(definition, actor_bound_predicate, current_system_or_actor_predicate);
end;
$$;

comment on function public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(
  uuid,uuid,bigint,uuid,text
) is
  'Selects exact current actor-bound or scheduled System ambiguous evidence after preserving all authority, version, expiry, identifier, and safety guards.';

select pg_catalog.pg_notify('pgrst','reload schema');
