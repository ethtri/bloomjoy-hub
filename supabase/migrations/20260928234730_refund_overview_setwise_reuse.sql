-- The overview already carries exact current lifecycle, outreach, next-work,
-- and lookup-work contracts before later compatibility wrappers run. Keep the
-- fail-closed delegates for stale rows, but aggregate current rows set-wise so
-- growing JSON arrays are not copied once per case.

alter function public.refund_project_lifecycle_v2_cases(jsonb)
  rename to refund_project_lifecycle_pre_setwise_reuse_v1;
revoke all on function public.refund_project_lifecycle_pre_setwise_reuse_v1(jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_project_lifecycle_v2_cases(p_cases jsonb)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case when jsonb_typeof(p_cases) is distinct from 'array'
    then public.refund_project_lifecycle_pre_setwise_reuse_v1(p_cases)
    else coalesce(jsonb_agg(
      case when current_case.id is not null
        and jsonb_typeof(item.case_json)='object'
        and jsonb_typeof(item.case_json->'lifecycle')='object'
        and item.case_json#>>'{lifecycle,schemaVersion}'='refund_lifecycle_v2'
        and item.case_json#>>'{lifecycle,payloadRedacted}'='true'
        and item.case_json->>'officialActionVersion'=
          current_case.official_action_version::text
        and item.case_json#>>'{lifecycle,customerOutreach,schemaVersion}'=
          'refund_customer_outreach_v1'
        and item.case_json#>>'{lifecycle,customerOutreach,payloadRedacted}'='true'
        and item.case_json#>>'{lifecycle,customerOutreach,caseFactVersion}'=
          current_case.deterministic_fact_version::text
        and item.case_json#>>'{lifecycle,nextWork,schemaVersion}'=
          'refund_next_work_v1'
        and item.case_json#>>'{lifecycle,nextWork,payloadRedacted}'='true'
        and item.case_json->'lifecycle'?'decisionRecommendation'
        and item.case_json#>>'{lifecycle,stage}' not in
          ('needs_transaction_selection','transaction_confirmed','awaiting_payout')
        then jsonb_set(item.case_json,'{lifecycle}',
          (item.case_json->'lifecycle')-'managerQueue'-'managerNextAction'
          ||jsonb_build_object('managerQueue',canonical.lifecycle->'managerQueue')
          ||case when canonical.lifecycle?'managerNextAction'
            then jsonb_build_object('managerNextAction',
              canonical.lifecycle->'managerNextAction')
            else '{}'::jsonb end,true)
        else public.refund_project_lifecycle_pre_setwise_reuse_v1(
          jsonb_build_array(item.case_json))->0
      end order by item.case_order), '[]'::jsonb) end
  from jsonb_array_elements(case when jsonb_typeof(p_cases)='array'
      then p_cases else '[]'::jsonb end)
    with ordinality item(case_json,case_order)
  left join public.refund_cases current_case
    on current_case.id=case when coalesce(item.case_json->>'id','') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (item.case_json->>'id')::uuid end
  left join lateral (
    select public.refund_apply_completion_contact_to_lifecycle(
      public.refund_apply_customer_outreach_to_lifecycle(
        public.refund_lifecycle_contract_pre_customer_outreach_v1(
          current_case.id),
        item.case_json#>'{lifecycle,customerOutreach}'),
      item.case_json#>'{lifecycle,messageState}') lifecycle
  ) canonical on current_case.id is not null;
$$;
revoke all on function public.refund_project_lifecycle_v2_cases(jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_project_lifecycle_v2_cases(jsonb)
  to service_role;

alter function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean) rename to refund_project_lookup_work_pre_setwise_v1;
revoke all on function public.refund_project_lookup_work_pre_setwise_v1(jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  p_cases jsonb,p_has_operations_access boolean)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case when jsonb_typeof(p_cases) is distinct from 'array'
    then public.refund_project_lookup_work_pre_setwise_v1(
      p_cases,p_has_operations_access)
    else coalesce(jsonb_agg(
      public.refund_project_lookup_work_pre_setwise_v1(
        jsonb_build_array(item.case_json),p_has_operations_access)->0
      order by item.case_order), '[]'::jsonb) end
  from jsonb_array_elements(case when jsonb_typeof(p_cases)='array'
      then p_cases else '[]'::jsonb end)
    with ordinality item(case_json,case_order);
$$;
revoke all on function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean) from public,anon,authenticated;
grant execute on function public.refund_project_nayax_lookup_recovery_cases_for_manager(
  jsonb,boolean) to service_role;

alter function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) rename to refund_project_outreach_pre_setwise_v1;
revoke all on function public.refund_project_outreach_pre_setwise_v1(jsonb,boolean)
  from public,anon,authenticated,service_role;

create function public.refund_project_customer_outreach_cases_for_manager(
  p_cases jsonb,p_has_operations_access boolean)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case when jsonb_typeof(p_cases) is distinct from 'array'
    then public.refund_project_outreach_pre_setwise_v1(
      p_cases,p_has_operations_access)
    else coalesce(jsonb_agg(
      case when current_case.id is not null
        and jsonb_typeof(item.case_json)='object'
        and jsonb_typeof(item.case_json->'lifecycle')='object'
        and item.case_json#>>'{lifecycle,schemaVersion}'='refund_lifecycle_v2'
        and item.case_json#>>'{lifecycle,payloadRedacted}'='true'
        and jsonb_typeof(item.case_json#>'{lifecycle,customerOutreach}')='object'
        and item.case_json#>>'{lifecycle,customerOutreach,schemaVersion}'=
          'refund_customer_outreach_v1'
        and item.case_json#>>'{lifecycle,customerOutreach,payloadRedacted}'='true'
        and item.case_json#>>'{lifecycle,customerOutreach,caseFactVersion}'=
          current_case.deterministic_fact_version::text
        and jsonb_typeof(item.case_json#>'{lifecycle,customerOutreach,manualFallbackEligible}')='boolean'
        and jsonb_typeof(item.case_json#>'{lifecycle,customerOutreach,requestedFields}')='array'
        and jsonb_typeof(to_jsonb(item.case_json#>>'{lifecycle,customerOutreach,state}'))='string'
        and jsonb_typeof(to_jsonb(item.case_json#>>'{lifecycle,customerOutreach,owner}'))='string'
        and jsonb_typeof(to_jsonb(item.case_json#>>'{lifecycle,customerOutreach,nextAction}'))='string'
        and item.case_json#>>'{nayaxLookupWork,state}' in ('complete','refund_operations')
        then jsonb_set(item.case_json,'{lifecycle}',
          public.refund_apply_customer_outreach_to_lifecycle(
            item.case_json->'lifecycle',
            case when coalesce(p_has_operations_access,false)
              then item.case_json#>'{lifecycle,customerOutreach}'
              else jsonb_set(item.case_json#>'{lifecycle,customerOutreach}',
                '{failureCode}','null'::jsonb,true) end),true)
        else case when jsonb_typeof(
            public.refund_project_outreach_pre_setwise_v1(
              jsonb_build_array(item.case_json),p_has_operations_access)
              ->0->'lifecycle')='object'
          then jsonb_set(
            public.refund_project_outreach_pre_setwise_v1(
              jsonb_build_array(item.case_json),p_has_operations_access)->0,
            '{lifecycle}',
            (public.refund_project_outreach_pre_setwise_v1(
              jsonb_build_array(item.case_json),p_has_operations_access)
              ->0->'lifecycle')-'nextWork'-'decisionRecommendation',true)
          else public.refund_project_outreach_pre_setwise_v1(
            jsonb_build_array(item.case_json),p_has_operations_access)->0 end
      end
      order by item.case_order), '[]'::jsonb) end
  from jsonb_array_elements(case when jsonb_typeof(p_cases)='array'
      then p_cases else '[]'::jsonb end)
    with ordinality item(case_json,case_order)
  left join public.refund_cases current_case
    on current_case.id=case when coalesce(item.case_json->>'id','') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (item.case_json->>'id')::uuid end;
$$;
revoke all on function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) from public,anon,authenticated;
grant execute on function public.refund_project_customer_outreach_cases_for_manager(
  jsonb,boolean) to service_role;

alter function public.refund_project_current_next_work_cases(jsonb)
  rename to refund_project_next_work_pre_setwise_v1;
revoke all on function public.refund_project_next_work_pre_setwise_v1(jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_project_current_next_work_cases(p_cases jsonb)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select case when jsonb_typeof(p_cases) is distinct from 'array' then p_cases
    else coalesce(jsonb_agg(
      case when current_case.id is not null
        and jsonb_typeof(item.case_json)='object'
        and jsonb_typeof(item.case_json->'lifecycle')='object'
        and item.case_json#>>'{lifecycle,schemaVersion}'='refund_lifecycle_v2'
        and item.case_json#>>'{lifecycle,payloadRedacted}'='true'
        and item.case_json->>'officialActionVersion'=
          current_case.official_action_version::text
        and jsonb_typeof(item.case_json#>'{lifecycle,customerOutreach}')='object'
        and item.case_json#>>'{lifecycle,customerOutreach,schemaVersion}'=
          'refund_customer_outreach_v1'
        and item.case_json#>>'{lifecycle,customerOutreach,payloadRedacted}'='true'
        and item.case_json#>>'{lifecycle,customerOutreach,caseFactVersion}'=
          current_case.deterministic_fact_version::text
        and jsonb_typeof(item.case_json#>'{lifecycle,nextWork}')='object'
        and item.case_json#>>'{lifecycle,nextWork,schemaVersion}'='refund_next_work_v1'
        and item.case_json#>>'{lifecycle,nextWork,payloadRedacted}'='true'
        and jsonb_typeof(item.case_json#>'{lifecycle,nextWork,isOpen}')='boolean'
        and item.case_json#>>'{lifecycle,nextWork,actor}' in
          ('manager','system','agent','customer')
        and jsonb_typeof(to_jsonb(item.case_json#>>'{lifecycle,nextWork,actionCode}'))='string'
        and item.case_json->'lifecycle'?'decisionRecommendation'
        and (
          item.case_json#>'{lifecycle,decisionRecommendation}'='null'::jsonb
          or (
            jsonb_typeof(item.case_json#>'{lifecycle,decisionRecommendation}')='object'
            and item.case_json#>>'{lifecycle,decisionRecommendation,schemaVersion}'=
              'refund_decision_recommendation_v1'
            and item.case_json#>>'{lifecycle,decisionRecommendation,payloadRedacted}'='true'
            and item.case_json#>>'{lifecycle,decisionRecommendation,officialActionVersion}'=
              current_case.official_action_version::text
            and item.case_json#>>'{lifecycle,decisionRecommendation,deterministicFactVersion}'=
              current_case.deterministic_fact_version::text
            and item.case_json#>>'{lifecycle,decisionRecommendation,kind}' in ('refund','reject')
            and nullif(btrim(item.case_json#>>'{lifecycle,decisionRecommendation,summary}'),'') is not null
            and jsonb_typeof(item.case_json#>'{lifecycle,decisionRecommendation,decisionReady}')='boolean'
            and (
              (item.case_json#>>'{lifecycle,decisionRecommendation,decisionReady}'='true'
                and item.case_json#>>'{lifecycle,nextWork,actor}'='manager'
                and item.case_json#>>'{lifecycle,nextWork,actionCode}'=case
                  item.case_json#>>'{lifecycle,decisionRecommendation,kind}'
                  when 'reject' then 'reject_request'
                  else 'approve_or_deny_request' end)
              or (item.case_json#>>'{lifecycle,decisionRecommendation,decisionReady}'='false'
                and item.case_json#>>'{lifecycle,nextWork,actor}'='agent'
                and item.case_json#>>'{lifecycle,nextWork,actionCode}'='resolve_manager_assignment'))
            and (
              (item.case_json#>>'{lifecycle,decisionRecommendation,kind}'='reject'
                and item.case_json#>>'{lifecycle,decisionRecommendation,reasonCode}'='no_match_after_30_days'
                and item.case_json#>'{lifecycle,decisionRecommendation,purchase}'='null'::jsonb)
              or (item.case_json#>>'{lifecycle,decisionRecommendation,kind}'='refund'
                and item.case_json#>>'{lifecycle,decisionRecommendation,reasonCode}'='clear_purchase_match'
                and jsonb_typeof(item.case_json#>'{lifecycle,decisionRecommendation,purchase}')='object'
                and item.case_json#>>'{lifecycle,decisionRecommendation,purchase,source}' in ('nayax','sunze')
                and item.case_json#>>'{lifecycle,decisionRecommendation,purchase,source}'=case current_case.payment_method
                  when 'card' then 'nayax' when 'cash' then 'sunze' end
                and item.case_json#>>'{lifecycle,decisionRecommendation,purchase,amountCents}' ~ '^[1-9][0-9]*$'
                and item.case_json#>>'{lifecycle,decisionRecommendation,purchase,currencyCode}' ~ '^[A-Z]{3}$'
                and item.case_json#>>'{lifecycle,decisionRecommendation,purchase,timeMeaning}' in ('purchase','unknown')
                and jsonb_typeof(item.case_json#>'{lifecycle,decisionRecommendation,purchase,transactionAt}') in ('string','null')))))
        and item.case_json#>>'{nayaxLookupWork,state}' in ('complete','refund_operations')
        then item.case_json
        else public.refund_project_next_work_pre_setwise_v1(
          jsonb_build_array(item.case_json))->0 end
      order by item.case_order), '[]'::jsonb) end
  from jsonb_array_elements(case when jsonb_typeof(p_cases)='array'
      then p_cases else '[]'::jsonb end)
    with ordinality item(case_json,case_order)
  left join public.refund_cases current_case
    on current_case.id=case when coalesce(item.case_json->>'id','') ~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (item.case_json->>'id')::uuid end;
$$;
revoke all on function public.refund_project_current_next_work_cases(jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_project_current_next_work_cases(jsonb)
  to service_role;

comment on function public.refund_project_lifecycle_v2_cases(jsonb) is
  'Reuses exact current case/fact/action lifecycle contracts and delegates stale rows to the retained canonical projector.';
comment on function public.refund_project_nayax_lookup_recovery_cases_for_manager(jsonb,boolean) is
  'Projects case-owned lookup work set-wise while retaining the exact prior per-case contract.';
comment on function public.refund_project_customer_outreach_cases_for_manager(jsonb,boolean) is
  'Projects current or fallback customer outreach set-wise without repeatedly copying the growing case array.';
comment on function public.refund_project_current_next_work_cases(jsonb) is
  'Validates and repairs current next-work contracts per case, then aggregates the collection once.';

-- The final correction-scope parity layer below this historical wrapper always
-- replaces customerCorrectionFields for both visible collections from the
-- current authoritative helper. Do not calculate the same field here and then
-- throw it away; keep the independent customerCorrection context unchanged.
create or replace function public.admin_get_refund_operations_overview_pre_revision()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare base jsonb; enriched jsonb;
begin
  base := public.admin_get_refund_operations_overview_pre_purchase_correction();
  select coalesce(jsonb_agg(item.value||jsonb_build_object(
    'customerCorrection', case when r.id is null then null else jsonb_build_object(
      'state',case when r.status='pending' and r.expires_at<=statement_timestamp() then 'expired' else r.status end,
      'requestedAt',r.issued_at,'respondedAt',r.consumed_at,'expiresAt',r.expires_at,
      'requestedFields',r.correction_requested_fields,'answers',r.correction_response,'previousValues',r.correction_snapshot,
      'isActive',r.status='pending' and r.expires_at>statement_timestamp()
        and r.correction_fact_version=current_case.deterministic_fact_version and public.refund_purchase_correction_eligible(current_case)
        and m.recipient_email=current_case.customer_email and m.status in ('pending','sent')
        and coalesce(m.delivery_state,'') not in ('failed','bounced','complained') and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)),
      'isUsable',r.status='pending' and r.expires_at>statement_timestamp()
        and r.correction_fact_version=current_case.deterministic_fact_version and public.refund_purchase_correction_eligible(current_case)
        and m.recipient_email=current_case.customer_email and m.status='sent'
        and coalesce(m.delivery_state,'') not in ('failed','bounced','complained') and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)),
      'deliveryState',m.delivery_state,'deliveryStatus',m.status,'recheckState',r.correction_recheck_state,'nextAction',r.correction_next_action
    ) end) order by item.ordinality),'[]') into enriched
  from jsonb_array_elements(coalesce(base->'cases','[]')) with ordinality item
  join public.refund_cases current_case on current_case.id=(item.value->>'id')::uuid
  left join lateral(select * from public.refund_wallet_correction_contexts ctx where ctx.refund_case_id=(item.value->>'id')::uuid
    and ctx.correction_kind='purchase' order by ctx.issued_at desc limit 1) r on true
  left join public.refund_case_messages m on m.id=r.correction_message_id;
  return jsonb_set(base,'{cases}',enriched,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview_pre_revision()
  from public,anon,authenticated,service_role;

-- Every retained correction-field implementation begins by returning an empty
-- scope for an ineligible case. Put that invariant ahead of the historical
-- compatibility chain so decided, terminal, and Internal/test rows do not walk
-- several generations of candidate-evidence reconciliation only to return [].
alter function public.refund_purchase_correction_request_fields(uuid)
  rename to refund_purchase_correction_fields_pre_eligibility_fast_path_v1;
revoke all on function public.refund_purchase_correction_fields_pre_eligibility_fast_path_v1(uuid)
  from public,anon,authenticated,service_role;

create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path=''
as $$
declare current_case public.refund_cases%rowtype;
begin
  select c.* into current_case from public.refund_cases c where c.id=p_case_id;
  if current_case.id is null
    or not public.refund_purchase_correction_eligible(current_case) then
    return '{}'::text[];
  end if;
  return public.refund_purchase_correction_fields_pre_eligibility_fast_path_v1(
    p_case_id);
end;
$$;
revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public,anon,authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;

comment on function public.refund_purchase_correction_request_fields(uuid) is
  'Returns no customer correction scope for an ineligible case before delegating eligible current cases to the retained exact correction-field contract.';

select pg_notify('pgrst','reload schema');
