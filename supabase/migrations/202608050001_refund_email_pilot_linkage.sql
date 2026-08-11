-- Email-only refund pilot linkage.
--
-- The generic first-contact acknowledgement is the sole customer message that
-- may be sent before a machine is known. It contains one opaque, short-lived
-- hosted-form context token and no manager CC. Once the hosted form resolves
-- the machine, every case-specific message continues to use the existing
-- current-manager CC boundary. This migration enables no runtime switch.

alter table public.refund_gmail_messages
  drop constraint if exists refund_gmail_messages_recipient_resolution_check;
alter table public.refund_gmail_messages
  add constraint refund_gmail_messages_recipient_resolution_check check (
    recipient_resolution_status is null
    or recipient_resolution_status in (
      'resolved',
      'resolved_with_exclusions',
      'machine_unresolved',
      'no_active_managers',
      'invalid_manager_mapping',
      'premapping_acknowledgement'
    )
  );

create table if not exists public.refund_gmail_intake_links (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null unique
    references public.refund_gmail_first_contact_operations (id) on delete cascade,
  refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint refund_gmail_intake_link_expiry_check check (
    expires_at > created_at and expires_at <= created_at + interval '30 days'
  )
);

create index if not exists refund_gmail_intake_links_case_idx
  on public.refund_gmail_intake_links (refund_case_id, created_at desc);
create index if not exists refund_gmail_intake_links_active_idx
  on public.refund_gmail_intake_links (expires_at)
  where used_at is null;

alter table public.refund_gmail_intake_links enable row level security;
revoke all on table public.refund_gmail_intake_links from public, anon, authenticated;
grant select, insert, update on table public.refund_gmail_intake_links to service_role;

comment on table public.refund_gmail_intake_links is
  'Private, hashed, one-time context that lets a hosted form complete its originating Gmail draft case without exposing a case identifier.';

