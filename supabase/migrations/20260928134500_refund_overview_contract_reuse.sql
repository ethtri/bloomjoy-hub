-- The canonical lifecycle already carries current customer-outreach, next-work,
-- and decision-recommendation contracts. Later historical overview wrappers
-- recomputed those contracts per case, and the Nayax recovery wrapper repeated
-- the current correction-field projection before scanning for recoveries. At
-- production volume that duplicate work kept the authenticated overview above
-- the PostgREST statement timeout even after recommendation pruning.
--
-- Reuse only exact current contracts. The current case-owned lookup-work helper
-- still runs unchanged for every collection. Any malformed item, stale
-- case/fact/action version, or System-owned lookup work delegates to the prior
-- outreach/next-work implementation. Refund Operations lookup ownership does
-- not rewrite lifecycle fields in the guarded helper and remains reusable.
-- Ordinary and Internal/test collections
-- pass through the same independent fail-closed checks.

do $$
declare
  parity_source text:=pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()'::regprocedure);
  recovery_source text:=pg_get_functiondef(
    'public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean)'::regprocedure);
  lookup_source text:=pg_get_functiondef(
    'public.admin_get_refund_operations_overview_pre_customer_outreach_v1()'::regprocedure);
  outreach_source text:=pg_get_functiondef(
    'public.refund_project_customer_outreach_cases_for_manager(jsonb,boolean)'::regprocedure);
  overview_source text:=pg_get_functiondef(
    'public.admin_get_refund_operations_overview()'::regprocedure);
begin
  if strpos(parity_source,
      'admin_get_refund_operations_overview_pre_correction_scope_')=0
    or strpos(parity_source,'refund_purchase_correction_request_fields')=0
    or strpos(parity_source,'''{internalTestCases}''')=0 then
    raise exception 'Refund correction parity source changed' using errcode='P4652';
  end if;
  if strpos(recovery_source,'nayaxLookupWork')=0
    or strpos(recovery_source,'payment_effect_exists')=0
    or strpos(recovery_source,'lookup_scope_failure')=0 then
    raise exception 'Refund lookup recovery projection source changed' using errcode='P4652';
  end if;
  if strpos(lookup_source,'admin_get_refund_operations_overview_pre_lookup_recovery_v1')=0
    or strpos(lookup_source,'refund_purchase_correction_request_fields')=0
    or strpos(lookup_source,'refund_project_nayax_lookup_recovery_cases_for_manager')=0 then
    raise exception 'Refund lookup overview source changed' using errcode='P4652';
  end if;
  if strpos(outreach_source,'refund_customer_outreach_contract')=0
    or strpos(outreach_source,'refund_apply_customer_outreach_to_lifecycle')=0 then
    raise exception 'Refund outreach projection source changed' using errcode='P4652';
  end if;
  if strpos(overview_source,'admin_get_refund_operations_overview_pre_next_work_v1')=0
    or strpos(overview_source,'refund_next_work_for_case')=0 then
    raise exception 'Refund next-work overview source changed' using errcode='P4652';
  end if;
end $$;

-- Keep the parity wrapper as the only correction-field authority and mark the
-- result only after it has rebound both collections to the current helper.
create or replace function
  public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  base jsonb;
  projected jsonb;
begin
  base:=public.admin_get_refund_operations_overview_pre_correction_scope_parity_v1();
  if jsonb_typeof(base->'cases')='array' then
    select coalesce(jsonb_agg(jsonb_set(item.value,'{customerCorrectionFields}',
      to_jsonb(public.refund_purchase_correction_request_fields(
        (item.value->>'id')::uuid)),true) order by item.ordinality),'[]'::jsonb)
    into projected
    from jsonb_array_elements(base->'cases') with ordinality item;
    base:=jsonb_set(base,'{cases}',projected,true);
  end if;
  if jsonb_typeof(base->'internalTestCases')='array' then
    select coalesce(jsonb_agg(jsonb_set(item.value,'{customerCorrectionFields}',
      to_jsonb(public.refund_purchase_correction_request_fields(
        (item.value->>'id')::uuid)),true) order by item.ordinality),'[]'::jsonb)
    into projected
    from jsonb_array_elements(base->'internalTestCases') with ordinality item;
    base:=jsonb_set(base,'{internalTestCases}',projected,true);
  end if;
  return base||jsonb_build_object(
    'customerCorrectionFieldsContractVersion',
    'refund_customer_correction_fields_v1');
end;
$$;

revoke all on function
  public.admin_get_refund_operations_overview_pre_lookup_recovery_v1()
  from public,anon,authenticated,service_role;

