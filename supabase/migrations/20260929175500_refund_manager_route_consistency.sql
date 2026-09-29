-- #628: keep the generic Manager queue aligned with the canonical decision work.
-- Authority remains any current machine Manager or Super-admin; this projection
-- repair does not assign a case, authorize a decision, send, or move money.

alter function public.refund_next_work_for_case(uuid,jsonb)
  rename to refund_next_work_for_case_pre_manager_route_v1;
revoke all on function public.refund_next_work_for_case_pre_manager_route_v1(
  uuid,jsonb) from public,anon,authenticated,service_role;

create function public.refund_next_work_for_case(
  p_refund_case_id uuid,p_lifecycle jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  result jsonb;
  work jsonb;
  queue jsonb;
begin
  result:=public.refund_next_work_for_case_pre_manager_route_v1(
    p_refund_case_id,p_lifecycle);
  if result is null then return null; end if;

  work:=result->'nextWork';
  if jsonb_typeof(work)='object'
    and work->>'schemaVersion'='refund_next_work_v1'
    and work->>'payloadRedacted'='true'
    and work->>'isOpen'='true'
    and work->>'actor'='manager'
    and work->>'actionCode' in ('approve_or_deny_request','reject_request')
    and result#>>'{decisionRecommendation,decisionReady}'='true' then
    queue:=case when jsonb_typeof(result->'managerQueue')='object'
      then result->'managerQueue' else '{}'::jsonb end;
    result:=result||jsonb_build_object(
      'managerNextAction',work->>'actionCode',
      'managerQueue',queue||jsonb_build_object(
        'schemaVersion','refund_manager_queue_v2',
        'bucket','needs_action',
        'label','Decision needed',
        'nextAction',work->>'actionCode',
        'safeRetryEligible',false,
        'payloadRedacted',true));
  end if;
  return result;
end;
$$;

revoke all on function public.refund_next_work_for_case(uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_next_work_for_case(uuid,jsonb)
  to service_role;

comment on function public.refund_next_work_for_case(uuid,jsonb) is
  'Projects canonical next work and keeps the generic Manager queue aligned with a current recommendation. It grants no decision, payment, assignment, or messaging authority.';

select pg_notify('pgrst','reload schema');
