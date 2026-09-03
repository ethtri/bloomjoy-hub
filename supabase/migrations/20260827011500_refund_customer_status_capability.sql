-- #993: opaque, read-only customer refund status capabilities.
--
-- Raw capability tokens never enter the database. The public Edge boundary
-- supplies only a SHA-256 digest and returns an allowlisted customer view of
-- refund_lifecycle_v1. Browser roles cannot read or mutate any capability,
-- access audit, case, or provider surface through this migration.

-- A short issue category is sufficient for normal intake. Free-text detail
-- remains bounded by the Edge allowlist but is no longer required to create a
-- safe case; the same-case correction loop can request details later.
alter table public.refund_cases
  drop constraint if exists refund_cases_issue_summary_present;

create table public.refund_case_status_capabilities (
  id uuid primary key default extensions.gen_random_uuid(),
  refund_case_id uuid not null
    references public.refund_cases (id) on delete restrict,
  token_digest text not null unique
    check (token_digest ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_reason text check (
    revoked_reason is null
    or revoked_reason in ('rotated', 'owner_revoked', 'security_hold', 'case_closed')
  ),
  access_count bigint not null default 0 check (access_count >= 0),
  last_accessed_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint refund_case_status_capability_expiry_check check (
    expires_at > created_at
    and expires_at <= created_at + interval '45 days'
  ),
  constraint refund_case_status_capability_revocation_check check (
    (revoked_at is null and revoked_reason is null)
    or (revoked_at is not null and revoked_reason is not null)
  )
);

create index refund_case_status_capability_case_idx
  on public.refund_case_status_capabilities (refund_case_id, created_at desc);
create index refund_case_status_capability_expiry_idx
  on public.refund_case_status_capabilities (expires_at)
  where revoked_at is null;

alter table public.refund_case_messages
  add column status_capability_id uuid
    references public.refund_case_status_capabilities (id) on delete restrict,
  add column status_link_included boolean not null default false,
  add constraint refund_case_messages_status_capability_check check (
    (status_link_included is false and status_capability_id is null)
    or (status_link_included is true and status_capability_id is not null)
  );

create table public.refund_case_status_access_windows (
  access_key_digest text not null
    check (access_key_digest ~ '^[a-f0-9]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null default 1 check (request_count > 0),
  expires_at timestamptz not null,
  primary key (access_key_digest, window_started_at),
  constraint refund_case_status_access_window_expiry_check check (
    expires_at > window_started_at
    and expires_at <= window_started_at + interval '2 hours'
  )
);

create index refund_case_status_access_window_expiry_idx
  on public.refund_case_status_access_windows (expires_at);

create table public.refund_case_status_access_audit (
  id uuid primary key default extensions.gen_random_uuid(),
  capability_id uuid
    references public.refund_case_status_capabilities (id) on delete restrict,
  access_key_digest text not null
    check (access_key_digest ~ '^[a-f0-9]{64}$'),
  outcome text not null
    check (outcome in ('available', 'unavailable', 'rate_limited')),
  accessed_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '30 days'),
  constraint refund_case_status_access_audit_expiry_check check (
    expires_at > accessed_at
    and expires_at <= accessed_at + interval '31 days'
  )
);

create index refund_case_status_access_audit_expiry_idx
  on public.refund_case_status_access_audit (expires_at);
create index refund_case_status_access_audit_capability_idx
  on public.refund_case_status_access_audit (capability_id, accessed_at desc);

alter table public.refund_case_status_capabilities enable row level security;
alter table public.refund_case_status_access_windows enable row level security;
alter table public.refund_case_status_access_audit enable row level security;

revoke all on table public.refund_case_status_capabilities
  from public, anon, authenticated, service_role;
revoke all on table public.refund_case_status_access_windows
  from public, anon, authenticated, service_role;
revoke all on table public.refund_case_status_access_audit
  from public, anon, authenticated, service_role;

create or replace function public.service_issue_refund_status_capability(
  p_refund_case_id uuid,
  p_token_digest text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  inserted public.refund_case_status_capabilities%rowtype;
begin
  if p_refund_case_id is null
    or p_token_digest is null
    or p_token_digest !~ '^[a-f0-9]{64}$'
    or p_expires_at is null
    or p_expires_at <= statement_timestamp() + interval '1 hour'
    or p_expires_at > statement_timestamp() + interval '45 days' then
    raise exception 'Invalid refund status capability request'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
  ) then
    raise exception 'Invalid refund status capability request'
      using errcode = '22023';
  end if;

  insert into public.refund_case_status_capabilities (
    refund_case_id,
    token_digest,
    expires_at
  ) values (
    p_refund_case_id,
    p_token_digest,
    p_expires_at
  )
  returning * into inserted;

  return jsonb_build_object(
    'issued', true,
    'capabilityId', inserted.id,
    'expiresAt', inserted.expires_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_issue_refund_status_capability(
  uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.service_issue_refund_status_capability(
  uuid, text, timestamptz
) to service_role;

create or replace function public.service_revoke_refund_status_capabilities(
  p_refund_case_id uuid,
  p_reason text default 'owner_revoked'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_count integer;
begin
  if p_refund_case_id is null
    or p_reason not in ('rotated', 'owner_revoked', 'security_hold', 'case_closed') then
    raise exception 'Invalid refund status capability revocation'
      using errcode = '22023';
  end if;

  update public.refund_case_status_capabilities capability
  set revoked_at = statement_timestamp(), revoked_reason = p_reason
  where capability.refund_case_id = p_refund_case_id
    and capability.revoked_at is null
    and capability.expires_at > statement_timestamp();
  get diagnostics revoked_count = row_count;

  return jsonb_build_object(
    'revokedCount', revoked_count,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_revoke_refund_status_capabilities(
  uuid, text
) from public, anon, authenticated;
grant execute on function public.service_revoke_refund_status_capabilities(
  uuid, text
) to service_role;

create or replace function public.service_attach_refund_status_capability_to_message(
  p_refund_case_id uuid,
  p_refund_case_message_id uuid,
  p_status_capability_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed_count integer;
begin
  if not exists (
    select 1
    from public.refund_case_status_capabilities capability
    where capability.id = p_status_capability_id
      and capability.refund_case_id = p_refund_case_id
      and capability.revoked_at is null
      and capability.expires_at > statement_timestamp()
  ) then
    raise exception 'Invalid refund status message capability'
      using errcode = '22023';
  end if;

  update public.refund_case_messages message
  set status_capability_id = p_status_capability_id,
      status_link_included = true
  where message.id = p_refund_case_message_id
    and message.refund_case_id = p_refund_case_id;
  get diagnostics changed_count = row_count;
  if changed_count <> 1 then
    raise exception 'Invalid refund status message capability'
      using errcode = '22023';
  end if;
  return true;
end;
$$;

revoke execute on function public.service_attach_refund_status_capability_to_message(
  uuid, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.service_attach_refund_status_capability_to_message(
  uuid, uuid, uuid
) to service_role;

create or replace function public.service_prune_refund_status_access_evidence()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_windows integer;
  deleted_audit integer;
begin
  delete from public.refund_case_status_access_windows access_window
  where access_window.expires_at <= statement_timestamp();
  get diagnostics deleted_windows = row_count;

  delete from public.refund_case_status_access_audit access_audit
  where access_audit.expires_at <= statement_timestamp();
  get diagnostics deleted_audit = row_count;

  return jsonb_build_object(
    'accessWindowCount', deleted_windows,
    'accessAuditCount', deleted_audit,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_prune_refund_status_access_evidence()
  from public, anon, authenticated;
grant execute on function public.service_prune_refund_status_access_evidence()
  to service_role;

create or replace function public.service_read_refund_status_capability(
  p_token_digest text,
  p_access_key_digest text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  capability public.refund_case_status_capabilities%rowtype;
  lifecycle jsonb;
  current_count integer;
  window_start timestamptz := date_trunc('minute', statement_timestamp());
begin
  if p_access_key_digest is null
    or p_access_key_digest !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid refund status access key' using errcode = '22023';
  end if;

  perform public.service_prune_refund_status_access_evidence();

  insert into public.refund_case_status_access_windows (
    access_key_digest,
    window_started_at,
    request_count,
    expires_at
  ) values (
    p_access_key_digest,
    window_start,
    1,
    window_start + interval '2 hours'
  )
  on conflict (access_key_digest, window_started_at)
  do update set request_count =
    public.refund_case_status_access_windows.request_count + 1
  returning request_count into current_count;

  if current_count > 20 then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (null, p_access_key_digest, 'rate_limited');
    return jsonb_build_object(
      'available', false,
      'rateLimited', true,
      'payloadRedacted', true
    );
  end if;

  if p_token_digest is not null and p_token_digest ~ '^[a-f0-9]{64}$' then
    select existing.* into capability
    from public.refund_case_status_capabilities existing
    where existing.token_digest = p_token_digest
      and existing.revoked_at is null
      and existing.expires_at > statement_timestamp();
  end if;

  if capability.id is null then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (null, p_access_key_digest, 'unavailable');
    return jsonb_build_object(
      'available', false,
      'rateLimited', false,
      'payloadRedacted', true
    );
  end if;

  lifecycle := public.refund_lifecycle_contract(capability.refund_case_id);
  if lifecycle is null
    or lifecycle ->> 'schemaVersion' <> 'refund_lifecycle_v1'
    or coalesce((lifecycle ->> 'payloadRedacted')::boolean, false) is false then
    insert into public.refund_case_status_access_audit (
      capability_id, access_key_digest, outcome
    ) values (capability.id, p_access_key_digest, 'unavailable');
    return jsonb_build_object(
      'available', false,
      'rateLimited', false,
      'payloadRedacted', true
    );
  end if;

  update public.refund_case_status_capabilities existing
  set access_count = existing.access_count + 1,
      last_accessed_at = statement_timestamp()
  where existing.id = capability.id;

  insert into public.refund_case_status_access_audit (
    capability_id, access_key_digest, outcome
  ) values (capability.id, p_access_key_digest, 'available');

  return jsonb_build_object(
    'available', true,
    'rateLimited', false,
    'lifecycle', lifecycle,
    'expiresAt', capability.expires_at,
    'payloadRedacted', true
  );
end;
$$;

revoke execute on function public.service_read_refund_status_capability(
  text, text
) from public, anon, authenticated;
grant execute on function public.service_read_refund_status_capability(
  text, text
) to service_role;

comment on table public.refund_case_status_capabilities is
  'One-case, read-only customer status capability digests. Raw tokens are never stored.';
comment on function public.service_read_refund_status_capability(text, text) is
  'Service-only, rate-limited read of the canonical refund_lifecycle_v1 contract with generic unavailable responses.';

-- Keep every database-canonical card completion truthful about the distinction
-- between Nayax approval and later cardholder-bank posting.
create or replace function public.canonicalize_refund_outcome_customer_copy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  greeting_break integer;
  required_opening constant text :=
    'Nayax has approved your refund. Your bank may take up to 4 business days to show it on your account.';
begin
  if new.message_type <> 'completed'
    or coalesce(new.template_version, '') <> 'refund_nayax_completion_v2' then
    return new;
  end if;

  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = new.refund_case_id;

  if case_row.id is null
    or case_row.status <> 'completed'
    or case_row.decision <> 'approved'
    or case_row.refund_completed_at is null then
    raise exception 'Confirmed completion required for customer success copy';
  end if;

  if position(required_opening in coalesce(new.body, '')) = 0 then
    greeting_break := position(E'\n\n' in coalesce(new.body, ''));
    new.body := case
      when greeting_break > 0 then
        left(new.body, greeting_break - 1) || E'\n\n' || required_opening ||
          E'\n\n' || substring(new.body from greeting_break + 2)
      else required_opening || E'\n\n' || coalesce(new.body, '')
    end;
  end if;
  return new;
end;
$$;
