-- The recommendation consumer made a full evidence projection for cases whose
-- cheap case facts prove that neither a refund nor a 30-day rejection can be
-- recommended. The ready-notice wrapper then repeated the full lifecycle via
-- its legacy adapter even when the lifecycle had already proved that the work
-- was closed or belonged to Agent/System. At production volume those repeated
-- projections made the all-case enqueue and portal overview exceed the fixed
-- authenticated/PostgREST statement timeout.
--
-- Preserve every possible recommendation shape and the legacy Manager payout
-- path. This migration only adds conservative early exits around exact current
-- definitions; a source drift fails the migration rather than partially
-- rewriting a newer contract.
do $$
declare
  source_definition text;
  old_fragment text := $fragment$
  preparation:=public.refund_manager_preparation_snapshot(
    c.id,c.official_action_version);
$fragment$;
  new_fragment text := $fragment$
  -- These case-level facts are a conservative superset of every supported
  -- recommendation. Card refund recommendations require either a selected
  -- transaction or the multiple/manual candidate-set states; card rejection
  -- recommendations additionally use no_match. Cash recommendations require
  -- a current sale, no-sale, or multiple-sale result. Provider/setup failures,
  -- unavailable coverage and untouched intake cannot produce a decision.
  if c.payment_method='card'
    and nullif(btrim(c.matched_nayax_transaction_id),'') is null
    and coalesce(c.nayax_lookup_status,'') not in (
      'no_match','multiple_matches','manual_exception') then
    return null;
  elsif c.payment_method='cash'
    and coalesce(c.cash_match_state,'') not in (
      'sale_found','no_sale_found_with_complete_coverage',
      'multiple_possible_sales') then
    return null;
  elsif c.payment_method is null
    or c.payment_method not in ('card','cash') then
    return null;
  end if;

  preparation:=public.refund_manager_preparation_snapshot(
    c.id,c.official_action_version);
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

do $$
declare
  source_definition text;
  old_fragment text := $fragment$
  if recommendation is null or recommendation='null'::jsonb then
    legacy:=public.service_refund_ready_snapshot_pre_recommendation_v1(
      c.id,p_manager_user_id,p_observed_at);
$fragment$;
  new_fragment text := $fragment$
  if recommendation is null or recommendation='null'::jsonb then
    -- The legacy adapter recomputes the full lifecycle. Delegate only when the
    -- lifecycle already proves there is open Manager work. Invalid contracts
    -- still raise exactly as the legacy adapter did; approved cash payout and
    -- any genuine legacy Manager action continue through that adapter.
    if lifecycle->>'schemaVersion' is distinct from 'refund_lifecycle_v2'
      or work->>'schemaVersion' is distinct from 'refund_next_work_v1'
      or jsonb_typeof(work->'isOpen') is distinct from 'boolean' then
      raise exception 'Unsupported refund readiness contract' using errcode='P4652';
    end if;
    if work->>'isOpen' is distinct from 'true'
      or work->>'actor' is distinct from 'manager'
      or lifecycle->>'paymentState'='confirmed' then return null; end if;
    legacy:=public.service_refund_ready_snapshot_pre_recommendation_v1(
      c.id,p_manager_user_id,p_observed_at);
$fragment$;
begin
  source_definition:=pg_get_functiondef(
    'public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)'::regprocedure);
  if strpos(source_definition,old_fragment)=0
    or strpos(source_definition,new_fragment)>0 then
    raise exception 'Refund ready-notice snapshot source changed'
      using errcode='P4652';
  end if;
  source_definition:=replace(source_definition,old_fragment,new_fragment);
  execute source_definition;
end $$;

comment on function public.refund_decision_recommendation_for_case(uuid,timestamptz)
  is 'Service-only redacted current-evidence recommendation with conservative evidence-shape pruning. It grants no decision, payment, or messaging authority.';
comment on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
  is 'Service-only exact Manager-ready projection; closed and non-Manager work does not repeat the legacy lifecycle projection.';
select pg_notify('pgrst','reload schema');
