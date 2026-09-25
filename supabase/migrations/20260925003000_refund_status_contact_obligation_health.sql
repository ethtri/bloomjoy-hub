-- An issued deterministic status notice is already a durable, purpose-bound
-- customer-contact obligation. Project its current effect from the existing
-- message ledger; do not enqueue or resend historical failures here.
create function public.service_get_refund_status_contact_obligation_health()
returns jsonb language sql stable security definer set search_path='' as $$
  with issued as (
    select m.id,m.refund_case_id,m.reason_code,m.status,m.created_at,m.sent_at,
      m.error_message,m.delivery_state,m.delivery_transport,m.provider_message_id,
      m.manual_delivery_provider_attempted_at,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status in ('pending_send','sent','delivery_unknown')) outbound_attempt,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='sent' and g.sent_at is not null
          and nullif(btrim(g.provider_message_id),'') is not null) gmail_accepted,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='delivery_unknown') gmail_unknown,
      exists(select 1 from public.refund_gmail_messages g
        where g.refund_case_message_id=m.id and g.direction='outbound'
          and g.status='failed' and g.provider_message_id is null
          and g.provider_message_header is null) gmail_known_failed,
      exists(select 1 from public.refund_case_messages later
        where later.refund_case_id=m.refund_case_id and later.id<>m.id
          and later.status='sent' and later.sent_at>m.created_at
          and lower(btrim(later.recipient_email))=lower(btrim(c.customer_email))
          and later.delivery_state is distinct from 'failed'
          and later.delivery_state is distinct from 'bounced'
          and later.delivery_state is distinct from 'complained'
          and later.manual_delivery_state is distinct from 'delivery_unknown'
          and later.manual_delivery_state is distinct from 'failed'
          and ((later.message_type='status_update'
                and later.reason_code=m.reason_code
                and later.template_version='refund_customer_status_v1')
            or later.message_type in ('completed','denied'))
      ) later_authoritative_contact
    from public.refund_case_messages m
    join public.refund_cases c on c.id=m.refund_case_id
    where m.message_type='status_update'
      and m.delivery_kind='automatic'
      and m.content_source='deterministic_template'
      and m.template_version='refund_customer_status_v1'
      and m.reason_code in ('sla_at_risk','provider_delay')
  ), classified as (
    select issued.*,
      case
        when later_authoritative_contact then 'resolved_by_later_contact'
        when delivery_state in ('failed','bounced','complained')
          or gmail_known_failed then 'definite_failure'
        -- An exact accepted transport receipt remains authoritative if the
        -- subsequent parent sent/failed write did not commit.
        when gmail_accepted or (delivery_transport='resend'
          and delivery_state='accepted' and provider_message_id is not null)
          then 'accepted'
        when status='sent' and sent_at is not null then 'accepted'
        when status='failed' and (manual_delivery_provider_attempted_at is not null
          or provider_message_id is not null or delivery_transport is not null
          or outbound_attempt or error_message='delivery_unknown') then 'unknown_effect'
        when status='failed' then 'definite_failure'
        -- A fresh provider-start/uncertain Gmail effect is not a queued send.
        -- A mere Gmail pending_send reservation is still queued until it ages.
        when status='pending' and (gmail_unknown
          or manual_delivery_provider_attempted_at is not null
          or provider_message_id is not null
          or delivery_transport='resend') then 'unknown_effect'
        when status='pending' and created_at<statement_timestamp()-interval '60 minutes'
          then 'aging_queued'
        when status='pending' then 'queued'
        else 'unresolved_policy'
      end obligation_state
    from issued
  ), unresolved as (
    select * from classified
    where obligation_state in ('definite_failure','unknown_effect',
      'aging_queued','unresolved_policy')
  )
  select jsonb_build_object(
    'status',case when count(*)>0 then 'action_needed' else 'healthy' end,
    'unresolvedCount',count(*),
    'definiteFailureCount',count(*) filter(where obligation_state='definite_failure'),
    'unknownEffectCount',count(*) filter(where obligation_state='unknown_effect'),
    'agingQueuedCount',count(*) filter(where obligation_state='aging_queued'),
    'oldestAgeSeconds',max(extract(epoch from
      (statement_timestamp()-created_at)))::bigint,
    'reasonCounts',coalesce((select jsonb_object_agg(reason_code,n) from (
      select reason_code,count(*)::integer n from unresolved group by reason_code
    ) reason_totals),'{}'::jsonb),
    'owner','Agent',
    'nextStep',case when count(*)>0
      then 'Reconcile the exact customer notice and its transport evidence.'
      else null end,
    'payloadRedacted',true)
  from unresolved;
$$;
revoke all on function public.service_get_refund_status_contact_obligation_health()
  from public,anon,authenticated;
grant execute on function public.service_get_refund_status_contact_obligation_health()
  to service_role;

comment on function public.service_get_refund_status_contact_obligation_health() is
  'Service-only redacted health for existing deterministic status-message obligations; same-purpose or terminal sent contact may supersede an old failure, while raw accepted-sent webhook unknown does not create a retry obligation.';
