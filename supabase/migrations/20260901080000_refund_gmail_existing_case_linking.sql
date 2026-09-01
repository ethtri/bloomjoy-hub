-- Existing-case-first Gmail intake.
--
-- A verified inbound support message must not ask for another form when the
-- normalized sender already owns a recent open refund case. One safe match is
-- linked atomically. Multiple plausible cases create one manager-owned task;
-- customer delivery remains suppressed until that task is resolved. This
-- migration never creates a refund case, calls a provider, or moves money.

alter table public.refund_gmail_intake_contacts
  drop constraint if exists refund_gmail_intake_contacts_status_check,
  drop constraint if exists refund_gmail_intake_contacts_link_state_check;

alter table public.refund_gmail_intake_contacts
  add constraint refund_gmail_intake_contacts_status_check check (
    status in ('awaiting_form', 'link_review', 'linked', 'expired')
  ),
  add constraint refund_gmail_intake_contacts_link_state_check check (
    (status = 'linked' and linked_refund_case_id is not null and linked_at is not null)
    or (status <> 'linked' and linked_refund_case_id is null and linked_at is null)
  );

create table public.refund_gmail_case_link_reviews (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null unique
    references public.refund_gmail_intake_contacts (id) on delete cascade,
  source_message_id uuid not null
    references public.refund_gmail_intake_contact_messages (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'resolved')),
  match_basis text not null check (
    match_basis in ('normalized_sender_recent_open_cases', 'existing_contact_reconciliation')
  ),
  candidate_count integer not null check (candidate_count between 1 and 20),
  version bigint not null default 1 check (version >= 1),
  primary_refund_case_id uuid references public.refund_cases (id) on delete restrict,
  resolution_reason text check (
    resolution_reason is null or resolution_reason = 'primary_with_related_cases'
  ),
  resolved_by uuid references auth.users (id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint refund_gmail_case_link_review_resolution_shape check (
    (
      status = 'pending'
      and primary_refund_case_id is null
      and resolution_reason is null
      and resolved_by is null
      and resolved_at is null
    ) or (
      status = 'resolved'
      and primary_refund_case_id is not null
      and resolution_reason is not null
      and resolved_by is not null
      and resolved_at is not null
    )
  )
);

create index refund_gmail_case_link_reviews_pending_idx
  on public.refund_gmail_case_link_reviews (created_at, id)
  where status = 'pending';

create table public.refund_gmail_case_link_review_candidates (
  review_id uuid not null
    references public.refund_gmail_case_link_reviews (id) on delete cascade,
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
    and evidence - array[
      'normalizedSender', 'amount', 'paymentMethod', 'incidentDate',
      'locationOrMachine', 'payloadRedacted'
    ]::text[] = '{}'::jsonb
    and evidence ->> 'payloadRedacted' = 'true'
  ),
  relationship text check (relationship is null or relationship in ('primary', 'related')),
  created_at timestamptz not null default clock_timestamp(),
  primary key (review_id, refund_case_id)
);

create index refund_gmail_case_link_review_candidates_case_idx
  on public.refund_gmail_case_link_review_candidates (refund_case_id, review_id);

create table public.refund_gmail_contact_case_associations (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null
    references public.refund_gmail_intake_contacts (id) on delete restrict,
  review_id uuid not null
    references public.refund_gmail_case_link_reviews (id) on delete restrict,
  refund_case_id uuid not null references public.refund_cases (id) on delete restrict,
  relationship text not null check (relationship in ('primary', 'related')),
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique (contact_id, refund_case_id),
  unique (review_id, refund_case_id)
);

create unique index refund_gmail_contact_case_associations_one_primary_idx
  on public.refund_gmail_contact_case_associations (contact_id)
  where relationship = 'primary';

alter table public.refund_gmail_case_link_reviews enable row level security;
alter table public.refund_gmail_case_link_review_candidates enable row level security;
alter table public.refund_gmail_contact_case_associations enable row level security;

revoke all on table public.refund_gmail_case_link_reviews
  from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_case_link_review_candidates
  from public, anon, authenticated, service_role;
revoke all on table public.refund_gmail_contact_case_associations
  from public, anon, authenticated, service_role;

