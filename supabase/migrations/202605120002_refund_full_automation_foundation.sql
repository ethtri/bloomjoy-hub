-- Refund full automation foundation.
--
-- This migration does not enable automatic provider refunds by itself. It adds
-- the audit, message, and safety surfaces needed before Bloomjoy can graduate
-- from manager-approved/manual completion to gated Nayax execution.

alter table public.refund_cases
  add column if not exists automation_state text not null default 'submitted',
  add column if not exists automation_follow_up_due_at timestamptz,
  add column if not exists customer_last_contacted_at timestamptz,
  add column if not exists last_customer_message_type text,
  add column if not exists nayax_refund_execution_status text not null default 'not_requested',
  add column if not exists refund_business_fingerprint text;

alter table public.reporting_machines
  add column if not exists nayax_refunds_enabled boolean not null default false,
  add column if not exists nayax_refund_max_amount_cents integer,
  add column if not exists refund_intake_enabled boolean not null default false,
  add column if not exists refund_public_display_label text;

alter table public.refund_adjustment_review_rows
  add column if not exists refund_business_fingerprint text;

alter table public.sales_adjustment_facts
  add column if not exists refund_business_fingerprint text;

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_refund_max_amount_check;

alter table public.reporting_machines
  add constraint reporting_machines_nayax_refund_max_amount_check
  check (
    nayax_refund_max_amount_cents is null
    or nayax_refund_max_amount_cents > 0
  );

alter table public.refund_cases
  drop constraint if exists refund_cases_automation_state_check;

alter table public.refund_cases
  add constraint refund_cases_automation_state_check
  check (automation_state in (
    'submitted',
    'under_review',
    'more_info_needed',
    'customer_replied',
    'approved',
    'denied',
    'completed',
    'closed_incomplete',
    'escalated'
  ));

alter table public.refund_cases
  drop constraint if exists refund_cases_nayax_refund_execution_status_check;

alter table public.refund_cases
  add constraint refund_cases_nayax_refund_execution_status_check
  check (nayax_refund_execution_status in (
    'not_requested',
    'ready',
    'requested',
    'approved',
    'declined',
    'failed',
    'ambiguous',
    'disabled',
    'manual_review'
  ));

create index if not exists refund_cases_automation_follow_up_idx
  on public.refund_cases (automation_state, automation_follow_up_due_at)
  where automation_follow_up_due_at is not null;

create index if not exists refund_cases_business_fingerprint_idx
  on public.refund_cases (refund_business_fingerprint)
  where refund_business_fingerprint is not null;

create index if not exists refund_adjustment_review_business_fingerprint_idx
  on public.refund_adjustment_review_rows (refund_business_fingerprint)
  where refund_business_fingerprint is not null;

create index if not exists sales_adjustment_facts_refund_business_fingerprint_idx
  on public.sales_adjustment_facts (refund_business_fingerprint)
  where refund_business_fingerprint is not null
    and source in ('google_sheets', 'refund_case')
    and adjustment_type in ('refund', 'complaint_refund');

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_message_type_check;

alter table public.refund_case_messages
  add constraint refund_case_messages_message_type_check
  check (message_type in (
    'confirmation',
    'more_info',
    'reminder',
    'status_update',
    'approved',
    'denied',
    'completed',
    'escalation',
    'manual_note'
  ));

create table if not exists public.refund_case_nayax_refund_attempts (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  execution_mode text not null default 'preflight'
    check (execution_mode in ('preflight', 'request', 'approve', 'decline', 'request_and_approve')),
  status text not null default 'created'
    check (status in (
      'created',
      'preflight_blocked',
      'disabled',
      'in_progress',
      'requested',
      'approved',
      'succeeded',
      'declined',
      'failed',
      'ambiguous',
      'manual_review'
    )),
  idempotency_key text not null,
  amount_cents integer not null check (amount_cents >= 0),
  transaction_id_present boolean not null default false,
  site_id_present boolean not null default false,
  machine_auth_time_present boolean not null default false,
  provider_reference text,
  provider_status text,
  error_code text,
  sanitized_request jsonb not null default '{}'::jsonb,
  sanitized_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_case_nayax_attempt_idempotency_unique unique (idempotency_key),
  constraint refund_case_nayax_attempt_provider_reference_safe check (
    provider_reference is null
    or provider_reference ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,119}$'
  )
);

create index if not exists refund_case_nayax_attempts_case_created_idx
  on public.refund_case_nayax_refund_attempts (refund_case_id, created_at desc);

