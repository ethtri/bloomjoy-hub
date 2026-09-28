-- The first projection repair removed impossible evidence shapes, but the
-- authenticated overview still evaluated the full outreach history for every
-- young no-match/multiple-match card case. A 30-day rejection cannot be ready
-- when neither the case nor any potentially relevant question timestamp is 30
-- days old. Keep clear purchase evaluation first, then use that conservative
-- lower bound before the expensive causal-outreach projection.
--
-- Patch only the exact current definition. Source drift aborts the migration.
do $$
declare
  source_definition text;
  old_fragment text := $fragment$
  if purchase is not null then
    return result||jsonb_build_object(
      'kind','refund','reasonCode','clear_purchase_match',
      'summary','A matching purchase was found. We recommend refunding this purchase.',
      'purchase',purchase);
  end if;

  -- Reject only after completed current read-only research. Provider failure,
$fragment$;
  new_fragment text := $fragment$
  if purchase is not null then
    return result||jsonb_build_object(
      'kind','refund','reasonCode','clear_purchase_match',
      'summary','A matching purchase was found. We recommend refunding this purchase.',
      'purchase',purchase);
  end if;

  -- A rejection needs 30 elapsed days after a delivered customer question.
  -- Case creation is normally the earliest possible question time. Preserve
  -- imported or anomalous older question rows by checking every timestamp that
  -- could conservatively precede delivery before taking the young-case exit.
  if c.created_at>p_observed_at-interval '30 days'
    and not exists(select 1 from public.refund_case_messages m
      where m.refund_case_id=c.id
        and m.message_type in ('more_info','no_safe_match')
        and (m.created_at<=p_observed_at-interval '30 days'
          or m.sent_at<=p_observed_at-interval '30 days'
          or m.delivery_state_updated_at<=p_observed_at-interval '30 days'))
    and not exists(select 1 from public.refund_follow_up_cycles cycle
      where cycle.refund_case_id=c.id
        and (cycle.created_at<=p_observed_at-interval '30 days'
          or cycle.request_created_at<=p_observed_at-interval '30 days'
          or cycle.request_sent_at<=p_observed_at-interval '30 days')) then
    return null;
  end if;

  -- Reject only after completed current read-only research. Provider failure,
$fragment$;
begin
  source_definition:=pg_get_functiondef(
    'public.refund_decision_recommendation_for_case(uuid,timestamptz)'::regprocedure);
  if strpos(source_definition,old_fragment)=0
    or strpos(source_definition,new_fragment)>0 then
    raise exception 'Refund decision recommendation source changed'
      using errcode='P4652';
  end if;
  source_definition:=replace(source_definition,old_fragment,new_fragment);
  execute source_definition;
end $$;

comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only redacted current-evidence recommendation with conservative evidence-shape and 30-day lower-bound pruning. It grants no decision, payment, or messaging authority.';
select pg_notify('pgrst','reload schema');