create or replace function public.refund_gmail_recent_open_case_candidates(
  p_customer_email text,
  p_received_at timestamptz,
  p_contextual_facts jsonb default '{}'::jsonb
)
returns table(refund_case_id uuid, evidence jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select
    refund_case.id,
    jsonb_strip_nulls(jsonb_build_object(
      'normalizedSender', true,
      'amount', case
        when jsonb_typeof(p_contextual_facts -> 'amountCents') = 'number'
          and p_contextual_facts ->> 'amountCents' ~ '^[0-9]{1,7}$'
          then refund_case.payment_amount_cents = (p_contextual_facts ->> 'amountCents')::integer
        else null
      end,
      'paymentMethod', case
        when p_contextual_facts ->> 'paymentMethod' in ('card', 'cash')
          then refund_case.payment_method = p_contextual_facts ->> 'paymentMethod'
        else null
      end,
      'incidentDate', case
        when p_contextual_facts ->> 'incidentDate' ~ '^\d{4}-\d{2}-\d{2}$'
          then coalesce(
            left(refund_case.incident_local_datetime, 10),
            refund_case.incident_at::date::text
          ) = p_contextual_facts ->> 'incidentDate'
        else null
      end,
      'locationOrMachine', case
        when nullif(lower(btrim(p_contextual_facts ->> 'locationOrMachine')), '') is not null
          then lower(btrim(p_contextual_facts ->> 'locationOrMachine')) in (
            lower(btrim(machine.machine_label)),
            lower(btrim(coalesce(machine.refund_public_display_label, ''))),
            lower(btrim(location.name))
          )
        else null
      end,
      'payloadRedacted', true
    ))
  from public.refund_cases refund_case
  join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
  join public.reporting_locations location on location.id = refund_case.reporting_location_id
  where lower(btrim(refund_case.customer_email)) = lower(btrim(p_customer_email))
    and refund_case.case_population = 'customer'
    and refund_case.status not in ('denied', 'completed', 'closed')
    and refund_case.decision is distinct from 'denied'
    and refund_case.created_at >= coalesce(p_received_at, statement_timestamp()) - interval '30 days'
    and refund_case.created_at <= coalesce(p_received_at, statement_timestamp()) + interval '1 day'
  order by refund_case.created_at desc, refund_case.id
  limit 20;
$$;

revoke execute on function public.refund_gmail_recent_open_case_candidates(text,timestamptz,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.service_stage_refund_gmail_case_link_review_v1(
  p_contact_id uuid,
  p_source_message_id uuid,
  p_match_basis text,
  p_contextual_facts jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_row public.refund_gmail_intake_contacts%rowtype;
  review_row public.refund_gmail_case_link_reviews%rowtype;
  candidate_count integer := 0;
begin
  select contact.* into contact_row
  from public.refund_gmail_intake_contacts contact
  where contact.id = p_contact_id
  for update;

  if contact_row.id is null or contact_row.status in ('linked', 'expired') then
    return null;
  end if;

  select count(*)::integer into candidate_count
  from public.refund_gmail_recent_open_case_candidates(
    contact_row.customer_email,
    contact_row.latest_message_at,
    coalesce(p_contextual_facts, '{}'::jsonb)
  );
  if candidate_count = 0 then return null; end if;

  insert into public.refund_gmail_case_link_reviews (
    contact_id, source_message_id, match_basis, candidate_count
  ) values (
    contact_row.id,
    p_source_message_id,
    case when p_match_basis = 'existing_contact_reconciliation'
      then p_match_basis else 'normalized_sender_recent_open_cases' end,
    candidate_count
  )
  on conflict (contact_id) do update set
    source_message_id = excluded.source_message_id,
    candidate_count = excluded.candidate_count,
    updated_at = clock_timestamp()
  where public.refund_gmail_case_link_reviews.status = 'pending'
  returning * into review_row;

  if review_row.id is null then
    select review.* into review_row
    from public.refund_gmail_case_link_reviews review
    where review.contact_id = contact_row.id;
  end if;
  if review_row.status <> 'pending' then return null; end if;

  delete from public.refund_gmail_case_link_review_candidates candidate
  where candidate.review_id = review_row.id
    and not exists (
      select 1
      from public.refund_gmail_recent_open_case_candidates(
        contact_row.customer_email,
        contact_row.latest_message_at,
        coalesce(p_contextual_facts, '{}'::jsonb)
      ) current_candidate
      where current_candidate.refund_case_id = candidate.refund_case_id
    );

  insert into public.refund_gmail_case_link_review_candidates (
    review_id, refund_case_id, evidence
  )
  select review_row.id, candidate.refund_case_id, candidate.evidence
  from public.refund_gmail_recent_open_case_candidates(
    contact_row.customer_email,
    contact_row.latest_message_at,
    coalesce(p_contextual_facts, '{}'::jsonb)
  ) candidate
  on conflict (review_id, refund_case_id) do update
  set evidence = excluded.evidence;

  update public.refund_gmail_intake_contacts
  set status = 'link_review', updated_at = clock_timestamp()
  where id = contact_row.id and status = 'awaiting_form';

  return jsonb_build_object(
    'reviewId', review_row.id,
    'version', review_row.version,
    'candidateCount', review_row.candidate_count,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_stage_refund_gmail_case_link_review_v1(uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.service_ingest_refund_gmail_contact_v2(
  p_mailbox_hash text,
  p_provider_thread_id text,
  p_provider_message_id text,
  p_provider_message_header text,
  p_references_header text,
  p_direction text,
  p_is_bounce boolean,
  p_sender_email text,
  p_sender_name text,
  p_recipient_email text,
  p_subject text,
  p_plain_body text,
  p_sensitive_data_redacted boolean,
  p_received_at timestamptz,
  p_public_reference text,
  p_attachments jsonb,
  p_recipient_cc_emails text[],
  p_mailbox_identities text[],
  p_participant_trust text,
  p_provider_sent boolean,
  p_is_hard_bounce boolean,
  p_failed_recipient_emails text[],
  p_contextual_facts jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  normalized_sender text := lower(btrim(coalesce(p_sender_email, '')));
  received_at timestamptz := coalesce(p_received_at, statement_timestamp());
  candidate_ids uuid[] := '{}'::uuid[];
  candidate_id uuid;
  existing_case_id uuid;
  existing_contact public.refund_gmail_intake_contacts%rowtype;
  staged_review jsonb;
  thread_insert_count integer := 0;
begin
  if lower(btrim(coalesce(p_direction, ''))) = 'inbound'
    and not coalesce(p_is_bounce, false)
    and lower(btrim(coalesce(p_participant_trust, ''))) = 'direct_human'
    and public.refund_email_address_is_valid(normalized_sender) then
    perform pg_advisory_xact_lock(
      hashtextextended(p_mailbox_hash || ':' || btrim(p_provider_thread_id), 0)
    );

    select thread.refund_case_id into existing_case_id
    from public.refund_gmail_threads thread
    where thread.mailbox_hash = p_mailbox_hash
      and thread.provider_thread_id = btrim(p_provider_thread_id);
    if existing_case_id is not null then
      return public.service_ingest_refund_gmail_contact_v1(
        p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
        p_provider_message_header, p_references_header, p_direction, p_is_bounce,
        p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
        p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
        p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
        p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
      );
    end if;

    if nullif(btrim(coalesce(p_public_reference, '')), '') is not null then
      select refund_case.id into existing_case_id
      from public.refund_cases refund_case
      where upper(refund_case.public_reference) = upper(btrim(p_public_reference))
        and lower(btrim(refund_case.customer_email)) = normalized_sender
      order by refund_case.created_at desc
      limit 1;
      if existing_case_id is not null then
        return public.service_ingest_refund_gmail_contact_v1(
          p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
          p_provider_message_header, p_references_header, p_direction, p_is_bounce,
          p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
          p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
          p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
          p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
        );
      end if;
    end if;

    select contact.* into existing_contact
    from public.refund_gmail_intake_contacts contact
    where contact.mailbox_hash = p_mailbox_hash
      and contact.provider_thread_id = btrim(p_provider_thread_id)
    for update;

    select coalesce(array_agg(candidate.refund_case_id), '{}'::uuid[])
    into candidate_ids
    from public.refund_gmail_recent_open_case_candidates(
      normalized_sender, received_at, coalesce(p_contextual_facts, '{}'::jsonb)
    ) candidate;

    if existing_contact.id is null and cardinality(candidate_ids) = 1 then
      candidate_id := candidate_ids[1];
      insert into public.refund_gmail_threads (
        refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
        first_message_at, latest_message_at, retention_expires_at
      ) values (
        candidate_id,
        p_mailbox_hash,
        btrim(p_provider_thread_id),
        left(coalesce(nullif(btrim(p_subject), ''), '(no subject)'), 998),
        received_at,
        received_at,
        received_at + interval '180 days'
      ) on conflict (mailbox_hash, provider_thread_id) do nothing;
      get diagnostics thread_insert_count = row_count;

      result := public.service_ingest_refund_gmail_message_v2(
        p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
        p_provider_message_header, p_references_header, p_direction, p_is_bounce,
        p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
        p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
        p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
        p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
      );

      if thread_insert_count = 1 then
        insert into public.refund_case_events (
          refund_case_id, event_type, message, metadata, created_at
        ) values (
          candidate_id,
          'gmail_existing_case_auto_linked',
          'A verified support email was linked to the customer''s only recent open refund case.',
          jsonb_build_object(
            'match_basis', 'normalized_sender_recent_open_cases',
            'candidate_count', 1,
            'customer_message_sent', false,
            'case_created', false,
            'provider_call_made', false,
            'payment_action_taken', false,
            'payload_redacted', true
          ),
          received_at
        );
      end if;

      return result || jsonb_build_object(
        'existingCaseLink', 'automatic',
        'contactOnly', false,
        'payloadRedacted', true
      );
    end if;
  end if;

  result := public.service_ingest_refund_gmail_contact_v1(
    p_mailbox_hash, p_provider_thread_id, p_provider_message_id,
    p_provider_message_header, p_references_header, p_direction, p_is_bounce,
    p_sender_email, p_sender_name, p_recipient_email, p_subject, p_plain_body,
    p_sensitive_data_redacted, p_received_at, p_public_reference, p_attachments,
    p_recipient_cc_emails, p_mailbox_identities, p_participant_trust,
    p_provider_sent, p_is_hard_bounce, p_failed_recipient_emails
  );

  if result ->> 'contactId' is not null
    and result ->> 'messageId' is not null
    and result ->> 'participantRole' = 'customer'
    and cardinality(candidate_ids) > 0 then
    staged_review := public.service_stage_refund_gmail_case_link_review_v1(
      (result ->> 'contactId')::uuid,
      (result ->> 'messageId')::uuid,
      'normalized_sender_recent_open_cases',
      coalesce(p_contextual_facts, '{}'::jsonb)
    );
    if staged_review is not null then
      return result || jsonb_build_object(
        'contactOnly', false,
        'linkReview', staged_review,
        'customerContactSuppressed', true,
        'payloadRedacted', true
      );
    end if;
  end if;

  return result;
end;
$$;

revoke execute on function public.service_ingest_refund_gmail_contact_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[],jsonb
) from public, anon, authenticated;
grant execute on function public.service_ingest_refund_gmail_contact_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[],jsonb
) to service_role;

-- Existing unresolved contacts are converted to review work on deployment when
-- one or more recent open cases now exist. This creates no message and performs
-- no automatic historical association.
do $$
declare
  contact_row public.refund_gmail_intake_contacts%rowtype;
  source_message_id uuid;
begin
  for contact_row in
    select contact.*
    from public.refund_gmail_intake_contacts contact
    where contact.status = 'awaiting_form'
      and exists (
        select 1
        from public.refund_gmail_recent_open_case_candidates(
          contact.customer_email, contact.latest_message_at, '{}'::jsonb
        ) candidate
      )
    order by contact.created_at, contact.id
  loop
    select message.id into source_message_id
    from public.refund_gmail_intake_contact_messages message
    where message.contact_id = contact_row.id
      and message.direction = 'inbound'
      and message.participant_role = 'customer'
      and message.participant_trust = 'verified'
    order by message.received_at desc, message.id desc
    limit 1;
    if source_message_id is not null then
      perform public.service_stage_refund_gmail_case_link_review_v1(
        contact_row.id,
        source_message_id,
        'existing_contact_reconciliation',
        '{}'::jsonb
      );
    end if;
  end loop;
end;
$$;

create or replace function public.refund_gmail_case_link_review_contract(
  p_review_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when review.id is null then null else jsonb_build_object(
    'schemaVersion', 'refund_gmail_case_link_review_v1',
    'reviewId', review.id,
    'version', review.version,
    'status', review.status,
    'candidateCount', review.candidate_count,
    'receivedAt', source.received_at,
    'matchBasis', review.match_basis,
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
        'caseId', refund_case.id,
        'publicReference', refund_case.public_reference,
        'locationName', location.name,
        'machineLabel', machine.machine_label,
        'incidentAt', refund_case.incident_at,
        'paymentAmountCents', refund_case.payment_amount_cents,
        'evidence', candidate.evidence,
        'relationship', candidate.relationship
      ) order by refund_case.created_at, refund_case.id)
      from public.refund_gmail_case_link_review_candidates candidate
      join public.refund_cases refund_case on refund_case.id = candidate.refund_case_id
      join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
      join public.reporting_locations location on location.id = refund_case.reporting_location_id
      where candidate.review_id = review.id
    ), '[]'::jsonb),
    'customerContactSuppressed', review.status = 'pending',
    'caseCreated', false,
    'providerCallMade', false,
    'paymentActionTaken', false,
    'payloadRedacted', true
  ) end
  from public.refund_gmail_case_link_reviews review
  join public.refund_gmail_intake_contact_messages source
    on source.id = review.source_message_id
  where review.id = p_review_id;
$$;

revoke execute on function public.refund_gmail_case_link_review_contract(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_resolve_refund_gmail_case_link_review(
  p_review_id uuid,
  p_expected_version bigint,
  p_primary_refund_case_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  review_row public.refund_gmail_case_link_reviews%rowtype;
  contact_row public.refund_gmail_intake_contacts%rowtype;
  gmail_thread_row public.refund_gmail_threads%rowtype;
  candidate_count integer;
  resolution_at timestamptz := statement_timestamp();
begin
  if auth.role() is distinct from 'authenticated'
    or actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = 'P4650', message = 'Authentication required';
  end if;

  select review.* into review_row
  from public.refund_gmail_case_link_reviews review
  where review.id = p_review_id
  for update;
  if review_row.id is null then
    raise exception using errcode = 'P4651', message = 'Email linking review not found';
  end if;

  if review_row.status = 'resolved' then
    if review_row.primary_refund_case_id = p_primary_refund_case_id then
      return jsonb_build_object(
        'resolved', false,
        'replayed', true,
        'review', public.refund_gmail_case_link_review_contract(review_row.id),
        'customerMessageSent', false,
        'caseCreated', false,
        'providerCallMade', false,
        'paymentActionTaken', false,
        'payloadRedacted', true
      );
    end if;
    raise exception using errcode = 'P4652', message = 'Email linking review is already resolved';
  end if;
  if review_row.version is distinct from p_expected_version then
    raise exception using errcode = 'P4653', message = 'Email linking review changed; refresh before resolving it';
  end if;
  if not exists (
    select 1 from public.refund_gmail_case_link_review_candidates candidate
    where candidate.review_id = review_row.id
      and candidate.refund_case_id = p_primary_refund_case_id
  ) then
    raise exception using errcode = 'P4654', message = 'Choose a candidate case from this review';
  end if;

  if not public.is_super_admin(actor_user_id)
    and exists (
      select 1
      from public.refund_gmail_case_link_review_candidates candidate
      where candidate.review_id = review_row.id
        and not exists (
          select 1
          from public.refund_cases refund_case
          join public.reporting_machine_refund_managers manager
            on manager.reporting_machine_id = refund_case.reporting_machine_id
          where refund_case.id = candidate.refund_case_id
            and manager.manager_user_id = actor_user_id
            and manager.status = 'active'
            and manager.revoked_at is null
        )
    ) then
    raise exception using errcode = 'P4655', message = 'Current manager access to every candidate case is required';
  end if;

  select contact.* into contact_row
  from public.refund_gmail_intake_contacts contact
  where contact.id = review_row.contact_id
  for update;
  if contact_row.status <> 'link_review' then
    raise exception using errcode = 'P4656', message = 'Email contact is no longer awaiting linking review';
  end if;

  insert into public.refund_gmail_threads (
    refund_case_id, mailbox_hash, provider_thread_id, thread_subject,
    first_message_at, latest_message_at, retention_expires_at
  ) values (
    p_primary_refund_case_id,
    contact_row.mailbox_hash,
    contact_row.provider_thread_id,
    contact_row.thread_subject,
    contact_row.first_message_at,
    contact_row.latest_message_at,
    greatest(contact_row.latest_message_at, resolution_at) + interval '180 days'
  )
  on conflict (mailbox_hash, provider_thread_id) do update
  set refund_case_id = refund_gmail_threads.refund_case_id
  returning * into gmail_thread_row;

  if gmail_thread_row.refund_case_id <> p_primary_refund_case_id then
    raise exception using errcode = 'P4657', message = 'Email thread is already linked to a different case';
  end if;

  insert into public.refund_gmail_messages (
    gmail_thread_id, refund_case_id, provider_message_id,
    provider_message_header, references_header, operation_key, direction,
    message_kind, status, sender_email, sender_name, recipient_email,
    recipient_cc_emails, recipient_cc_count, participant_role,
    participant_trust, recipient_resolution_status, delivery_kind,
    subject, plain_body, sensitive_data_redacted, received_at, sent_at,
    retention_expires_at
  )
  select
    gmail_thread_row.id,
    p_primary_refund_case_id,
    message.provider_message_id,
    message.provider_message_header,
    message.references_header,
    message.operation_key,
    message.direction,
    message.message_kind,
    message.status,
    message.sender_email,
    message.sender_name,
    message.recipient_email,
    message.recipient_cc_emails,
    cardinality(message.recipient_cc_emails),
    message.participant_role,
    message.participant_trust,
    case when message.direction = 'outbound'
      then 'premapping_acknowledgement' else null end,
    case when message.direction = 'outbound'
      then 'automatic' else null end,
    message.subject,
    message.plain_body,
    message.sensitive_data_redacted,
    message.received_at,
    message.sent_at,
    greatest(message.received_at, resolution_at) + interval '180 days'
  from public.refund_gmail_intake_contact_messages message
  where message.contact_id = contact_row.id
  order by message.received_at, message.id
  on conflict do nothing;

  update public.refund_gmail_intake_contacts
  set
    status = 'linked',
    linked_refund_case_id = p_primary_refund_case_id,
    linked_at = resolution_at,
    retention_expires_at = resolution_at,
    updated_at = resolution_at
  where id = contact_row.id;

  update public.refund_gmail_case_link_review_candidates candidate
  set relationship = case when candidate.refund_case_id = p_primary_refund_case_id
    then 'primary' else 'related' end
  where candidate.review_id = review_row.id;

  insert into public.refund_gmail_contact_case_associations (
    contact_id, review_id, refund_case_id, relationship, created_by
  )
  select
    contact_row.id,
    review_row.id,
    candidate.refund_case_id,
    case when candidate.refund_case_id = p_primary_refund_case_id
      then 'primary' else 'related' end,
    actor_user_id
  from public.refund_gmail_case_link_review_candidates candidate
  where candidate.review_id = review_row.id
  on conflict (contact_id, refund_case_id) do nothing;
  get diagnostics candidate_count = row_count;

  update public.refund_gmail_case_link_reviews
  set
    status = 'resolved',
    primary_refund_case_id = p_primary_refund_case_id,
    resolution_reason = 'primary_with_related_cases',
    resolved_by = actor_user_id,
    resolved_at = resolution_at,
    version = version + 1,
    updated_at = resolution_at
  where id = review_row.id;

  update public.refund_cases
  set
    status = case when status = 'waiting_on_customer' then 'needs_review' else status end,
    automation_state = 'customer_replied',
    automation_follow_up_due_at = null,
    updated_at = resolution_at
  where id = p_primary_refund_case_id;

  insert into public.refund_case_events (
    refund_case_id, actor_user_id, event_type, message, metadata
  )
  select
    candidate.refund_case_id,
    actor_user_id,
    'gmail_existing_case_link_resolved',
    case when candidate.refund_case_id = p_primary_refund_case_id
      then 'A manager linked the verified support conversation to this primary refund case.'
      else 'A manager associated this refund case with a related support conversation.' end,
    jsonb_build_object(
      'review_id', review_row.id,
      'relationship', case when candidate.refund_case_id = p_primary_refund_case_id
        then 'primary' else 'related' end,
      'candidate_count', review_row.candidate_count,
      'customer_message_sent', false,
      'case_created', false,
      'provider_call_made', false,
      'payment_action_taken', false,
      'payload_redacted', true
    )
  from public.refund_gmail_case_link_review_candidates candidate
  where candidate.review_id = review_row.id;

  return jsonb_build_object(
    'resolved', true,
    'replayed', false,
    'primaryCaseId', p_primary_refund_case_id,
    'associatedCaseCount', candidate_count,
    'review', public.refund_gmail_case_link_review_contract(review_row.id),
    'customerMessageSent', false,
    'caseCreated', false,
    'providerCallMade', false,
    'paymentActionTaken', false,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.admin_resolve_refund_gmail_case_link_review(uuid,bigint,uuid)
  from public, anon, service_role;
grant execute on function public.admin_resolve_refund_gmail_case_link_review(uuid,bigint,uuid)
  to authenticated;

-- Pending ambiguous correspondence is an evidence-review gate, independent of
-- payment approval. Preserve every existing official-action predicate and add
-- only the unresolved-link exclusion.
create or replace function public.can_perform_refund_official_action(
  p_user_id uuid,
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_refund_case_id is not null
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and refund_case.duplicate_of_refund_case_id is null
        and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
        and not exists (
          select 1
          from public.refund_gmail_case_link_review_candidates candidate
          join public.refund_gmail_case_link_reviews review
            on review.id = candidate.review_id
          where candidate.refund_case_id = refund_case.id
            and review.status = 'pending'
        )
        and manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_gmail_case_link_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_gmail_case_link_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result := public.admin_get_refund_operations_overview_pre_gmail_case_link_v1();

  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'inboundLinkReview', case when review.id is null then null
        else public.refund_gmail_case_link_review_contract(review.id) end,
      'canPerformOfficialAction', case when review.id is null
        then item.case_json -> 'canPerformOfficialAction' else 'false'::jsonb end,
      'officialActionBlockReason', case when review.id is null
        then item.case_json -> 'officialActionBlockReason'
        else to_jsonb('inbound_link_review_required'::text) end,
      'lifecycle', case when review.id is null
        then item.case_json -> 'lifecycle'
        else coalesce(item.case_json -> 'lifecycle', '{}'::jsonb) || jsonb_build_object(
          'managerNextAction', 'review_inbound_case_link',
          'managerQueue', coalesce(item.case_json -> 'lifecycle' -> 'managerQueue', '{}'::jsonb)
            || jsonb_build_object(
              'schemaVersion', 'refund_manager_queue_v1',
              'bucket', 'needs_action',
              'label', 'Action needed',
              'nextAction', 'review_inbound_case_link',
              'safeRetryEligible', false,
              'payloadRedacted', true
            )
        ) end
    ) order by item.case_order
  ), '[]'::jsonb) into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  left join lateral (
    select pending_review.*
    from public.refund_gmail_case_link_review_candidates candidate
    join public.refund_gmail_case_link_reviews pending_review
      on pending_review.id = candidate.review_id
    where candidate.refund_case_id = (item.case_json ->> 'id')::uuid
      and pending_review.status = 'pending'
    order by pending_review.created_at, pending_review.id
    limit 1
  ) review on true;

  return jsonb_set(
    base_result || jsonb_build_object(
      'inboundLinkReviewContractVersion', 'refund_gmail_case_link_review_v1'
    ),
    '{cases}', enriched_cases, true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on table public.refund_gmail_case_link_reviews is
  'Private exactly-once manager tasks for verified Gmail contacts with one or more plausible recent open cases. Content and sender addresses are not projected.';
comment on table public.refund_gmail_contact_case_associations is
  'Immutable primary/related case associations created when an authorized manager resolves one inbound Gmail linking task.';
comment on function public.service_ingest_refund_gmail_contact_v2(
  text,text,text,text,text,text,boolean,text,text,text,text,text,boolean,
  timestamptz,text,jsonb,text[],text[],text,boolean,boolean,text[],jsonb
) is
  'Existing-case-first Gmail intake. A single recent exact-sender case is linked; multiple candidates stage one manager task and suppress customer contact.';
comment on function public.admin_resolve_refund_gmail_case_link_review(uuid,bigint,uuid) is
  'Versioned manager resolution that links one primary case, retains all other candidates as related associations, and creates no customer, provider, reporting, or payment side effect.';

select pg_notify('pgrst', 'reload schema');
