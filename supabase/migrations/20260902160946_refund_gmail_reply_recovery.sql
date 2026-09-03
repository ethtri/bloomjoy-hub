-- Read the private application receipt before deciding that an unchanged reply
-- is a no-op. This grants no table access and does not claim or run a lookup.
create function public.service_get_refund_gmail_fact_application_v1(
  p_refund_case_id uuid,
  p_gmail_message_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  source_row public.refund_gmail_messages%rowtype;
  application_row public.refund_customer_fact_applications%rowtype;
  current_version bigint;
begin
  select message.* into source_row
  from public.refund_gmail_messages message
  where message.id = p_gmail_message_id;
  if source_row.id is null
    or source_row.refund_case_id is distinct from p_refund_case_id
    or source_row.direction is distinct from 'inbound'
    or source_row.message_kind is distinct from 'message'
    or source_row.status is distinct from 'received'
    or source_row.participant_role is distinct from 'customer'
    or source_row.participant_trust is distinct from 'verified' then
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;

  select application.* into application_row
  from public.refund_customer_fact_applications application
  where application.gmail_message_id = p_gmail_message_id;
  if application_row.gmail_message_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'not_applied');
  end if;

  -- Require the immutable, redacted audit receipt for this exact case/version.
  if application_row.refund_case_id is distinct from p_refund_case_id
    or not exists (
      select 1 from public.refund_case_events event
      where event.id = application_row.event_id
        and event.refund_case_id = p_refund_case_id
        and event.event_type = 'gmail_customer_facts_applied'
        and event.metadata ->> 'resulting_fact_version'
          = application_row.resulting_fact_version::text
        and event.metadata ->> 'payload_redacted' = 'true'
    ) then
    return pg_catalog.jsonb_build_object('outcome', 'conflict');
  end if;

  select refund_case.deterministic_fact_version into current_version
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id;
  if current_version is distinct from application_row.resulting_fact_version then
    return pg_catalog.jsonb_build_object('outcome', 'stale');
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'already_applied',
    'factVersion', application_row.resulting_fact_version,
    'appliedFields', application_row.applied_fields
  );
end;
$$;

revoke all on function public.service_get_refund_gmail_fact_application_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.service_get_refund_gmail_fact_application_v1(uuid, uuid)
  to service_role;

comment on function public.service_get_refund_gmail_fact_application_v1(uuid, uuid) is
  'Service-only redacted receipt for a verified same-case Gmail fact application. Stale receipts cannot authorize a current-version lookup; no customer or provider side effects.';
