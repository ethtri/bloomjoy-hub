-- #628: System lookup work shown in the portal must match work the production
-- lookup claimant can actually execute. The broad lookup projection intentionally
-- describes provider capability, but it does not include every claimant exclusion.
-- Keep actively checking work visible; for scheduled work, apply the claimant's
-- current case-level exclusions before overriding canonical Agent next work.

create or replace function public.refund_project_current_next_work_cases(p_cases jsonb)
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
  lookup_is_executable boolean;
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

      select case
        when c.nayax_lookup_status='checking' then true
        else c.matched_nayax_transaction_id is null
          and c.reporting_adjustment_id is null
          and c.manual_refund_reference is null
          and c.duplicate_of_refund_case_id is null
          and not public.refund_case_has_unresolved_reconciliation(c.id)
          and not exists (
            select 1 from public.refund_authoritative_receipts receipt
            where receipt.refund_case_id=c.id)
          and not exists (
            select 1 from public.refund_case_nayax_refund_attempts attempt
            where attempt.refund_case_id=c.id)
        end
      into lookup_is_executable
      from public.refund_cases c
      where c.id=case_id;

      if canonical_lookup#>>'{nayaxLookupWork,state}'='system'
        and lookup_is_executable is true then
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
  'Preserves set-wise next-work reuse and repairs stale System lookup work against current claimant exclusions.';

select pg_notify('pgrst','reload schema');