create index if not exists refund_case_nayax_attempts_status_idx
  on public.refund_case_nayax_refund_attempts (status, created_at desc);

create unique index if not exists refund_case_nayax_one_live_attempt_per_case_idx
  on public.refund_case_nayax_refund_attempts (refund_case_id)
  where status in ('in_progress', 'requested', 'approved', 'succeeded');

drop trigger if exists refund_case_nayax_attempts_set_updated_at
  on public.refund_case_nayax_refund_attempts;
create trigger refund_case_nayax_attempts_set_updated_at
before update on public.refund_case_nayax_refund_attempts
for each row execute function public.set_updated_at();

create or replace function public.can_prepare_nayax_refund_execution(
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
      where refund_case.id = p_refund_case_id
        and public.can_manage_refund_case(p_user_id, refund_case.id)
        and public.is_super_admin(p_user_id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id)
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_machine_auth_time is not null
        and coalesce(refund_case.refund_amount_cents, refund_case.payment_amount_cents, 0) > 0
        and refund_case.reporting_adjustment_id is null
        and exists (
          select 1
          from public.reporting_machines machine
          where machine.id = refund_case.reporting_machine_id
            and machine.status = 'active'
            and machine.nayax_refunds_enabled = true
            and machine.nayax_machine_id is not null
            and btrim(machine.nayax_machine_id) <> ''
            and (
              machine.nayax_refund_max_amount_cents is null
              or coalesce(refund_case.refund_amount_cents, refund_case.payment_amount_cents, 0)
                <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

comment on function public.can_prepare_nayax_refund_execution(uuid, uuid) is
  'Readiness predicate for gated Nayax refund execution. This does not call Nayax or approve refunds.';

create or replace function public.build_refund_business_fingerprint(
  p_machine_id uuid,
  p_incident_date date,
  p_amount_cents integer,
  p_payment_method text default null
)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_machine_id is null
      or p_incident_date is null
      or coalesce(p_amount_cents, 0) <= 0
    then null
    else md5(concat_ws(
      '|',
      p_machine_id::text,
      p_incident_date::text,
      p_amount_cents::text
    ))
  end;
$$;

create or replace function public.refund_raw_payload_date_or_null(p_payload jsonb, p_key text)
returns date
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_value text := nullif(trim(coalesce(p_payload ->> p_key, '')), '');
begin
  if raw_value is null or left(raw_value, 10) !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  return left(raw_value, 10)::date;
exception
  when others then
    return null;
end;
$$;

create or replace function public.set_refund_case_business_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.refund_business_fingerprint := public.build_refund_business_fingerprint(
    new.reporting_machine_id,
    new.incident_at::date,
    coalesce(new.refund_amount_cents, new.payment_amount_cents),
    new.payment_method
  );

  return new;
end;
$$;

drop trigger if exists refund_cases_set_business_fingerprint on public.refund_cases;
create trigger refund_cases_set_business_fingerprint
before insert or update on public.refund_cases
for each row execute function public.set_refund_case_business_fingerprint();

create or replace function public.set_refund_review_row_business_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.refund_business_fingerprint := public.build_refund_business_fingerprint(
    new.matched_machine_id,
    coalesce(new.original_order_date, new.refund_date),
    new.amount_cents,
    coalesce(new.raw_payload ->> 'payment_method', 'unknown')
  );

  return new;
end;
$$;

drop trigger if exists refund_adjustment_review_rows_business_fingerprint
  on public.refund_adjustment_review_rows;
create trigger refund_adjustment_review_rows_business_fingerprint
before insert or update on public.refund_adjustment_review_rows
for each row execute function public.set_refund_review_row_business_fingerprint();

create or replace function public.set_sales_adjustment_refund_business_fingerprint()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  refund_case_row public.refund_cases;
  fingerprint_date date;
  duplicate_adjustment_id uuid;
  duplicate_case_id uuid;
begin
  if new.source in ('google_sheets', 'refund_case')
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if new.refund_case_id is not null then
      select *
      into refund_case_row
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id;

      new.refund_business_fingerprint := public.build_refund_business_fingerprint(
        coalesce(refund_case_row.reporting_machine_id, new.reporting_machine_id),
        coalesce(refund_case_row.incident_at::date, new.adjustment_date),
        coalesce(new.amount_cents, refund_case_row.refund_amount_cents, refund_case_row.payment_amount_cents),
        refund_case_row.payment_method
      );
    else
      fingerprint_date := coalesce(
        public.refund_raw_payload_date_or_null(new.raw_payload, 'original_order_date'),
        public.refund_raw_payload_date_or_null(new.raw_payload, 'incident_date'),
        new.adjustment_date
      );

      new.refund_business_fingerprint := public.build_refund_business_fingerprint(
        new.reporting_machine_id,
        fingerprint_date,
        new.amount_cents,
        coalesce(new.raw_payload ->> 'payment_method', 'unknown')
      );
    end if;

    if new.refund_business_fingerprint is not null
      and coalesce(new.match_status, '') = 'applied' then
      select refund_case.id
      into duplicate_case_id
      from public.refund_cases refund_case
      where refund_case.id <> coalesce(new.refund_case_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and refund_case.refund_business_fingerprint = new.refund_business_fingerprint
        and refund_case.status not in ('denied', 'closed')
      limit 1;

      if duplicate_case_id is not null then
        raise exception 'Potential duplicate refund settlement adjustment requires review'
          using errcode = '23505';
      end if;

      select adjustment.id
      into duplicate_adjustment_id
      from public.sales_adjustment_facts adjustment
      where adjustment.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
        and adjustment.source in ('google_sheets', 'refund_case')
        and adjustment.adjustment_type in ('refund', 'complaint_refund')
        and adjustment.match_status = 'applied'
        and adjustment.refund_business_fingerprint = new.refund_business_fingerprint
      limit 1;

      if duplicate_adjustment_id is not null then
        raise exception 'Potential duplicate refund settlement adjustment requires review'
          using errcode = '23505';
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sales_adjustment_facts_refund_business_fingerprint
  on public.sales_adjustment_facts;
create trigger sales_adjustment_facts_refund_business_fingerprint
before insert or update on public.sales_adjustment_facts
for each row execute function public.set_sales_adjustment_refund_business_fingerprint();

create or replace function public.service_update_refund_case_as_actor(
  p_actor_user_id uuid,
  p_case_id uuid,
  p_status text default null,
  p_assigned_manager_email text default null,
  p_decision text default null,
  p_decision_reason text default null,
  p_internal_note text default null,
  p_refund_amount_cents integer default null,
  p_manual_refund_reference text default null,
  p_clear_nayax_match boolean default false,
  p_matched_nayax_transaction_id text default null,
  p_matched_nayax_site_id integer default null,
  p_matched_nayax_machine_auth_time timestamptz default null,
  p_matched_nayax_amount_cents integer default null,
  p_matched_nayax_card_last4 text default null,
  p_matched_nayax_currency_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_actor_user_id is null then
    raise exception 'Actor is required';
  end if;

  if not public.can_manage_refund_case(p_actor_user_id, p_case_id) then
    raise exception 'Refund case access required';
  end if;

  perform set_config('request.jwt.claim.sub', p_actor_user_id::text, true);

  return public.admin_update_refund_case(
    p_case_id,
    p_status,
    p_assigned_manager_email,
    p_decision,
    p_decision_reason,
    p_internal_note,
    p_refund_amount_cents,
    p_manual_refund_reference,
    p_clear_nayax_match,
    p_matched_nayax_transaction_id,
    p_matched_nayax_site_id,
    p_matched_nayax_machine_auth_time,
    p_matched_nayax_amount_cents,
    p_matched_nayax_card_last4,
    p_matched_nayax_currency_code
  );
end;
$$;

comment on function public.service_update_refund_case_as_actor(uuid, uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text) is
  'Service-role-only refund case mutation wrapper used by refund-case-admin-update so browser clients cannot bypass customer communication automation.';

create or replace function public.public_refund_machine_options()
returns table (
  machine_id uuid,
  machine_label text,
  location_id uuid,
  location_name text,
  location_timezone text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    machine.id as machine_id,
    coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label) as machine_label,
    location.id as location_id,
    location.name as location_name,
    location.timezone as location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and machine.refund_intake_enabled = true
    and location.status = 'active'
  order by location.name, coalesce(nullif(trim(machine.refund_public_display_label), ''), machine.machine_label);
$$;

comment on function public.public_refund_machine_options() is
  'Public noindex refund intake selector. Exposes only active machines explicitly enabled for refund intake.';

create or replace function public.admin_set_reporting_machine_refund_managers(
  p_machine_id uuid,
  p_manager_emails text[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  normalized_reason text;
  normalized_email text;
  manager_emails text[];
  target_user_id uuid;
  before_rows jsonb;
  after_rows jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  normalized_reason := trim(coalesce(p_reason, ''));

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_machine_id is null then
    raise exception 'Machine is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Reason is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('machine_manager:' || p_machine_id::text));

  perform 1
  from public.reporting_machines machine
  where machine.id = p_machine_id
  for update;

  if not found then
    raise exception 'Machine not found';
  end if;

  if not actor_is_super_admin and not (p_machine_id = any(actor_machine_ids)) then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  select coalesce(array_agg(distinct normalized.entry order by normalized.entry), '{}'::text[])
  into manager_emails
  from (
    select lower(trim(entry)) as entry
    from unnest(coalesce(p_manager_emails, '{}'::text[])) as entry
    where trim(entry) <> ''
  ) normalized;

  if coalesce(array_length(manager_emails, 1), 0) > 3 then
    raise exception 'Each machine can have at most 3 active Machine Managers';
  end if;

  select coalesce(jsonb_agg(to_jsonb(manager)), '[]'::jsonb)
  into before_rows
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = p_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  update public.reporting_machine_refund_managers manager
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = actor_user_id,
    revoke_reason = normalized_reason
  where manager.reporting_machine_id = p_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null
    and not (lower(manager.manager_email) = any(manager_emails));

  foreach normalized_email in array manager_emails loop
    select auth_user.id
    into target_user_id
    from auth.users auth_user
    where lower(auth_user.email) = normalized_email
    limit 1;

    if target_user_id is null then
      raise exception 'Machine Manager % must be an authenticated user', normalized_email;
    end if;

    if not exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.reporting_machine_id = p_machine_id
        and manager.manager_user_id = target_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    ) then
      insert into public.reporting_machine_refund_managers (
        reporting_machine_id,
        manager_user_id,
        manager_email,
        status,
        grant_reason,
        granted_by
      )
      values (
        p_machine_id,
        target_user_id,
        normalized_email,
        'active',
        normalized_reason,
        actor_user_id
      );
    end if;
  end loop;

  select coalesce(jsonb_agg(to_jsonb(manager) order by manager.manager_email), '[]'::jsonb)
  into after_rows
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = p_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    actor_user_id,
    'reporting_machine_refund_managers.set',
    'reporting_machine',
    p_machine_id::text,
    before_rows,
    after_rows,
    jsonb_build_object(
      'reason', normalized_reason,
      'manager_count', coalesce(array_length(manager_emails, 1), 0),
      'actor_authority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end,
      'concurrency_lock', 'machine_manager'
    )
  );

  return jsonb_build_object('managerAssignments', after_rows);
end;
$$;

alter table public.refund_case_nayax_refund_attempts enable row level security;

drop policy if exists "refund_case_nayax_attempts_select_accessible"
  on public.refund_case_nayax_refund_attempts;
create policy "refund_case_nayax_attempts_select_accessible"
on public.refund_case_nayax_refund_attempts
for select
using (public.can_manage_refund_case_current_user(refund_case_id));

revoke all on public.refund_case_nayax_refund_attempts from anon, authenticated;
grant select on public.refund_case_nayax_refund_attempts to authenticated;

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid)
  to service_role;

revoke execute on function public.build_refund_business_fingerprint(uuid, date, integer, text)
  from public, anon, authenticated;
revoke execute on function public.refund_raw_payload_date_or_null(jsonb, text)
  from public, anon, authenticated;
revoke execute on function public.set_refund_case_business_fingerprint()
  from public, anon, authenticated;
revoke execute on function public.set_refund_review_row_business_fingerprint()
  from public, anon, authenticated;
revoke execute on function public.set_sales_adjustment_refund_business_fingerprint()
  from public, anon, authenticated;
grant execute on function public.build_refund_business_fingerprint(uuid, date, integer, text)
  to service_role;
grant execute on function public.refund_raw_payload_date_or_null(jsonb, text)
  to service_role;
grant execute on function public.set_refund_case_business_fingerprint()
  to service_role;
grant execute on function public.set_refund_review_row_business_fingerprint()
  to service_role;
grant execute on function public.set_sales_adjustment_refund_business_fingerprint()
  to service_role;

revoke execute on function public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)
  to service_role;
comment on function public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text) is
  'Service-role-only refund case mutation. Browser clients must use refund-case-admin-update so customer communication automation cannot be bypassed.';

revoke execute on function public.service_update_refund_case_as_actor(uuid, uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text) from public, anon, authenticated;
grant execute on function public.service_update_refund_case_as_actor(uuid, uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text) to service_role;

select pg_notify('pgrst', 'reload schema');
