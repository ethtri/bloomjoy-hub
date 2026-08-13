-- #800: make the final production Gmail proof exclusive to one owner-controlled
-- synthetic case and one short-lived, one-shot run token.
--
-- The authorization is prepared and closed only by the database owner. The
-- browser cannot select a recipient, case, manager route, or expiry. While an
-- authorization remains unclosed, every case-message transport must present
-- its exact authorization or fail before message insertion, Gmail claim,
-- OAuth, provider access, or transactional fallback.

create table if not exists public.refund_synthetic_gmail_proof_authorizations (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases(id) on delete restrict,
  gmail_thread_id uuid not null references public.refund_gmail_threads(id) on delete restrict,
  recipient_digest text not null check (recipient_digest ~ '^[a-f0-9]{64}$'),
  run_token_digest text not null unique check (run_token_digest ~ '^[a-f0-9]{64}$'),
  manager_route_digest text not null check (manager_route_digest ~ '^[a-f0-9]{64}$'),
  expected_manager_count integer not null check (expected_manager_count between 1 and 3),
  expected_message_type text not null default 'status_update'
    check (expected_message_type = 'status_update'),
  baseline_global_case_message_count bigint not null check (baseline_global_case_message_count >= 0),
  baseline_global_gmail_outbound_count bigint not null check (baseline_global_gmail_outbound_count >= 0),
  baseline_case_message_count bigint not null check (baseline_case_message_count >= 0),
  baseline_case_gmail_outbound_count bigint not null check (baseline_case_gmail_outbound_count >= 0),
  baseline_case_attachment_count bigint not null check (baseline_case_attachment_count >= 0),
  prepared_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  refund_case_message_id uuid unique references public.refund_case_messages(id) on delete restrict,
  cancelled_at timestamptz,
  constraint refund_synthetic_gmail_proof_short_window check (
    expires_at > prepared_at
    and expires_at <= prepared_at + interval '5 minutes'
  ),
  constraint refund_synthetic_gmail_proof_consumption_shape check (
    (consumed_at is null and refund_case_message_id is null)
    or consumed_at is not null
  ),
  constraint refund_synthetic_gmail_proof_cancel_shape check (
    cancelled_at is null or cancelled_at >= prepared_at
  )
);

create unique index if not exists refund_synthetic_gmail_proof_one_unclosed_idx
  on public.refund_synthetic_gmail_proof_authorizations ((true))
  where cancelled_at is null;

create index if not exists refund_synthetic_gmail_proof_case_idx
  on public.refund_synthetic_gmail_proof_authorizations (refund_case_id, prepared_at desc);

alter table public.refund_synthetic_gmail_proof_authorizations enable row level security;
revoke all on table public.refund_synthetic_gmail_proof_authorizations
  from public, anon, authenticated, service_role;

create or replace function public.refund_synthetic_gmail_proof_recipient_allowed(
  p_recipient_email text
)
returns boolean
language sql
immutable
security definer
set search_path = public
as $$
  select lower(btrim(coalesce(p_recipient_email, ''))) ~
    '^etrifari\+refundpilot([._-][a-z0-9][a-z0-9._-]{0,48})?@bloomjoysweets\.com$';
$$;

