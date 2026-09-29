-- #628: the fast overview path may retain a structurally valid System lookup
-- action after the current case has returned to Agent-owned purchase research.
-- Recheck only that narrow, uncommon shape against current case truth. This
-- preserves the set-wise fast path for every other row and never widens an
-- actor-scoped projection that already removed nextWork.

alter function public.refund_project_current_next_work_cases(jsonb)
  rename to refund_project_next_work_pre_identity_repair_v1;
revoke all on function public.refund_project_next_work_pre_identity_repair_v1(jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_project_current_next_work_cases(p_cases jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  projected jsonb;
  result jsonb:='[]'::jsonb;
  case_json jsonb;
  original_case_json jsonb;
  canonical_lifecycle jsonb;
  canonical_lookup jsonb;
  canonical_next_work jsonb;
  case_order bigint;
  case_id uuid;
begin
  projected:=public.refund_project_next_work_pre_identity_repair_v1(p_cases);
  if jsonb_typeof(projected) is distinct from 'array' then return projected; end if;

  for case_json,case_order in
    select value,ordinality
    from jsonb_array_elements(projected) with ordinality
  loop
    original_case_json:=p_cases->((case_order-1)::integer);
    if jsonb_typeof(original_case_json#>'{lifecycle,nextWork}')='object'
      and jsonb_typeof(case_json#>'{lifecycle,nextWork}')='object'
      and case_json#>>'{lifecycle,nextWork,actor}'='system'
      and case_json#>>'{lifecycle,nextWork,actionCode}'='run_lookup'
      and coalesce(case_json->>'id','') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then
      case_id:=(case_json->>'id')::uuid;
      canonical_lifecycle:=public.refund_lifecycle_contract(case_id);
      canonical_lookup:=public.refund_project_nayax_lookup_recovery_cases_for_manager(
        jsonb_build_array(jsonb_build_object(
          'id',case_id,'lifecycle',canonical_lifecycle)),true)->0;
      canonical_next_work:=canonical_lifecycle->'nextWork';
      if canonical_lookup#>>'{nayaxLookupWork,state}'='system' then
        canonical_next_work:=coalesce(canonical_next_work,'{}'::jsonb)
          ||jsonb_build_object(
            'schemaVersion','refund_next_work_v1','isOpen',true,
            'actor','system','actionCode','run_lookup',
            'actionLabel','Check the purchase through the existing read-only lookup.',
            'blocker',null,'payloadRedacted',true);
      end if;
      if jsonb_typeof(canonical_next_work)='object'
        and (
          canonical_next_work->>'actor' is distinct from
            case_json#>>'{lifecycle,nextWork,actor}'
          or canonical_next_work->>'actionCode' is distinct from
            case_json#>>'{lifecycle,nextWork,actionCode}'
          or nullif(canonical_next_work#>>'{blocker,code}','') is distinct from
            nullif(case_json#>>'{lifecycle,nextWork,blocker,code}','')
        )
      then
        case_json:=jsonb_set(case_json,'{lifecycle,nextWork}',
          canonical_next_work,true);
      end if;
    end if;
    result:=result||jsonb_build_array(case_json);
  end loop;
  return result;
end;
$$;

revoke all on function public.refund_project_current_next_work_cases(jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_project_current_next_work_cases(jsonb)
  to service_role;

comment on function public.refund_project_current_next_work_cases(jsonb) is
  'Preserves set-wise next-work reuse and repairs only stale System lookup work from current case identity.';

select pg_notify('pgrst','reload schema');