create or replace function public.service_register_refund_gmail_intake_link(
  p_operation_id uuid,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.refund_gmail_first_contact_operations;
begin
  if p_operation_id is null
    or coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
    or p_expires_at <= now()
    or p_expires_at > now() + interval '30 days' then
    return false;
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations operation
  where operation.id = p_operation_id
  for update;

  if operation_row.id is null
    or operation_row.mode not in ('isolated_test', 'active')
    or operation_row.status <> 'pending_send' then
    return false;
  end if;

  insert into public.refund_gmail_intake_links (
    operation_id,
    refund_case_id,
    token_hash,
    expires_at
  ) values (
    operation_row.id,
    operation_row.refund_case_id,
    lower(p_token_hash),
    p_expires_at
  )
  on conflict (operation_id) do update
  set
    token_hash = excluded.token_hash,
    expires_at = excluded.expires_at
  where public.refund_gmail_intake_links.used_at is null;

  return found;
end;
$$;

revoke execute on function public.service_register_refund_gmail_intake_link(uuid,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.service_register_refund_gmail_intake_link(uuid,text,timestamptz)
  to service_role;

create or replace function public.service_prepare_refund_gmail_first_contact_delivery(
  p_operation_id uuid,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_row public.refund_gmail_first_contact_operations;
  source_row public.refund_gmail_messages;
  transport_row public.refund_gmail_messages;
  case_row public.refund_cases;
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(
    p_mailbox_identities
  );
  route_changed boolean := false;
begin
  if p_operation_id is null or cardinality(mailbox_identities) = 0 then
    raise exception 'Valid first-contact operation and mailbox identities required';
  end if;

  select * into operation_row
  from public.refund_gmail_first_contact_operations operation
  where operation.id = p_operation_id
  for update;

  if operation_row.id is null then
    return jsonb_build_object('allowed', false, 'status', 'operation_not_found');
  end if;
  if operation_row.mode not in ('isolated_test', 'active')
    or operation_row.status <> 'pending_send' then
    return jsonb_build_object('allowed', false, 'status', 'operation_not_sendable');
  end if;

  select * into source_row
  from public.refund_gmail_messages message
  where message.id = operation_row.source_message_id
  for update;

  select * into transport_row
  from public.refund_gmail_messages message
  where message.id = operation_row.transport_message_id
  for update;

  select * into case_row
  from public.refund_cases refund_case
  where refund_case.id = operation_row.refund_case_id
  for update;

  if source_row.id is null
    or transport_row.id is null
    or case_row.id is null
    or source_row.refund_case_id is distinct from case_row.id
    or transport_row.refund_case_id is distinct from case_row.id
    or source_row.gmail_thread_id is distinct from operation_row.gmail_thread_id
    or transport_row.gmail_thread_id is distinct from operation_row.gmail_thread_id
    or source_row.direction <> 'inbound'
    or source_row.message_kind <> 'message'
    or source_row.status <> 'received'
    or source_row.participant_role <> 'customer'
    or source_row.participant_trust <> 'verified'
    or lower(btrim(coalesce(source_row.sender_email, ''))) <>
      lower(btrim(case_row.customer_email))
    or lower(btrim(coalesce(transport_row.recipient_email, ''))) <>
      lower(btrim(case_row.customer_email))
    or transport_row.direction <> 'outbound'
    or transport_row.message_kind <> 'message'
    or transport_row.status <> 'pending_send'
    or not exists (
      select 1
      from public.refund_gmail_intake_links link
      where link.operation_id = operation_row.id
        and link.refund_case_id = case_row.id
        and link.used_at is null
        and link.expires_at > now()
    ) then
    return jsonb_build_object(
      'allowed', false,
      'status', 'first_contact_evidence_invalid'
    );
  end if;

  if case_row.status in ('approved', 'denied', 'completed', 'closed')
    or case_row.decision is not null then
    return jsonb_build_object('allowed', false, 'status', 'terminal_case');
  end if;

  perform thread.id
  from public.refund_gmail_threads thread
  where thread.refund_case_id = case_row.id
  order by thread.id
  for update;

  if exists (
    select 1
    from public.refund_gmail_threads thread
    where thread.refund_case_id = case_row.id
      and thread.automatic_customer_contact_paused_at is not null
  ) then
    return jsonb_build_object(
      'allowed', false,
      'status', 'automatic_contact_paused'
    );
  end if;

  route_changed := transport_row.recipient_cc_count is distinct from 0
    or transport_row.recipient_resolution_status is distinct from
      'premapping_acknowledgement'
    or transport_row.delivery_kind is distinct from 'automatic'
    or transport_row.participant_role is distinct from 'mailbox'
    or transport_row.participant_trust is distinct from 'verified';

  update public.refund_gmail_messages
  set
    recipient_cc_emails = '{}'::text[],
    recipient_cc_count = 0,
    recipient_resolution_status = 'premapping_acknowledgement',
    delivery_kind = 'automatic',
    participant_role = 'mailbox',
    participant_trust = 'verified'
  where id = transport_row.id;

  if route_changed then
    insert into public.refund_case_events (
      refund_case_id,
      event_type,
      message,
      metadata
    ) values (
      case_row.id,
      'gmail_first_contact_premapping_ready',
      'The generic hosted-form acknowledgement was prepared before machine mapping.',
      jsonb_build_object(
        'payload_redacted', true,
        'manager_cc_count', 0,
        'recipient_resolution_status', 'premapping_acknowledgement',
        'template_key', operation_row.template_key,
        'case_specific_message', false
      )
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'premapping_acknowledgement',
    'managerCcEmails', '[]'::jsonb,
    'managerCcCount', 0
  );
end;
$$;

revoke execute on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[])
  to service_role;

comment on function public.service_prepare_refund_gmail_first_contact_delivery(uuid, text[]) is
  'Prepares the sole pre-mapping customer exception: one generic hosted-form acknowledgement with no manager CC. All case-specific customer mail still requires current mapped-manager CC.';

create or replace function public.service_link_refund_gmail_draft_from_hosted_form(
  p_token_hash text,
  p_customer_email text,
  p_case_values jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.refund_gmail_intake_links;
  case_row public.refund_cases;
  normalized_email text := lower(btrim(coalesce(p_customer_email, '')));
  result jsonb;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$'
    or normalized_email = ''
    or jsonb_typeof(p_case_values) <> 'object' then
    return null;
  end if;

  select * into link_row
  from public.refund_gmail_intake_links link
  where link.token_hash = lower(p_token_hash)
  for update;

  if link_row.id is null
    or link_row.used_at is not null
    or link_row.expires_at <= now() then
    return null;
  end if;

  select * into case_row
  from public.refund_cases refund_case
  where refund_case.id = link_row.refund_case_id
  for update;

  if case_row.id is null
    or case_row.intake_source <> 'gmail'
    or case_row.status <> 'draft'
    or case_row.decision is not null
    or lower(btrim(case_row.customer_email)) <> normalized_email then
    return null;
  end if;

  update public.refund_cases
  set
    reporting_machine_id = (p_case_values ->> 'reportingMachineId')::uuid,
    reporting_location_id = (p_case_values ->> 'reportingLocationId')::uuid,
    customer_name = nullif(p_case_values ->> 'customerName', ''),
    customer_phone = nullif(p_case_values ->> 'customerPhone', ''),
    zelle_payment_contact = nullif(p_case_values ->> 'zellePaymentContact', ''),
    issue_summary = p_case_values ->> 'issueSummary',
    incident_at = (p_case_values ->> 'incidentAt')::timestamptz,
    incident_local_datetime = nullif(p_case_values ->> 'incidentLocalDateTime', ''),
    incident_timezone = nullif(p_case_values ->> 'incidentTimezone', ''),
    incident_time_resolution = nullif(p_case_values ->> 'incidentTimeResolution', ''),
    payment_method = p_case_values ->> 'paymentMethod',
    payment_amount_cents = (p_case_values ->> 'paymentAmountCents')::integer,
    card_last4 = nullif(p_case_values ->> 'cardLast4', ''),
    card_wallet_used = coalesce((p_case_values ->> 'cardWalletUsed')::boolean, false),
    payment_interaction = nullif(p_case_values ->> 'paymentInteraction', ''),
    wallet_provider = nullif(p_case_values ->> 'walletProvider', ''),
    incident_time_confidence = nullif(p_case_values ->> 'incidentTimeConfidence', ''),
    issue_category = nullif(p_case_values ->> 'issueCategory', ''),
    product_description = nullif(p_case_values ->> 'productDescription', ''),
    status = p_case_values ->> 'status',
    correlation_status = p_case_values ->> 'correlationStatus',
    correlation_source = nullif(p_case_values ->> 'correlationSource', ''),
    correlation_confidence = coalesce(
      (p_case_values ->> 'correlationConfidence')::numeric,
      0
    ),
    correlation_summary = nullif(p_case_values ->> 'correlationSummary', ''),
    matched_sales_fact_id = nullif(p_case_values ->> 'matchedSalesFactId', '')::uuid,
    cash_match_evaluated_fact_version = case
      when p_case_values ->> 'paymentMethod' = 'cash' then 1 else null
    end,
    refund_amount_cents = (p_case_values ->> 'paymentAmountCents')::integer,
    intake_meta = coalesce(intake_meta, '{}'::jsonb)
      || coalesce(p_case_values -> 'intakeMeta', '{}'::jsonb)
      || jsonb_build_object(
        'source', 'hosted_refund_intake',
        'intake_path', 'email_context_form',
        'gmail_draft_linked', true
      ),
    server_dedupe_key = nullif(p_case_values ->> 'serverDedupeKey', ''),
    server_dedupe_window_started_at =
      nullif(p_case_values ->> 'serverDedupeWindowStartedAt', '')::timestamptz
  where id = case_row.id;

  update public.refund_gmail_intake_links
  set used_at = now()
  where id = link_row.id;

  insert into public.refund_case_events (
    refund_case_id,
    event_type,
    message,
    metadata
  ) values (
    case_row.id,
    'email_hosted_form_linked',
    'The hosted refund form completed the originating Gmail draft case.',
    jsonb_build_object(
      'payload_redacted', true,
      'official_action', false,
      'intake_path', 'email_context_form'
    )
  );

  select jsonb_build_object(
    'id', refund_case.id,
    'public_reference', refund_case.public_reference,
    'status', refund_case.status,
    'correlation_status', refund_case.correlation_status
  ) into result
  from public.refund_cases refund_case
  where refund_case.id = case_row.id;

  return result;
end;
$$;

revoke execute on function public.service_link_refund_gmail_draft_from_hosted_form(text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.service_link_refund_gmail_draft_from_hosted_form(text,text,jsonb)
  to service_role;

comment on function public.service_link_refund_gmail_draft_from_hosted_form(text,text,jsonb) is
  'Atomically consumes a private email context token and completes the matching Gmail draft from validated hosted-form values. It never decides or refunds.';

select pg_notify('pgrst', 'reload schema');