-- The delegated parity wrapper already computed exact current correction
-- fields. Do not calculate them a second time before the recovery projection.
create or replace function
  public.admin_get_refund_operations_overview_pre_customer_outreach_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  base jsonb:=public.admin_get_refund_operations_overview_pre_lookup_recovery_v1();
  has_operations_access boolean:=coalesce(
    (base->>'refundOperationsAccess')::boolean,false);
begin
  if base->>'customerCorrectionFieldsContractVersion'
      is distinct from 'refund_customer_correction_fields_v1' then
    raise exception 'Unsupported refund correction-field contract'
      using errcode='P4652';
  end if;
  if jsonb_typeof(base->'cases')='array' then
    base:=jsonb_set(base,'{cases}',
      public.refund_project_nayax_lookup_recovery_cases_for_manager(
        base->'cases',has_operations_access),true);
  end if;
  if jsonb_typeof(base->'internalTestCases')='array' then
    base:=jsonb_set(base,'{internalTestCases}',
      public.refund_project_nayax_lookup_recovery_cases_for_manager(
        base->'internalTestCases',has_operations_access),true);
  end if;
  return base;
end;
$$;
revoke all on function
  public.admin_get_refund_operations_overview_pre_customer_outreach_v1()
  from public,anon,authenticated,service_role;