create or replace function public.refund_synthetic_gmail_proof_route_digest(
  p_manager_emails text[]
)
returns text
language sql
immutable
security definer
set search_path = public, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        array_to_string(
          array(
            select distinct lower(btrim(email))
            from unnest(coalesce(p_manager_emails, '{}'::text[])) email
            order by lower(btrim(email))
          ),
          ','
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create or replace function public.owner_prepare_refund_synthetic_gmail_proof(
  p_refund_case_id uuid,
  p_run_token_digest text,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  proof_case public.refund_cases%rowtype;
  proof_thread public.refund_gmail_threads%rowtype;
  recipient_resolution jsonb;
  manager_emails text[] := '{}'::text[];
  prepared public.refund_synthetic_gmail_proof_authorizations%rowtype;
  operation_owner name;
  database_owner name;
begin
  select pg_get_userbyid(routine.proowner)
  into operation_owner
  from pg_proc routine
  where routine.oid =
    'public.owner_prepare_refund_synthetic_gmail_proof(uuid,text,text)'::regprocedure;

  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();

  if operation_owner is null
    or database_owner is null
    or operation_owner <> database_owner
    or current_user <> operation_owner
    or session_user <> database_owner then
    raise exception 'Synthetic Gmail proof preparation is database-owner only';
  end if;

  if p_confirmation is distinct from
    'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND' then
    raise exception 'Exact synthetic Gmail proof confirmation is required';
  end if;
  if p_refund_case_id is null
    or coalesce(p_run_token_digest, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Valid synthetic Gmail case and run-token digest required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-synthetic-gmail-proof-exclusive-window', 800)
  );

  if exists (
    select 1
    from public.refund_synthetic_gmail_proof_authorizations proof_auth
    where proof_auth.cancelled_at is null
  ) then
    raise exception 'Close the existing synthetic Gmail proof authorization first';
  end if;

  select refund_case.*
  into strict proof_case
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
  for update;

  if proof_case.intake_source is distinct from 'gmail'
    or proof_case.status is distinct from 'needs_review'
    or proof_case.reporting_machine_id is null
    or not public.refund_synthetic_gmail_proof_recipient_allowed(
      proof_case.customer_email
    ) then
    raise exception 'Case is not an eligible owner-controlled synthetic Gmail proof';
  end if;

  select thread.*
  into strict proof_thread
  from public.refund_gmail_threads thread
  where thread.refund_case_id = proof_case.id
  order by thread.id
  for update;

  if (select count(*) from public.refund_gmail_threads thread
      where thread.refund_case_id = proof_case.id) <> 1 then
    raise exception 'Synthetic Gmail proof requires exactly one linked original thread';
  end if;

  if exists (
    select 1
    from public.refund_gmail_attachments attachment
    where attachment.refund_case_id = proof_case.id
  ) then
    raise exception 'Synthetic Gmail proof is attachment-free';
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    proof_case.id,
    proof_case.customer_email,
    array[
      'info@bloomjoysweets.com',
      'support@bloomjoysweets.com',
      'refunds@bloomjoysweets.com'
    ]::text[]
  );
  if recipient_resolution ->> 'status' is distinct from 'resolved' then
    raise exception 'Complete current mapped-manager route is required';
  end if;

  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_emails
  from jsonb_array_elements_text(
    recipient_resolution -> 'managerCcEmails'
  ) value;

  if cardinality(manager_emails) not between 1 and 3
    or cardinality(manager_emails) is distinct from
      (recipient_resolution ->> 'managerCcCount')::integer then
    raise exception 'Complete current mapped-manager route is required';
  end if;

  insert into public.refund_synthetic_gmail_proof_authorizations (
    refund_case_id,
    gmail_thread_id,
    recipient_digest,
    run_token_digest,
    manager_route_digest,
    expected_manager_count,
    baseline_global_case_message_count,
    baseline_global_gmail_outbound_count,
    baseline_case_message_count,
    baseline_case_gmail_outbound_count,
    baseline_case_attachment_count,
    prepared_at,
    expires_at
  ) values (
    proof_case.id,
    proof_thread.id,
    encode(extensions.digest(
      convert_to(lower(btrim(proof_case.customer_email)), 'UTF8'),
      'sha256'
    ), 'hex'),
    p_run_token_digest,
    public.refund_synthetic_gmail_proof_route_digest(manager_emails),
    cardinality(manager_emails),
    (select count(*) from public.refund_case_messages),
    (select count(*) from public.refund_gmail_messages message
      where message.direction = 'outbound'),
    (select count(*) from public.refund_case_messages message
      where message.refund_case_id = proof_case.id),
    (select count(*) from public.refund_gmail_messages message
      where message.refund_case_id = proof_case.id
        and message.direction = 'outbound'),
    (select count(*) from public.refund_gmail_attachments attachment
      where attachment.refund_case_id = proof_case.id),
    statement_timestamp(),
    statement_timestamp() + interval '5 minutes'
  )
  returning * into prepared;

  return jsonb_build_object(
    'prepared', true,
    'authorizationId', prepared.id,
    'expiresAt', prepared.expires_at,
    'expectedManagerCount', prepared.expected_manager_count,
    'messageType', prepared.expected_message_type,
    'payloadRedacted', true
  );
exception
  when no_data_found then
    raise exception 'Synthetic Gmail proof case or original thread was not found';
  when too_many_rows then
    raise exception 'Synthetic Gmail proof requires exactly one linked original thread';
end;
$$;

create or replace function public.service_authorize_refund_synthetic_gmail_proof(
  p_refund_case_id uuid,
  p_recipient_email text,
  p_run_token_digest text,
  p_message_type text,
  p_default_template_only boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  proof_auth public.refund_synthetic_gmail_proof_authorizations%rowtype;
  proof_case public.refund_cases%rowtype;
  recipient_resolution jsonb;
  manager_emails text[] := '{}'::text[];
  normalized_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
  supplied_token_digest text := lower(btrim(coalesce(p_run_token_digest, '')));
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Synthetic Gmail proof authorization is service-only';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-synthetic-gmail-proof-exclusive-window', 800)
  );

  select existing.*
  into proof_auth
  from public.refund_synthetic_gmail_proof_authorizations existing
  where existing.cancelled_at is null
  for update;

  if proof_auth.id is null then
    return jsonb_build_object(
      'required', false,
      'allowed', true,
      'status', 'not_required',
      'payloadRedacted', true
    );
  end if;

  if proof_auth.consumed_at is not null then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'already_consumed',
      'payloadRedacted', true
    );
  end if;
  if proof_auth.expires_at <= statement_timestamp() then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'expired',
      'payloadRedacted', true
    );
  end if;
  if proof_auth.refund_case_id is distinct from p_refund_case_id then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'case_mismatch',
      'payloadRedacted', true
    );
  end if;
  if supplied_token_digest !~ '^[a-f0-9]{64}$'
    or supplied_token_digest is distinct from proof_auth.run_token_digest then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'token_mismatch',
      'payloadRedacted', true
    );
  end if;
  if p_message_type is distinct from proof_auth.expected_message_type
    or p_default_template_only is distinct from true then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'template_mismatch',
      'payloadRedacted', true
    );
  end if;
  if encode(extensions.digest(
      convert_to(normalized_recipient, 'UTF8'), 'sha256'
    ), 'hex') is distinct from proof_auth.recipient_digest then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'recipient_mismatch',
      'payloadRedacted', true
    );
  end if;

  select refund_case.*
  into proof_case
  from public.refund_cases refund_case
  where refund_case.id = proof_auth.refund_case_id
  for update;

  if proof_case.id is null
    or proof_case.intake_source is distinct from 'gmail'
    or proof_case.status is distinct from 'needs_review'
    or lower(btrim(proof_case.customer_email)) is distinct from normalized_recipient
    or not public.refund_synthetic_gmail_proof_recipient_allowed(
      proof_case.customer_email
    )
    or proof_case.reporting_machine_id is null
    or not exists (
      select 1
      from public.refund_gmail_threads thread
      where thread.id = proof_auth.gmail_thread_id
        and thread.refund_case_id = proof_case.id
    )
    or (select count(*) from public.refund_gmail_threads thread
      where thread.refund_case_id = proof_case.id) <> 1
    or exists (
      select 1
      from public.refund_gmail_attachments attachment
      where attachment.refund_case_id = proof_case.id
    ) then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'case_changed',
      'payloadRedacted', true
    );
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    proof_case.id,
    proof_case.customer_email,
    array[
      'info@bloomjoysweets.com',
      'support@bloomjoysweets.com',
      'refunds@bloomjoysweets.com'
    ]::text[]
  );
  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_emails
  from jsonb_array_elements_text(
    coalesce(recipient_resolution -> 'managerCcEmails', '[]'::jsonb)
  ) value;

  if recipient_resolution ->> 'status' is distinct from 'resolved'
    or cardinality(manager_emails) is distinct from proof_auth.expected_manager_count
    or public.refund_synthetic_gmail_proof_route_digest(manager_emails)
      is distinct from proof_auth.manager_route_digest then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'manager_route_changed',
      'payloadRedacted', true
    );
  end if;

  update public.refund_synthetic_gmail_proof_authorizations
  set consumed_at = statement_timestamp()
  where id = proof_auth.id
    and consumed_at is null;

  if not found then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'already_consumed',
      'payloadRedacted', true
    );
  end if;

  return jsonb_build_object(
    'required', true,
    'allowed', true,
    'status', 'authorized',
    'authorizationId', proof_auth.id,
    'gmailThreadId', proof_auth.gmail_thread_id,
    'expectedManagerCount', proof_auth.expected_manager_count,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.service_bind_refund_synthetic_gmail_proof_message(
  p_authorization_id uuid,
  p_refund_case_id uuid,
  p_refund_case_message_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  proof_auth public.refund_synthetic_gmail_proof_authorizations%rowtype;
  proof_message public.refund_case_messages%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Synthetic Gmail proof binding is service-only';
  end if;

  select existing.*
  into proof_auth
  from public.refund_synthetic_gmail_proof_authorizations existing
  where existing.id = p_authorization_id
  for update;

  select message.*
  into proof_message
  from public.refund_case_messages message
  where message.id = p_refund_case_message_id
  for update;

  if proof_auth.id is null
    or proof_auth.cancelled_at is not null
    or proof_auth.consumed_at is null
    or proof_auth.refund_case_id is distinct from p_refund_case_id
    or proof_auth.refund_case_message_id is not null
    or proof_message.id is null
    or proof_message.refund_case_id is distinct from p_refund_case_id
    or proof_message.status is distinct from 'pending'
    or proof_message.message_type is distinct from proof_auth.expected_message_type
    or proof_message.delivery_kind is distinct from 'manual'
    or proof_message.content_source is distinct from 'manager_authored'
    or proof_message.template_key is distinct from 'refund_status_update_editable_v1' then
    return false;
  end if;

  update public.refund_synthetic_gmail_proof_authorizations
  set refund_case_message_id = proof_message.id
  where id = proof_auth.id
    and refund_case_message_id is null;

  return found;
end;
$$;

create or replace function public.service_verify_refund_synthetic_gmail_proof_transport(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_recipient_email text,
  p_authorization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  proof_auth public.refund_synthetic_gmail_proof_authorizations%rowtype;
  proof_case public.refund_cases%rowtype;
  proof_message public.refund_case_messages%rowtype;
  recipient_resolution jsonb;
  manager_emails text[] := '{}'::text[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Synthetic Gmail proof transport verification is service-only';
  end if;

  select existing.*
  into proof_auth
  from public.refund_synthetic_gmail_proof_authorizations existing
  where existing.cancelled_at is null
  for update;

  if proof_auth.id is null then
    return jsonb_build_object(
      'required', false, 'allowed', true, 'status', 'not_required',
      'payloadRedacted', true
    );
  end if;

  if p_authorization_id is distinct from proof_auth.id
    or p_refund_case_id is distinct from proof_auth.refund_case_id
    or p_refund_case_message_id is distinct from proof_auth.refund_case_message_id
    or proof_auth.consumed_at is null
    or encode(extensions.digest(
      convert_to(lower(btrim(coalesce(p_recipient_email, ''))), 'UTF8'),
      'sha256'
    ), 'hex') is distinct from proof_auth.recipient_digest then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'authorization_mismatch',
      'payloadRedacted', true
    );
  end if;

  if proof_auth.expires_at <= statement_timestamp() then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'expired',
      'payloadRedacted', true
    );
  end if;

  select refund_case.*
  into proof_case
  from public.refund_cases refund_case
  where refund_case.id = proof_auth.refund_case_id
  for update;
  select message.*
  into proof_message
  from public.refund_case_messages message
  where message.id = proof_auth.refund_case_message_id
  for update;

  if proof_case.id is null
    or proof_case.intake_source is distinct from 'gmail'
    or proof_case.status is distinct from 'needs_review'
    or proof_case.reporting_machine_id is null
    or lower(btrim(proof_case.customer_email)) is distinct from
      lower(btrim(p_recipient_email))
    or not public.refund_synthetic_gmail_proof_recipient_allowed(
      proof_case.customer_email
    )
    or proof_message.id is null
    or proof_message.refund_case_id is distinct from proof_case.id
    or proof_message.status is distinct from 'pending'
    or proof_message.message_type is distinct from proof_auth.expected_message_type
    or proof_message.delivery_kind is distinct from 'manual'
    or proof_message.content_source is distinct from 'manager_authored'
    or proof_message.template_key is distinct from 'refund_status_update_editable_v1'
    or (select count(*) from public.refund_gmail_threads thread
      where thread.refund_case_id = proof_case.id) <> 1
    or not exists (
      select 1 from public.refund_gmail_threads thread
      where thread.id = proof_auth.gmail_thread_id
        and thread.refund_case_id = proof_case.id
    )
    or exists (
      select 1 from public.refund_gmail_attachments attachment
      where attachment.refund_case_id = proof_case.id
    ) then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'evidence_changed',
      'payloadRedacted', true
    );
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    proof_case.id,
    proof_case.customer_email,
    array[
      'info@bloomjoysweets.com',
      'support@bloomjoysweets.com',
      'refunds@bloomjoysweets.com'
    ]::text[]
  );
  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_emails
  from jsonb_array_elements_text(
    coalesce(recipient_resolution -> 'managerCcEmails', '[]'::jsonb)
  ) value;

  if recipient_resolution ->> 'status' is distinct from 'resolved'
    or cardinality(manager_emails) is distinct from proof_auth.expected_manager_count
    or public.refund_synthetic_gmail_proof_route_digest(manager_emails)
      is distinct from proof_auth.manager_route_digest then
    return jsonb_build_object(
      'required', true, 'allowed', false, 'status', 'manager_route_changed',
      'payloadRedacted', true
    );
  end if;

  return jsonb_build_object(
    'required', true,
    'allowed', true,
    'status', 'authorized',
    'gmailThreadId', proof_auth.gmail_thread_id,
    'expectedManagerCount', proof_auth.expected_manager_count,
    'managerRouteDigest', proof_auth.manager_route_digest,
    'payloadRedacted', true
  );
