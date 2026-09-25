-- The legacy wallet-ready sender can run after the ready lane is disabled.
-- Preserve a material-decision/recipient overlap in the shared action ledger
-- across that rollback, including unknown provider outcomes.
create function public.service_refund_manager_wallet_ready_overlap(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  existing record;
begin
  select action.id,action.delivery_state,action.attention_version
    into existing
  from public.refund_cases refund_case
  join public.refund_manager_notification_actions action
    on action.refund_case_id=refund_case.id
    and action.notice_reason='decision_ready'
    and action.delivery_state in ('sent','delivery_unknown')
    and action.route_type='manager'
    and action.provider_attempt_started_at is not null
    and action.ready_decision_fingerprint=
      public.refund_manager_decision_material_fingerprint(
        refund_case.id,action.ready_action_code)
  join public.reporting_machine_refund_managers mapping
    on mapping.reporting_machine_id=refund_case.reporting_machine_id
    and mapping.manager_user_id=action.ready_manager_user_id
    and mapping.status='active' and mapping.revoked_at is null
  join public.refund_manager_notification_recipients recipient
    on recipient.action_id=action.id
    and recipient.recipient_fingerprint=encode(extensions.digest(convert_to(
      lower(btrim(mapping.manager_email)),'UTF8'),'sha256'),'hex')
  where refund_case.id=p_refund_case_id
  order by action.provider_attempt_started_at desc,action.id desc limit 1;
  return jsonb_build_object(
    'blocked',existing.id is not null,
    'readyActionId',existing.id,
    'deliveryState',existing.delivery_state,
    'attentionVersion',existing.attention_version,
    'payloadRedacted',true);
end $$;
revoke all on function public.service_refund_manager_wallet_ready_overlap(uuid)
  from public,anon,authenticated;
grant execute on function public.service_refund_manager_wallet_ready_overlap(uuid)
  to service_role;

alter function public.service_begin_refund_manager_notification(
  uuid,text,text,text[],text[])
  rename to service_begin_refund_manager_notification_pre_ready_rollback_20260924;

create function public.service_begin_refund_manager_notification(
  p_refund_case_id uuid,p_notice_reason text,p_customer_email text,
  p_mailbox_identities text[],p_ops_fallback_recipients text[]
)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare
  case_row public.refund_cases%rowtype;
  overlap jsonb;
begin
  if p_notice_reason='wallet_match_ready' then
    select * into case_row from public.refund_cases
      where id=p_refund_case_id for update;
    if case_row.id is null then raise exception 'Refund case not found'; end if;
    if lower(btrim(case_row.customer_email)) is distinct from
      lower(btrim(coalesce(p_customer_email,''))) then
      raise exception 'Customer recipient must match the refund case';
    end if;
    overlap:=public.service_refund_manager_wallet_ready_overlap(p_refund_case_id);
    if overlap->>'blocked'='true' then
      return jsonb_build_object(
        'actionId',overlap->>'readyActionId','claimed',false,'created',false,
        'channel','immediate','urgency','actionable',
        'deliveryState',overlap->>'deliveryState',
        'attentionVersion',(overlap->>'attentionVersion')::bigint,
        'reason','ready_decision_already_notified','payloadRedacted',true);
    end if;
  end if;
  return public.service_begin_refund_manager_notification_pre_ready_rollback_20260924(
    p_refund_case_id,p_notice_reason,p_customer_email,
    p_mailbox_identities,p_ops_fallback_recipients);
end $$;
revoke all on function public.service_begin_refund_manager_notification(
  uuid,text,text,text[],text[]) from public,anon,authenticated;
grant execute on function public.service_begin_refund_manager_notification(
  uuid,text,text,text[],text[]) to service_role;

alter function public.service_mark_refund_manager_notification_provider_started(uuid,uuid)
  rename to service_mark_refund_manager_notification_provider_started_pre_ready_rollback_20260924;

create function public.service_mark_refund_manager_notification_provider_started(
  p_action_id uuid,p_claim_token uuid
)
returns boolean language plpgsql volatile security invoker set search_path='' as $$
declare
  action_row public.refund_manager_notification_actions%rowtype;
  case_row public.refund_cases%rowtype;
  overlap jsonb;
begin
  select * into action_row from public.refund_manager_notification_actions
    where id=p_action_id for update;
  if action_row.id is null or action_row.claim_token is distinct from p_claim_token
    or action_row.delivery_state<>'reserved' then return false; end if;
  if action_row.notice_reason='wallet_match_ready' then
    select * into case_row from public.refund_cases
      where id=action_row.refund_case_id for update;
    if case_row.id is null then return false; end if;
    overlap:=public.service_refund_manager_wallet_ready_overlap(case_row.id);
    if overlap->>'blocked'='true' then return false; end if;
  end if;
  return public.service_mark_refund_manager_notification_provider_started_pre_ready_rollback_20260924(
    p_action_id,p_claim_token);
end $$;
revoke all on function public.service_mark_refund_manager_notification_provider_started(
  uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_mark_refund_manager_notification_provider_started(
  uuid,uuid) to service_role;

select pg_notify('pgrst','reload schema');