alter function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) rename to refund_project_outreach_pre_reuse_v1;
revoke all on function public.refund_project_outreach_pre_reuse_v1(jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.refund_project_customer_outreach_cases_for_manager(
  p_cases jsonb,p_has_operations_access boolean
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  projected_cases jsonb:='[]'::jsonb;
  item jsonb;
  projected_item jsonb;
  lifecycle jsonb;
  outreach jsonb;
  current_fact bigint;
  reusable boolean;
begin
  if jsonb_typeof(p_cases) is distinct from 'array' then
    return public.refund_project_outreach_pre_reuse_v1(
      p_cases,p_has_operations_access);
  end if;
  for item in select value from jsonb_array_elements(p_cases) loop
    current_fact:=null;
    if jsonb_typeof(item)='object'
      and coalesce(item->>'id','') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      select c.deterministic_fact_version into current_fact
      from public.refund_cases c where c.id=(item->>'id')::uuid;
    end if;
    lifecycle:=item->'lifecycle'; outreach:=lifecycle->'customerOutreach';
    reusable:=coalesce(current_fact is not null
      and jsonb_typeof(lifecycle)='object'
      and lifecycle->>'schemaVersion'='refund_lifecycle_v2'
      and lifecycle->>'payloadRedacted'='true'
      and jsonb_typeof(outreach)='object'
      and outreach->>'schemaVersion'='refund_customer_outreach_v1'
      and outreach->>'payloadRedacted'='true'
      and outreach->>'caseFactVersion'=current_fact::text
      and jsonb_typeof(outreach->'manualFallbackEligible')='boolean'
      and jsonb_typeof(outreach->'requestedFields')='array'
      and jsonb_typeof(to_jsonb(outreach->>'state'))='string'
      and jsonb_typeof(to_jsonb(outreach->>'owner'))='string'
      and jsonb_typeof(to_jsonb(outreach->>'nextAction'))='string'
      and item#>>'{nayaxLookupWork,state}' in ('complete','refund_operations'),false);
    if reusable then
      if not coalesce(p_has_operations_access,false) then
        outreach:=jsonb_set(outreach,'{failureCode}','null'::jsonb,true);
      end if;
      lifecycle:=public.refund_apply_customer_outreach_to_lifecycle(
        lifecycle,outreach);
      projected_item:=jsonb_set(item,'{lifecycle}',lifecycle,true);
    else
      projected_item:=public.refund_project_outreach_pre_reuse_v1(
        jsonb_build_array(item),p_has_operations_access)->0;
      if jsonb_typeof(projected_item->'lifecycle')='object' then
        projected_item:=jsonb_set(projected_item,'{lifecycle}',
          (projected_item->'lifecycle')-'nextWork'-'decisionRecommendation',true);
      end if;
    end if;
    projected_cases:=projected_cases||jsonb_build_array(projected_item);
  end loop;
  return projected_cases;
end;
$$;
revoke all on function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) from public,anon,authenticated;
grant execute on function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) to service_role;

create function public.refund_project_current_next_work_cases(p_cases jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  projected jsonb:='[]'::jsonb;
  item jsonb;
  lifecycle jsonb;
  outreach jsonb;
  work jsonb;
  recommendation jsonb;
  c public.refund_cases%rowtype;
  reusable boolean;
begin
  if jsonb_typeof(p_cases) is distinct from 'array' then return p_cases; end if;
  for item in select value from jsonb_array_elements(p_cases) loop
    c:=null;
    if jsonb_typeof(item)='object'
      and coalesce(item->>'id','') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      select current_case.* into c from public.refund_cases current_case
      where current_case.id=(item->>'id')::uuid;
    end if;
    lifecycle:=item->'lifecycle'; outreach:=lifecycle->'customerOutreach';
    work:=lifecycle->'nextWork'; recommendation:=lifecycle->'decisionRecommendation';
    reusable:=coalesce(c.id is not null
      and jsonb_typeof(lifecycle)='object'
      and lifecycle->>'schemaVersion'='refund_lifecycle_v2'
      and lifecycle->>'payloadRedacted'='true'
      and item->>'officialActionVersion'=c.official_action_version::text
      and jsonb_typeof(outreach)='object'
      and outreach->>'schemaVersion'='refund_customer_outreach_v1'
      and outreach->>'payloadRedacted'='true'
      and outreach->>'caseFactVersion'=c.deterministic_fact_version::text
      and jsonb_typeof(work)='object'
      and work->>'schemaVersion'='refund_next_work_v1'
      and work->>'payloadRedacted'='true'
      and jsonb_typeof(work->'isOpen')='boolean'
      and work->>'actor' in ('manager','system','agent','customer')
      and jsonb_typeof(to_jsonb(work->>'actionCode'))='string'
      and lifecycle?'decisionRecommendation'
      and (
        recommendation='null'::jsonb
        or (
          jsonb_typeof(recommendation)='object'
          and recommendation->>'schemaVersion'='refund_decision_recommendation_v1'
          and recommendation->>'payloadRedacted'='true'
          and recommendation->>'officialActionVersion'=c.official_action_version::text
          and recommendation->>'deterministicFactVersion'=c.deterministic_fact_version::text
          and recommendation->>'kind' in ('refund','reject')
          and nullif(btrim(recommendation->>'summary'),'') is not null
          and jsonb_typeof(recommendation->'decisionReady')='boolean'
          and (
            (recommendation->>'decisionReady'='true'
              and work->>'actor'='manager'
              and work->>'actionCode'=case recommendation->>'kind'
                when 'reject' then 'reject_request'
                else 'approve_or_deny_request' end)
            or (recommendation->>'decisionReady'='false'
              and work->>'actor'='agent'
              and work->>'actionCode'='resolve_manager_assignment')
          )
          and (
            (recommendation->>'kind'='reject'
              and recommendation->>'reasonCode'='no_match_after_30_days'
              and recommendation->'purchase'='null'::jsonb)
            or (recommendation->>'kind'='refund'
              and recommendation->>'reasonCode'='clear_purchase_match'
              and jsonb_typeof(recommendation->'purchase')='object'
              and recommendation#>>'{purchase,source}' in ('nayax','sunze')
              and recommendation#>>'{purchase,source}'=case c.payment_method
                when 'card' then 'nayax' when 'cash' then 'sunze' end
              and recommendation#>>'{purchase,amountCents}' ~ '^[1-9][0-9]*$'
              and recommendation#>>'{purchase,currencyCode}' ~ '^[A-Z]{3}$'
              and recommendation#>>'{purchase,timeMeaning}' in ('purchase','unknown')
              and jsonb_typeof(recommendation#>'{purchase,transactionAt}')
                in ('string','null'))
          )
        )
      )
      and item#>>'{nayaxLookupWork,state}' in ('complete','refund_operations'),false);
    if not reusable and jsonb_typeof(lifecycle)='object' then
      item:=jsonb_set(item,'{lifecycle}',public.refund_next_work_for_case(
        nullif(item->>'id','')::uuid,lifecycle),true);
    end if;
    projected:=projected||jsonb_build_array(item);
  end loop;
  return projected;
end;
$$;
revoke all on function public.refund_project_current_next_work_cases(jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_project_current_next_work_cases(jsonb)
  to service_role;

create or replace function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  base jsonb:=public.admin_get_refund_operations_overview_pre_next_work_v1();
  field_name text;
begin
  foreach field_name in array array['cases','internalTestCases'] loop
    if jsonb_typeof(base->field_name)='array' then
      base:=jsonb_set(base,array[field_name],
        public.refund_project_current_next_work_cases(base->field_name),true);
    end if;
  end loop;
  return base;
end;
$$;
revoke all on function public.admin_get_refund_operations_overview()
  from public,anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated,service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with exact current correction, outreach, recovery, next-work, and decision contract reuse.';
comment on function public.refund_project_customer_outreach_cases_for_manager(jsonb,boolean)
  is 'Reuses only current-fact redacted outreach contracts and delegates every stale or recovery-bearing item.';
comment on function public.refund_project_current_next_work_cases(jsonb)
  is 'Reuses only exact current case/fact/action-version next-work and recommendation contracts; stale items are recomputed.';
select pg_notify('pgrst','reload schema');