end;
$$;

create or replace function public.owner_get_refund_synthetic_gmail_proof_summary(
  p_authorization_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  proof_auth public.refund_synthetic_gmail_proof_authorizations%rowtype;
  operation_owner name;
  database_owner name;
  global_case_message_delta bigint;
  global_outbound_delta bigint;
  case_message_delta bigint;
  case_outbound_delta bigint;
  case_attachment_delta bigint;
  proof_message_sent boolean := false;
  proof_gmail_sent boolean := false;
  original_thread_preserved boolean := false;
  manager_route_preserved boolean := false;
  sender_is_info boolean := false;
  recipient_preserved boolean := false;
  unresolved_count bigint := 0;
begin
  select pg_get_userbyid(routine.proowner)
  into operation_owner
  from pg_proc routine
  where routine.oid =
    'public.owner_get_refund_synthetic_gmail_proof_summary(uuid,text)'::regprocedure;
  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();
  if operation_owner is null
    or database_owner is null
    or operation_owner <> database_owner
    or current_user <> operation_owner
    or session_user <> database_owner then
    raise exception 'Synthetic Gmail proof summary is database-owner only';
  end if;
  if p_confirmation is distinct from 'READ_REDACTED_SYNTHETIC_GMAIL_PROOF' then
    raise exception 'Exact synthetic Gmail proof summary confirmation is required';
  end if;

  select existing.*
  into strict proof_auth
  from public.refund_synthetic_gmail_proof_authorizations existing
  where existing.id = p_authorization_id;

  select count(*) - proof_auth.baseline_global_case_message_count
  into global_case_message_delta from public.refund_case_messages;
  select count(*) - proof_auth.baseline_global_gmail_outbound_count
  into global_outbound_delta from public.refund_gmail_messages message
  where message.direction = 'outbound';
  select count(*) - proof_auth.baseline_case_message_count
  into case_message_delta from public.refund_case_messages message
  where message.refund_case_id = proof_auth.refund_case_id;
  select count(*) - proof_auth.baseline_case_gmail_outbound_count
  into case_outbound_delta from public.refund_gmail_messages message
  where message.refund_case_id = proof_auth.refund_case_id
    and message.direction = 'outbound';
  select count(*) - proof_auth.baseline_case_attachment_count
  into case_attachment_delta from public.refund_gmail_attachments attachment
  where attachment.refund_case_id = proof_auth.refund_case_id;

  select exists (
    select 1 from public.refund_case_messages message
    where message.id = proof_auth.refund_case_message_id
      and message.refund_case_id = proof_auth.refund_case_id
      and message.status = 'sent'
      and message.message_type = proof_auth.expected_message_type
      and message.delivery_kind = 'manual'
  ) into proof_message_sent;

  select
    exists (
      select 1 from public.refund_gmail_messages message
      where message.refund_case_message_id = proof_auth.refund_case_message_id
        and message.refund_case_id = proof_auth.refund_case_id
        and message.direction = 'outbound'
        and message.status = 'sent'
        and message.provider_message_id is not null
        and message.provider_message_header is not null
    ),
    exists (
      select 1 from public.refund_gmail_messages message
      where message.refund_case_message_id = proof_auth.refund_case_message_id
        and message.gmail_thread_id = proof_auth.gmail_thread_id
    ),
    exists (
      select 1 from public.refund_gmail_messages message
      where message.refund_case_message_id = proof_auth.refund_case_message_id
        and message.recipient_cc_count = proof_auth.expected_manager_count
        and public.refund_synthetic_gmail_proof_route_digest(
          message.recipient_cc_emails
        ) = proof_auth.manager_route_digest
    ),
    exists (
      select 1 from public.refund_gmail_messages message
      where message.refund_case_message_id = proof_auth.refund_case_message_id
        and lower(btrim(message.sender_email)) = 'info@bloomjoysweets.com'
    ),
    exists (
      select 1 from public.refund_gmail_messages message
      where message.refund_case_message_id = proof_auth.refund_case_message_id
        and encode(extensions.digest(
          convert_to(lower(btrim(message.recipient_email)), 'UTF8'),
          'sha256'
        ), 'hex') = proof_auth.recipient_digest
    )
  into
    proof_gmail_sent,
    original_thread_preserved,
    manager_route_preserved,
    sender_is_info,
    recipient_preserved;

  select count(*)
  into unresolved_count
  from public.refund_gmail_messages message
  where message.refund_case_message_id = proof_auth.refund_case_message_id
    and message.status in ('pending_send', 'delivery_unknown');

  return jsonb_build_object(
    'prepared', true,
    'consumed', proof_auth.consumed_at is not null,
    'closed', proof_auth.cancelled_at is not null,
    'expired', proof_auth.expires_at <= statement_timestamp(),
    'globalCaseMessageDelta', global_case_message_delta,
    'globalGmailOutboundDelta', global_outbound_delta,
    'caseMessageDelta', case_message_delta,
    'caseGmailOutboundDelta', case_outbound_delta,
    'caseAttachmentDelta', case_attachment_delta,
    'proofMessageSent', proof_message_sent,
    'proofGmailSent', proof_gmail_sent,
    'originalThreadPreserved', original_thread_preserved,
    'managerRoutePreserved', manager_route_preserved,
    'senderIsInfo', sender_is_info,
    'recipientPreserved', recipient_preserved,
    'unresolvedDeliveryCount', unresolved_count,
    'proofPassed',
      proof_auth.consumed_at is not null
      and global_case_message_delta = 1
      and global_outbound_delta = 1
      and case_message_delta = 1
      and case_outbound_delta = 1
      and case_attachment_delta = 0
      and proof_message_sent
      and proof_gmail_sent
      and original_thread_preserved
      and manager_route_preserved
      and sender_is_info
      and recipient_preserved
      and unresolved_count = 0,
    'payloadRedacted', true
  );
exception when no_data_found then
  raise exception 'Synthetic Gmail proof authorization was not found';
end;
$$;

create or replace function public.owner_close_refund_synthetic_gmail_proof(
  p_authorization_id uuid,
  p_confirmation text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  proof_auth public.refund_synthetic_gmail_proof_authorizations%rowtype;
  operation_owner name;
  database_owner name;
begin
  select pg_get_userbyid(routine.proowner)
  into operation_owner
  from pg_proc routine
  where routine.oid =
    'public.owner_close_refund_synthetic_gmail_proof(uuid,text)'::regprocedure;
  select pg_get_userbyid(database.datdba)
  into database_owner
  from pg_database database
  where database.datname = current_database();
  if operation_owner is null
    or database_owner is null
    or operation_owner <> database_owner
    or current_user <> operation_owner
    or session_user <> database_owner then
    raise exception 'Synthetic Gmail proof close is database-owner only';
  end if;
  if p_confirmation is distinct from 'CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW' then
    raise exception 'Exact synthetic Gmail proof close confirmation is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('refund-synthetic-gmail-proof-exclusive-window', 800)
  );
  select existing.*
  into strict proof_auth
  from public.refund_synthetic_gmail_proof_authorizations existing
  where existing.id = p_authorization_id
  for update;

  update public.refund_synthetic_gmail_proof_authorizations
  set cancelled_at = coalesce(cancelled_at, statement_timestamp())
  where id = proof_auth.id;

  return jsonb_build_object(
    'closed', true,
    'activeAuthorizationCount', (
      select count(*)
      from public.refund_synthetic_gmail_proof_authorizations existing
      where existing.cancelled_at is null
    ),
    'payloadRedacted', true
  );
exception when no_data_found then
  raise exception 'Synthetic Gmail proof authorization was not found';
end;
$$;

revoke all on function public.refund_synthetic_gmail_proof_recipient_allowed(text)
  from public, anon, authenticated, service_role;
revoke all on function public.refund_synthetic_gmail_proof_route_digest(text[])
  from public, anon, authenticated, service_role;
revoke all on function public.owner_prepare_refund_synthetic_gmail_proof(uuid,text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.owner_get_refund_synthetic_gmail_proof_summary(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.owner_close_refund_synthetic_gmail_proof(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.service_authorize_refund_synthetic_gmail_proof(uuid,text,text,text,boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.service_bind_refund_synthetic_gmail_proof_message(uuid,uuid,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.service_verify_refund_synthetic_gmail_proof_transport(uuid,uuid,text,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.service_authorize_refund_synthetic_gmail_proof(uuid,text,text,text,boolean)
  to service_role;
grant execute on function public.service_bind_refund_synthetic_gmail_proof_message(uuid,uuid,uuid)
  to service_role;
grant execute on function public.service_verify_refund_synthetic_gmail_proof_transport(uuid,uuid,text,uuid)
  to service_role;

comment on table public.refund_synthetic_gmail_proof_authorizations is
  'Private one-shot proof boundary. Stores only hashes, counts, timestamps, and internal foreign keys; one unclosed row blocks every unrelated case-message transport.';
comment on function public.owner_prepare_refund_synthetic_gmail_proof(uuid,text,text) is
  'Database-owner-only preparation for one five-minute, exact-case, exact-recipient, attachment-free Gmail proof. It enables no runtime switch and sends nothing.';
comment on function public.service_authorize_refund_synthetic_gmail_proof(uuid,text,text,text,boolean) is
  'Service-only pre-insert boundary. Atomically consumes the one-shot run token or blocks every case-message send while a proof window is unclosed.';
comment on function public.owner_get_refund_synthetic_gmail_proof_summary(uuid,text) is
  'Database-owner-only aggregate evidence: exactly one message/outbound, original thread, Info sender, exact customer/manager digests, no attachment, no unresolved delivery.';

select pg_notify('pgrst', 'reload schema');
