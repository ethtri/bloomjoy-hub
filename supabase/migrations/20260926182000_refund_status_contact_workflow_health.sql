-- Preserve the existing scheduler/digest/ready/completion snapshot and incident
-- route. The status-contact ledger adds one purpose-bound delivery lane.
alter function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  rename to service_get_refund_workflow_health_pre_status_contact_20260925;
revoke all on function public.service_get_refund_workflow_health_pre_status_contact_20260925(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated,service_role;

create function public.service_get_refund_workflow_health(
  p_automation_enabled boolean,
  p_customer_contact_enabled boolean,
  p_manual_outbox_enabled boolean,
  p_manager_digest_enabled boolean,
  p_manager_ready_enabled boolean,
  p_mailbox_identities text[],
  p_observed_at timestamptz default statement_timestamp()
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  base jsonb;
  contact jsonb;
  contact_valid boolean:=false;
  blocked text[];
  delivery_status text;
  workflow_status text;
  overall_status text;
begin
  base:=public.service_get_refund_workflow_health_pre_status_contact_20260925(
    p_automation_enabled,p_customer_contact_enabled,p_manual_outbox_enabled,
    p_manager_digest_enabled,p_manager_ready_enabled,p_mailbox_identities,
    p_observed_at);
  if to_regprocedure('public.service_get_refund_status_contact_obligation_health()')
    is not null then
    execute 'select public.service_get_refund_status_contact_obligation_health()'
      into contact;
    if contact is not null and contact->>'payloadRedacted'='true'
      and contact->>'status' in ('healthy','action_needed')
      and coalesce(contact->>'unresolvedCount','') ~ '^[0-9]{1,12}$' then
      contact_valid:=case when contact->>'status'='healthy'
        then (contact->>'unresolvedCount')::bigint=0
        else (contact->>'unresolvedCount')::bigint>0 end;
    end if;
  end if;
  if not contact_valid then
    contact:=jsonb_build_object('status','instrumentation_unavailable',
      'reason','status_contact_projection_unavailable','payloadRedacted',true);
  end if;
  select coalesce(array_agg(value order by ordinal),'{}'::text[]) into blocked
  from jsonb_array_elements_text(coalesce(base->'blockedReasons','[]'::jsonb))
    with ordinality as reasons(value,ordinal);
  delivery_status:=base->>'deliveryStatus';
  workflow_status:=base->>'workflowStatus';
  overall_status:=base->>'status';
  if contact->>'status'='action_needed' then
    if not 'customer_status_obligation'=any(blocked) then
      blocked:=array_append(blocked,'customer_status_obligation');
    end if;
    delivery_status:='degraded';
    workflow_status:='degraded';
    if overall_status not in ('failing','stale') then
      overall_status:='failing';
    end if;
  elsif not contact_valid then
    if delivery_status<>'degraded' then
      delivery_status:='instrumentation_unavailable';
    end if;
    if workflow_status<>'degraded' then
      workflow_status:='instrumentation_unavailable';
    end if;
    if overall_status='healthy' then overall_status:='waiting'; end if;
  end if;
  return base || jsonb_build_object(
    'status',overall_status,'workflowStatus',workflow_status,
    'deliveryStatus',delivery_status,'blockedReasons',to_jsonb(blocked),
    'customerStatusDelivery',contact,'payloadRedacted',true);
end;
$$;

revoke all on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  from public,anon,authenticated;
grant execute on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz)
  to service_role;

comment on function public.service_get_refund_workflow_health(
  boolean,boolean,boolean,boolean,boolean,text[],timestamptz) is
  'Shared redacted refund workflow health including issued status-contact obligations. A missing or malformed status projection cannot promote delivery health; actionable work uses the existing workflow incident route.';
