-- Refund operations MVP: customer intake, manager assignments, conservative
-- transaction correlation, decision workflow, and reporting bridge.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'refund-case-attachments',
  'refund-case-attachments',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.reporting_machines
  add column if not exists nayax_machine_id text,
  add column if not exists nayax_account_key text;

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_machine_id_format;

alter table public.reporting_machines
  add constraint reporting_machines_nayax_machine_id_format
  check (
    nayax_machine_id is null
    or trim(nayax_machine_id) ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$'
  );

alter table public.reporting_machines
  drop constraint if exists reporting_machines_nayax_account_key_format;

alter table public.reporting_machines
  add constraint reporting_machines_nayax_account_key_format
  check (
    nayax_account_key is null
    or trim(nayax_account_key) ~ '^[A-Za-z0-9][A-Za-z0-9_:-]{1,79}$'
  );

create unique index if not exists reporting_machines_nayax_machine_id_idx
  on public.reporting_machines (
    lower(coalesce(nayax_account_key, 'default')),
    lower(nayax_machine_id)
  )
  where nayax_machine_id is not null;

create table if not exists public.reporting_machine_refund_managers (
  id uuid primary key default gen_random_uuid(),
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete cascade,
  manager_user_id uuid not null references auth.users (id) on delete cascade,
  manager_email text not null,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  grant_reason text not null default 'Refund manager assignment',
  granted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reporting_machine_refund_managers_email_present
    check (length(trim(manager_email)) > 0),
  constraint reporting_machine_refund_managers_reason_present
    check (length(trim(grant_reason)) > 0),
  constraint reporting_machine_refund_managers_revoke_reason_required
    check (revoked_at is null or length(trim(coalesce(revoke_reason, ''))) > 0)
);

create unique index if not exists reporting_machine_refund_managers_active_user_idx
  on public.reporting_machine_refund_managers (reporting_machine_id, manager_user_id)
  where status = 'active' and revoked_at is null;

create index if not exists reporting_machine_refund_managers_machine_idx
  on public.reporting_machine_refund_managers (reporting_machine_id)
  where status = 'active' and revoked_at is null;

create index if not exists reporting_machine_refund_managers_user_idx
  on public.reporting_machine_refund_managers (manager_user_id)
  where status = 'active' and revoked_at is null;

drop trigger if exists reporting_machine_refund_managers_set_updated_at
  on public.reporting_machine_refund_managers;
create trigger reporting_machine_refund_managers_set_updated_at
before update on public.reporting_machine_refund_managers
for each row execute function public.set_updated_at();

create or replace function public.assert_refund_machine_manager_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_manager_count integer;
begin
  if new.status = 'active' and new.revoked_at is null then
    select count(*)
    into active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = new.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and manager.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid);

    if active_manager_count >= 3 then
      raise exception 'Each machine can have at most 3 active refund managers'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reporting_machine_refund_manager_limit
  on public.reporting_machine_refund_managers;
create trigger reporting_machine_refund_manager_limit
before insert or update on public.reporting_machine_refund_managers
for each row execute function public.assert_refund_machine_manager_limit();

create table if not exists public.refund_cases (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null default (
    'RF-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  reporting_machine_id uuid not null references public.reporting_machines (id) on delete restrict,
  reporting_location_id uuid not null references public.reporting_locations (id) on delete restrict,
  customer_email text not null,
  customer_name text,
  customer_phone text,
  issue_summary text not null,
  incident_at timestamptz not null,
  payment_method text not null
    check (payment_method in ('card', 'cash', 'unknown')),
  payment_amount_cents integer check (payment_amount_cents is null or payment_amount_cents >= 0),
  card_last4 text,
  card_wallet_used boolean not null default false,
  status text not null default 'submitted'
    check (status in (
      'submitted',
      'needs_review',
      'waiting_on_customer',
      'correlated',
      'approved',
      'denied',
      'card_refund_pending',
      'cash_zelle_pending',
      'completed',
      'closed'
    )),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  correlation_status text not null default 'not_started'
    check (correlation_status in (
      'not_started',
      'matched',
      'no_match',
      'multiple_candidates',
      'needs_nayax',
      'nayax_not_configured',
      'manual_review'
    )),
  correlation_source text
    check (correlation_source is null or correlation_source in ('nayax', 'sunze', 'manual')),
  correlation_confidence numeric(5,4) not null default 0
    check (correlation_confidence >= 0 and correlation_confidence <= 1),
  correlation_summary text,
  matched_sales_fact_id uuid references public.machine_sales_facts (id) on delete set null,
  matched_nayax_transaction_id text,
  matched_nayax_site_id integer check (matched_nayax_site_id is null or matched_nayax_site_id >= 0),
  matched_nayax_machine_auth_time timestamptz,
  matched_nayax_amount_cents integer check (
    matched_nayax_amount_cents is null or matched_nayax_amount_cents >= 0
  ),
  matched_nayax_card_last4 text check (
    matched_nayax_card_last4 is null or matched_nayax_card_last4 ~ '^[0-9]{4}$'
  ),
  matched_nayax_currency_code text check (
    matched_nayax_currency_code is null or matched_nayax_currency_code ~ '^[A-Z]{3}$'
  ),
  assigned_manager_id uuid references auth.users (id) on delete set null,
  decision text check (decision is null or decision in ('approved', 'denied')),
  decision_reason text,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  refund_amount_cents integer check (refund_amount_cents is null or refund_amount_cents >= 0),
  manual_refund_reference text,
  refund_completed_by uuid references auth.users (id) on delete set null,
  refund_completed_at timestamptz,
  reporting_adjustment_id uuid,
  intake_meta jsonb not null default '{}'::jsonb,
  server_dedupe_key text,
  server_dedupe_window_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_cases_public_reference_unique unique (public_reference),
  constraint refund_cases_customer_email_present check (length(trim(customer_email)) > 0),
  constraint refund_cases_issue_summary_present check (length(trim(issue_summary)) > 0),
  constraint refund_cases_card_last4_format check (card_last4 is null or card_last4 ~ '^[0-9]{4}$')
);

create index if not exists refund_cases_created_at_idx
  on public.refund_cases (created_at desc);

create index if not exists refund_cases_machine_status_idx
  on public.refund_cases (reporting_machine_id, status, created_at desc);

create index if not exists refund_cases_customer_email_idx
  on public.refund_cases (lower(customer_email), created_at desc);

create unique index if not exists refund_cases_server_dedupe_key_idx
  on public.refund_cases (server_dedupe_key)
  where server_dedupe_key is not null;

create index if not exists refund_cases_server_dedupe_window_idx
  on public.refund_cases (server_dedupe_window_started_at desc)
  where server_dedupe_window_started_at is not null;

create index if not exists refund_cases_matched_sales_fact_idx
  on public.refund_cases (matched_sales_fact_id)
  where matched_sales_fact_id is not null;

drop trigger if exists refund_cases_set_updated_at on public.refund_cases;
create trigger refund_cases_set_updated_at
before update on public.refund_cases
for each row execute function public.set_updated_at();

create table if not exists public.refund_case_events (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint refund_case_events_event_type_present check (length(trim(event_type)) > 0)
);

create index if not exists refund_case_events_case_created_idx
  on public.refund_case_events (refund_case_id, created_at desc);

create table if not exists public.refund_case_messages (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  message_type text not null
    check (message_type in (
      'confirmation',
      'more_info',
      'approved',
      'denied',
      'manual_note'
    )),
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  recipient_email text not null,
  subject text not null,
  body text not null,
  template_key text,
  sent_at timestamptz,
  error_message text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint refund_case_messages_recipient_present check (length(trim(recipient_email)) > 0),
  constraint refund_case_messages_subject_present check (length(trim(subject)) > 0)
);

create index if not exists refund_case_messages_case_created_idx
  on public.refund_case_messages (refund_case_id, created_at desc);

create table if not exists public.refund_case_attachments (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  storage_bucket text not null default 'refund-case-attachments',
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  byte_size integer not null default 0 check (byte_size >= 0),
  uploaded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint refund_case_attachments_storage_path_present check (length(trim(storage_path)) > 0),
  constraint refund_case_attachments_file_name_present check (length(trim(file_name)) > 0),
  constraint refund_case_attachments_storage_path_unique unique (storage_bucket, storage_path)
);

create index if not exists refund_case_attachments_case_idx
  on public.refund_case_attachments (refund_case_id, uploaded_at desc);

alter table public.sales_adjustment_facts
  add column if not exists refund_case_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sales_adjustment_facts_refund_case_id_fkey'
      and conrelid = 'public.sales_adjustment_facts'::regclass
  ) then
    alter table public.sales_adjustment_facts
      add constraint sales_adjustment_facts_refund_case_id_fkey
      foreign key (refund_case_id)
      references public.refund_cases (id)
      on delete set null;
  end if;
end;
$$;

do $$
begin
  alter table public.sales_adjustment_facts
    drop constraint if exists sales_adjustment_facts_source_check;

  alter table public.sales_adjustment_facts
    add constraint sales_adjustment_facts_source_check
    check (source in ('google_sheets', 'manual', 'refund_case'));
end;
$$;

create index if not exists sales_adjustment_facts_refund_case_idx
  on public.sales_adjustment_facts (refund_case_id)
  where refund_case_id is not null;

alter table public.refund_cases
  drop constraint if exists refund_cases_reporting_adjustment_id_fkey;

alter table public.refund_cases
  add constraint refund_cases_reporting_adjustment_id_fkey
  foreign key (reporting_adjustment_id)
  references public.sales_adjustment_facts (id)
  on delete set null;

create or replace function public.user_is_refund_manager(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and exists (
      select 1
      from public.reporting_machine_refund_managers manager
      where manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

create or replace function public.can_manage_refund_machine(
  p_user_id uuid,
  p_machine_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_machine_id is not null
    and (
      public.is_super_admin(p_user_id)
      or p_machine_id = any(coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]))
      or exists (
        select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id = p_machine_id
          and manager.manager_user_id = p_user_id
          and manager.status = 'active'
          and manager.revoked_at is null
      )
    );
$$;

create or replace function public.can_manage_refund_case(
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
        and public.can_manage_refund_machine(p_user_id, refund_case.reporting_machine_id)
    );
$$;

create or replace function public.can_manage_refund_machine_current_user(p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_refund_machine((select auth.uid()), p_machine_id);
$$;

create or replace function public.can_manage_refund_case_current_user(p_refund_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_manage_refund_case((select auth.uid()), p_refund_case_id);
$$;

create or replace function public.is_review_safe_nayax_transaction_reference(p_value text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select
    nullif(trim(coalesce(p_value, '')), '') is not null
    and length(trim(coalesce(p_value, ''))) between 6 and 80
    and trim(coalesce(p_value, '')) ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{5,79}$'
    and lower(trim(coalesce(p_value, ''))) not in (
      '000000',
      '111111',
      '123456',
      'abcdef',
      'manual',
      'nayax',
      'none',
      'refund',
      'test',
      'unknown'
    );
$$;

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
    machine.machine_label,
    location.id as location_id,
    location.name as location_name,
    location.timezone as location_timezone
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.status = 'active'
    and location.status = 'active'
  order by location.name, machine.machine_label;
$$;

create or replace function public.assert_sales_adjustment_refund_calculation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb := coalesce(new.raw_payload, '{}'::jsonb);
  normalized_status text := public.normalize_reporting_match_text(payload ->> 'source_status');
  normalized_decision text := public.normalize_reporting_match_text(payload ->> 'source_decision');
  refund_case_row public.refund_cases;
begin
  if new.source = 'google_sheets'
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if coalesce(new.amount_cents, 0) <= 0 then
      raise exception 'Approved refund adjustments require a positive amount before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(new.source_reference, '')), '') is null
      or nullif(trim(coalesce(new.source_row_reference, '')), '') is null then
      raise exception 'Approved refund adjustments require source references before settlement'
        using errcode = '23514';
    end if;

    if new.refund_review_row_id is null then
      raise exception 'Approved refund adjustments require a linked review row before settlement'
        using errcode = '23514';
    end if;

    if coalesce(new.match_status, '') <> 'applied' then
      raise exception 'Approved refund adjustments require applied match status before settlement'
        using errcode = '23514';
    end if;

    if coalesce(new.match_confidence, 0) <= 0 then
      raise exception 'Approved refund adjustments require positive match confidence before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'source_location', '')), '') is null then
      raise exception 'Approved refund adjustments require source location before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'refund_date', '')), '') is null then
      raise exception 'Approved refund adjustments require refund date before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(payload ->> 'amount_source', '')), '') is null then
      raise exception 'Approved refund adjustments require an amount source before settlement'
        using errcode = '23514';
    end if;

    if normalized_status <> 'closed' then
      raise exception 'Approved refund adjustments require closed source status before settlement'
        using errcode = '23514';
    end if;

    if normalized_decision not in ('approve', 'approved', 'refund approved', 'refund approve') then
      raise exception 'Approved refund adjustments require approve source decision before settlement'
        using errcode = '23514';
    end if;
  end if;

  if new.source = 'refund_case'
    and new.adjustment_type in ('refund', 'complaint_refund') then
    if coalesce(new.amount_cents, 0) <= 0 then
      raise exception 'Refund case adjustments require a positive amount before settlement'
        using errcode = '23514';
    end if;

    if nullif(trim(coalesce(new.source_reference, '')), '') is null
      or nullif(trim(coalesce(new.source_row_reference, '')), '') is null then
      raise exception 'Refund case adjustments require source references before settlement'
        using errcode = '23514';
    end if;

    if new.refund_case_id is null then
      raise exception 'Refund case adjustments require a linked refund case'
        using errcode = '23514';
    end if;

    if coalesce(new.match_status, '') <> 'applied' then
      raise exception 'Refund case adjustments require applied match status before settlement'
        using errcode = '23514';
    end if;

    if coalesce(new.match_confidence, 0) <= 0 then
      raise exception 'Refund case adjustments require positive match confidence before settlement'
        using errcode = '23514';
    end if;

    select *
    into refund_case_row
    from public.refund_cases refund_case
    where refund_case.id = new.refund_case_id;

    if refund_case_row.id is null
      or refund_case_row.status <> 'completed'
      or refund_case_row.decision <> 'approved'
      or refund_case_row.correlation_status <> 'matched'
      or refund_case_row.correlation_source is null
      or (
        refund_case_row.matched_sales_fact_id is null
        and not public.is_review_safe_nayax_transaction_reference(
          refund_case_row.matched_nayax_transaction_id
        )
      ) then
      raise exception 'Refund case adjustments require an approved, completed, fully correlated case'
        using errcode = '23514';
    end if;

    if refund_case_row.correlation_source = 'nayax'
      and (
        refund_case_row.payment_method <> 'card'
        or not public.is_review_safe_nayax_transaction_reference(
          refund_case_row.matched_nayax_transaction_id
        )
        or refund_case_row.matched_nayax_machine_auth_time is null
      ) then
      raise exception 'Refund case card adjustments require complete Nayax transaction evidence'
        using errcode = '23514';
    end if;

    if coalesce(payload ->> 'refund_case_status', '') <> 'completed'
      or coalesce(payload ->> 'refund_case_decision', '') <> 'approved' then
      raise exception 'Refund case adjustments require completed/approved payload proof'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.get_my_admin_access_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_machine_ids uuid[];
  actor_is_scoped_admin boolean;
  actor_is_refund_manager boolean;
  allowed_surfaces text[];
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    return jsonb_build_object(
      'isSuperAdmin', false,
      'isScopedAdmin', false,
      'canAccessAdmin', false,
      'allowedSurfaces', '[]'::jsonb,
      'scopedMachineIds', '[]'::jsonb
    );
  end if;

  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(actor_user_id), '{}'::uuid[]);
  actor_is_scoped_admin := coalesce(array_length(actor_machine_ids, 1), 0) > 0;
  actor_is_refund_manager := public.user_is_refund_manager(actor_user_id);

  if actor_is_super_admin then
    allowed_surfaces := array['*'];
  else
    allowed_surfaces := '{}'::text[];

    if actor_is_scoped_admin then
      allowed_surfaces := allowed_surfaces || array['access', 'reporting_access', 'refunds'];
    end if;

    if actor_is_refund_manager then
      allowed_surfaces := allowed_surfaces || array['refunds'];
    end if;
  end if;

  return jsonb_build_object(
    'isSuperAdmin', actor_is_super_admin,
    'isScopedAdmin', actor_is_scoped_admin,
    'canAccessAdmin', actor_is_super_admin or actor_is_scoped_admin or actor_is_refund_manager,
    'allowedSurfaces', to_jsonb(array(
      select distinct surface
      from unnest(allowed_surfaces) as surface
    )),
    'scopedMachineIds', to_jsonb(actor_machine_ids)
  );
end;
$$;

create or replace function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_admin boolean;
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_admin := public.is_super_admin(actor_user_id)
    or public.is_scoped_admin(actor_user_id)
    or public.user_is_refund_manager(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_admin then
    raise exception 'Refund operations access required';
  end if;

  select jsonb_build_object(
    'cases', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', refund_case.id,
          'publicReference', refund_case.public_reference,
          'status', refund_case.status,
          'priority', refund_case.priority,
          'correlationStatus', refund_case.correlation_status,
          'correlationSource', refund_case.correlation_source,
          'correlationConfidence', refund_case.correlation_confidence,
          'correlationSummary', refund_case.correlation_summary,
          'reportingMachineId', refund_case.reporting_machine_id,
          'machineLabel', machine.machine_label,
          'reportingLocationId', refund_case.reporting_location_id,
          'locationName', location.name,
          'customerEmail', refund_case.customer_email,
          'customerName', refund_case.customer_name,
          'customerPhone', refund_case.customer_phone,
          'issueSummary', refund_case.issue_summary,
          'incidentAt', refund_case.incident_at,
          'paymentMethod', refund_case.payment_method,
          'paymentAmountCents', refund_case.payment_amount_cents,
          'cardLast4', refund_case.card_last4,
          'cardWalletUsed', refund_case.card_wallet_used,
          'matchedSalesFactId', refund_case.matched_sales_fact_id,
          'matchedNayaxTransactionId', refund_case.matched_nayax_transaction_id,
          'matchedNayaxSiteId', refund_case.matched_nayax_site_id,
          'matchedNayaxMachineAuthTime', refund_case.matched_nayax_machine_auth_time,
          'matchedNayaxAmountCents', refund_case.matched_nayax_amount_cents,
          'matchedNayaxCardLast4', refund_case.matched_nayax_card_last4,
          'matchedNayaxCurrencyCode', refund_case.matched_nayax_currency_code,
          'assignedManagerId', refund_case.assigned_manager_id,
          'assignedManagerEmail', assigned_user.email,
          'decision', refund_case.decision,
          'decisionReason', refund_case.decision_reason,
          'decidedAt', refund_case.decided_at,
          'refundAmountCents', refund_case.refund_amount_cents,
          'manualRefundReference', refund_case.manual_refund_reference,
          'reportingAdjustmentId', refund_case.reporting_adjustment_id,
          'createdAt', refund_case.created_at,
          'updatedAt', refund_case.updated_at,
          'attachments', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', attachment.id,
                'fileName', attachment.file_name,
                'contentType', attachment.content_type,
                'byteSize', attachment.byte_size,
                'storageBucket', attachment.storage_bucket,
                'storagePath', attachment.storage_path,
                'uploadedAt', attachment.uploaded_at
              )
              order by attachment.uploaded_at desc
            )
            from public.refund_case_attachments attachment
            where attachment.refund_case_id = refund_case.id
          ), '[]'::jsonb),
          'events', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', event.id,
                'eventType', event.event_type,
                'message', event.message,
                'createdAt', event.created_at
              )
              order by event.created_at desc
            )
            from public.refund_case_events event
            where event.refund_case_id = refund_case.id
          ), '[]'::jsonb),
          'messages', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', message.id,
                'messageType', message.message_type,
                'status', message.status,
                'recipientEmail', message.recipient_email,
                'subject', message.subject,
                'body', message.body,
                'sentAt', message.sent_at,
                'errorMessage', message.error_message,
                'createdAt', message.created_at
              )
              order by message.created_at desc
            )
            from public.refund_case_messages message
            where message.refund_case_id = refund_case.id
          ), '[]'::jsonb)
        )
        order by refund_case.created_at desc
      )
      from public.refund_cases refund_case
      join public.reporting_machines machine on machine.id = refund_case.reporting_machine_id
      join public.reporting_locations location on location.id = refund_case.reporting_location_id
      left join auth.users assigned_user on assigned_user.id = refund_case.assigned_manager_id
      where public.can_manage_refund_case(actor_user_id, refund_case.id)
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', machine.id,
          'machineLabel', machine.machine_label,
          'machineType', machine.machine_type,
          'sunzeMachineId', machine.sunze_machine_id,
          'nayaxLookupConfigured', machine.nayax_machine_id is not null and btrim(machine.nayax_machine_id) <> '',
          'status', machine.status,
          'locationId', location.id,
          'locationName', location.name,
          'accountId', account.id,
          'accountName', account.name
        )
        order by location.name, machine.machine_label
      )
      from public.reporting_machines machine
      join public.reporting_locations location on location.id = machine.location_id
      join public.customer_accounts account on account.id = machine.account_id
      where machine.status = 'active'
        and public.can_manage_refund_machine(actor_user_id, machine.id)
    ), '[]'::jsonb),
    'managerAssignments', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', manager.id,
          'reportingMachineId', manager.reporting_machine_id,
          'machineLabel', machine.machine_label,
          'managerUserId', manager.manager_user_id,
          'managerEmail', manager.manager_email,
          'status', manager.status,
          'grantReason', manager.grant_reason,
          'createdAt', manager.created_at
        )
        order by machine.machine_label, manager.manager_email
      )
      from public.reporting_machine_refund_managers manager
      join public.reporting_machines machine on machine.id = manager.reporting_machine_id
      where manager.status = 'active'
        and manager.revoked_at is null
        and public.can_manage_refund_machine(actor_user_id, manager.reporting_machine_id)
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

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

  if not actor_is_super_admin and not (p_machine_id = any(actor_machine_ids)) then
    raise exception 'Scoped admin access does not include this machine';
  end if;

  if p_machine_id is null then
    raise exception 'Machine is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Reason is required';
  end if;

  select coalesce(array_agg(distinct normalized.entry), '{}'::text[])
  into manager_emails
  from (
    select lower(trim(entry)) as entry
    from unnest(coalesce(p_manager_emails, '{}'::text[])) as entry
    where trim(entry) <> ''
  ) normalized;

  if coalesce(array_length(manager_emails, 1), 0) > 3 then
    raise exception 'Each machine can have at most 3 active refund managers';
  end if;

  if not exists (
    select 1
    from public.reporting_machines machine
    where machine.id = p_machine_id
  ) then
    raise exception 'Machine not found';
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
      raise exception 'Refund manager % must be an authenticated user', normalized_email;
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
      'actor_authority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return jsonb_build_object('managerAssignments', after_rows);
end;
$$;

create or replace function public.admin_set_reporting_machine_nayax_config(
  p_machine_id uuid,
  p_nayax_machine_id text,
  p_nayax_account_key text default 'TGPACI_USA_DB',
  p_reason text default 'Refund operations Nayax lookup setup'
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  actor_is_scoped_admin boolean;
  before_row public.reporting_machines;
  after_row public.reporting_machines;
  normalized_machine_id text;
  normalized_account_key text;
  normalized_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);
  actor_is_scoped_admin := public.is_scoped_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not actor_is_scoped_admin then
    raise exception 'Scoped Admin or Super Admin access required';
  end if;

  if not public.can_manage_refund_machine(actor_user_id, p_machine_id) then
    raise exception 'Machine access required';
  end if;

  normalized_machine_id := nullif(trim(coalesce(p_nayax_machine_id, '')), '');
  normalized_account_key := nullif(upper(trim(coalesce(p_nayax_account_key, ''))), '');

  if normalized_machine_id is not null
    and normalized_machine_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{1,119}$' then
    raise exception 'Nayax machine ID format is invalid';
  end if;

  if normalized_account_key is not null
    and normalized_account_key !~ '^[A-Za-z0-9][A-Za-z0-9_:-]{1,79}$' then
    raise exception 'Nayax account key format is invalid';
  end if;

  if normalized_machine_id is not null and normalized_account_key is null then
    normalized_account_key := 'TGPACI_USA_DB';
  end if;

  if normalized_reason is null then
    raise exception 'Nayax setup changes require a reason';
  end if;

  select *
  into before_row
  from public.reporting_machines machine
  where machine.id = p_machine_id
  for update;

  if before_row.id is null then
    raise exception 'Reporting machine not found';
  end if;

  update public.reporting_machines
  set
    nayax_machine_id = normalized_machine_id,
    nayax_account_key = case
      when normalized_machine_id is null then null
      else normalized_account_key
    end
  where id = before_row.id
  returning * into after_row;

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
    'reporting_machine.nayax_config.set',
    'reporting_machine',
    before_row.id::text,
    jsonb_build_object(
      'had_nayax_machine_id', before_row.nayax_machine_id is not null and btrim(before_row.nayax_machine_id) <> '',
      'had_nayax_account_key', before_row.nayax_account_key is not null and btrim(before_row.nayax_account_key) <> ''
    ),
    jsonb_build_object(
      'has_nayax_machine_id', after_row.nayax_machine_id is not null and btrim(after_row.nayax_machine_id) <> '',
      'has_nayax_account_key', after_row.nayax_account_key is not null and btrim(after_row.nayax_account_key) <> ''
    ),
    jsonb_build_object(
      'reason', normalized_reason,
      'actor_authority', case when actor_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return jsonb_build_object(
    'machine', jsonb_build_object(
      'id', after_row.id,
      'machineLabel', after_row.machine_label,
      'nayaxLookupConfigured', after_row.nayax_machine_id is not null and btrim(after_row.nayax_machine_id) <> ''
    )
  );
end;
$$;

drop function if exists public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, text, integer, timestamp with time zone, integer, text, text);

create or replace function public.admin_update_refund_case(
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
declare
  actor_user_id uuid;
  before_row public.refund_cases;
  after_row public.refund_cases;
  normalized_status text;
  normalized_decision text;
  supplied_decision text;
  normalized_assigned_email text;
  target_manager_id uuid;
  event_message text;
  adjustment_row public.sales_adjustment_facts;
  normalized_nayax_transaction_id text;
  normalized_nayax_site_id integer;
  normalized_nayax_machine_auth_time timestamptz;
  normalized_nayax_amount_cents integer;
  normalized_nayax_card_last4 text;
  normalized_nayax_currency_code text;
begin
  actor_user_id := auth.uid();

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into before_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id
  for update;

  if before_row.id is null then
    raise exception 'Refund case not found';
  end if;

  if not public.can_manage_refund_case(actor_user_id, before_row.id) then
    raise exception 'Refund case access required';
  end if;

  normalized_status := lower(trim(coalesce(p_status, before_row.status)));
  if normalized_status not in (
    'submitted',
    'needs_review',
    'waiting_on_customer',
    'correlated',
    'approved',
    'denied',
    'card_refund_pending',
    'cash_zelle_pending',
    'completed'
  ) then
    raise exception 'Invalid refund case status: %', p_status;
  end if;

  supplied_decision := nullif(lower(trim(coalesce(p_decision, ''))), '');
  if supplied_decision = 'approve' then
    supplied_decision := 'approved';
  end if;
  if supplied_decision = 'deny' then
    supplied_decision := 'denied';
  end if;

  normalized_decision := coalesce(supplied_decision, before_row.decision);
  if normalized_decision = 'approve' then
    normalized_decision := 'approved';
  end if;
  if normalized_decision = 'deny' then
    normalized_decision := 'denied';
  end if;
  if normalized_decision is not null and normalized_decision not in ('approved', 'denied') then
    raise exception 'Invalid refund decision: %', p_decision;
  end if;

  if p_clear_nayax_match then
    normalized_status := 'needs_review';
    normalized_decision := null;
    supplied_decision := null;
  end if;

  if normalized_status in ('submitted', 'needs_review', 'waiting_on_customer', 'correlated') then
    normalized_decision := null;
  elsif normalized_status in ('approved', 'card_refund_pending', 'cash_zelle_pending', 'completed') then
    if supplied_decision is not null and supplied_decision <> 'approved' then
      raise exception 'Refund status % requires an approved decision', normalized_status;
    end if;
    normalized_decision := 'approved';
  elsif normalized_status = 'denied' then
    if supplied_decision is not null and supplied_decision <> 'denied' then
      raise exception 'Denied refund cases require a denied decision';
    end if;
    normalized_decision := 'denied';
  end if;

  if normalized_decision = 'denied'
    and nullif(trim(coalesce(p_decision_reason, before_row.decision_reason, '')), '') is null then
    raise exception 'Denied refund cases require a friendly decision reason';
  end if;

  normalized_assigned_email := lower(trim(coalesce(p_assigned_manager_email, '')));
  if normalized_assigned_email = '' then
    target_manager_id := null;
  else
    select manager.manager_user_id
    into target_manager_id
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = before_row.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and lower(manager.manager_email) = normalized_assigned_email
    limit 1;

    if target_manager_id is null then
      raise exception 'Assigned manager must be active on this machine';
    end if;
  end if;

  if coalesce(p_refund_amount_cents, before_row.refund_amount_cents, before_row.payment_amount_cents, 0) < 0 then
    raise exception 'Refund amount must be zero or greater';
  end if;

  if p_clear_nayax_match then
    normalized_nayax_transaction_id := null;
    normalized_nayax_site_id := null;
    normalized_nayax_machine_auth_time := null;
    normalized_nayax_amount_cents := null;
    normalized_nayax_card_last4 := null;
    normalized_nayax_currency_code := null;
  else
    normalized_nayax_transaction_id := nullif(
      trim(coalesce(p_matched_nayax_transaction_id, before_row.matched_nayax_transaction_id, '')),
      ''
    );
    normalized_nayax_site_id := case
      when normalized_nayax_transaction_id is null then null
      else coalesce(p_matched_nayax_site_id, before_row.matched_nayax_site_id)
    end;
    normalized_nayax_machine_auth_time := case
      when normalized_nayax_transaction_id is null then null
      else coalesce(p_matched_nayax_machine_auth_time, before_row.matched_nayax_machine_auth_time)
    end;
    normalized_nayax_amount_cents := case
      when normalized_nayax_transaction_id is null then null
      else coalesce(p_matched_nayax_amount_cents, before_row.matched_nayax_amount_cents)
    end;
    normalized_nayax_card_last4 := case
      when normalized_nayax_transaction_id is null then null
      else nullif(trim(coalesce(p_matched_nayax_card_last4, before_row.matched_nayax_card_last4, '')), '')
    end;
    normalized_nayax_currency_code := case
      when normalized_nayax_transaction_id is null then null
      else nullif(upper(trim(coalesce(p_matched_nayax_currency_code, before_row.matched_nayax_currency_code, ''))), '')
    end;
  end if;

  if not p_clear_nayax_match and p_matched_nayax_transaction_id is not null then
    if normalized_nayax_transaction_id is not null
      and not public.is_review_safe_nayax_transaction_reference(normalized_nayax_transaction_id) then
      raise exception 'Nayax transaction reference does not meet review-safe format requirements';
    end if;

    if normalized_nayax_transaction_id is not null
      and before_row.payment_method <> 'card' then
      raise exception 'Nayax transaction correlation is only available for card refund cases';
    end if;

    if normalized_nayax_transaction_id is not null
      and (
        before_row.card_last4 is null
        or coalesce(before_row.payment_amount_cents, p_refund_amount_cents, before_row.refund_amount_cents, 0) <= 0
      ) then
      raise exception 'Nayax transaction correlation requires card last4 and a positive payment amount';
    end if;
  end if;

  if normalized_nayax_site_id is not null and normalized_nayax_site_id < 0 then
    raise exception 'Nayax site ID must be zero or greater';
  end if;

  if normalized_nayax_amount_cents is not null and normalized_nayax_amount_cents < 0 then
    raise exception 'Nayax matched amount must be zero or greater';
  end if;

  if normalized_nayax_card_last4 is not null
    and normalized_nayax_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'Nayax matched card last4 must be 4 digits';
  end if;

  if normalized_nayax_currency_code is not null
    and normalized_nayax_currency_code !~ '^[A-Z]{3}$' then
    raise exception 'Nayax matched currency code must be ISO-4217 style';
  end if;

  if (before_row.status = 'completed' or before_row.reporting_adjustment_id is not null)
    and (
      normalized_status <> 'completed'
      or normalized_decision <> 'approved'
    ) then
    raise exception 'Completed refund cases cannot move away from completed/approved through this RPC';
  end if;

  update public.refund_cases
  set
    status = normalized_status,
    assigned_manager_id = target_manager_id,
    decision = normalized_decision,
    decision_reason = case
      when normalized_decision is null then null
      else nullif(trim(coalesce(p_decision_reason, decision_reason, '')), '')
    end,
    decided_by = case
      when normalized_decision is null then null
      when normalized_decision is distinct from before_row.decision then actor_user_id
      else decided_by
    end,
    decided_at = case
      when normalized_decision is null then null
      when normalized_decision is distinct from before_row.decision then now()
      else decided_at
    end,
    refund_amount_cents = coalesce(p_refund_amount_cents, refund_amount_cents),
    manual_refund_reference = nullif(trim(coalesce(p_manual_refund_reference, manual_refund_reference, '')), ''),
    matched_nayax_transaction_id = normalized_nayax_transaction_id,
    matched_nayax_site_id = normalized_nayax_site_id,
    matched_nayax_machine_auth_time = normalized_nayax_machine_auth_time,
    matched_nayax_amount_cents = normalized_nayax_amount_cents,
    matched_nayax_card_last4 = normalized_nayax_card_last4,
    matched_nayax_currency_code = normalized_nayax_currency_code,
    correlation_status = case
      when normalized_nayax_transaction_id is not null
        then 'matched'
      when p_clear_nayax_match and before_row.matched_sales_fact_id is null
        then 'manual_review'
      else correlation_status
    end,
    correlation_source = case
      when normalized_nayax_transaction_id is not null
        then 'nayax'
      when p_clear_nayax_match and before_row.matched_sales_fact_id is null
        then null
      else correlation_source
    end,
    correlation_confidence = case
      when normalized_nayax_transaction_id is not null
        then greatest(correlation_confidence, 0.95)
      when p_clear_nayax_match and before_row.matched_sales_fact_id is null
        then 0
      else correlation_confidence
    end,
    correlation_summary = case
      when normalized_nayax_transaction_id is not null
        then 'Manager selected sanitized Nayax transaction evidence before refund completion.'
      when p_clear_nayax_match and before_row.matched_sales_fact_id is null
        then 'Manager cleared Nayax transaction evidence for review.'
      else correlation_summary
    end,
    refund_completed_by = case when normalized_status = 'completed' then actor_user_id else refund_completed_by end,
    refund_completed_at = case when normalized_status = 'completed' then coalesce(refund_completed_at, now()) else refund_completed_at end
  where id = before_row.id
  returning * into after_row;

  if normalized_status = 'completed' then
    if after_row.decision <> 'approved' then
      raise exception 'Completed refund cases must be approved first';
    end if;

    if after_row.correlation_status <> 'matched'
      or after_row.correlation_source is null
      or (
        after_row.matched_sales_fact_id is null
        and not public.is_review_safe_nayax_transaction_reference(after_row.matched_nayax_transaction_id)
      ) then
      raise exception 'Completed refund cases must be fully correlated first';
    end if;

    if after_row.correlation_source = 'nayax'
      and (
        after_row.payment_method <> 'card'
        or after_row.card_last4 is null
        or not public.is_review_safe_nayax_transaction_reference(after_row.matched_nayax_transaction_id)
        or after_row.matched_nayax_machine_auth_time is null
        or nullif(trim(coalesce(after_row.manual_refund_reference, '')), '') is null
      ) then
      raise exception 'Completed card refund cases require reviewed Nayax correlation plus a manual refund reference';
    end if;

    if coalesce(after_row.refund_amount_cents, after_row.payment_amount_cents, 0) <= 0 then
      raise exception 'Completed refund cases require a positive refund amount';
    end if;

    if nullif(trim(coalesce(after_row.manual_refund_reference, '')), '') is null then
      raise exception 'Completed refund cases require a manual refund reference';
    end if;

    insert into public.sales_adjustment_facts (
      reporting_machine_id,
      reporting_location_id,
      adjustment_date,
      adjustment_type,
      amount_cents,
      complaint_count,
      source,
      source_row_hash,
      source_reference,
      source_row_reference,
      refund_case_id,
      match_status,
      match_confidence,
      notes,
      raw_payload
    )
    values (
      after_row.reporting_machine_id,
      after_row.reporting_location_id,
      after_row.refund_completed_at::date,
      'refund',
      coalesce(after_row.refund_amount_cents, after_row.payment_amount_cents, 0),
      1,
      'refund_case',
      after_row.id::text,
      'refund_cases',
      after_row.public_reference,
      after_row.id,
      'applied',
      greatest(after_row.correlation_confidence, 0.01),
      'Bloomjoy refund case ' || after_row.public_reference,
      jsonb_build_object(
        'refund_case_id', after_row.id,
        'refund_case_reference', after_row.public_reference,
        'refund_case_status', after_row.status,
        'refund_case_decision', after_row.decision,
        'payment_method', after_row.payment_method,
        'correlation_source', after_row.correlation_source,
        'correlation_has_sales_fact', after_row.matched_sales_fact_id is not null,
        'correlation_has_card_lookup',
          public.is_review_safe_nayax_transaction_reference(after_row.matched_nayax_transaction_id),
        'correlation_has_nayax_site_id', after_row.matched_nayax_site_id is not null,
        'correlation_has_nayax_machine_auth_time',
          after_row.matched_nayax_machine_auth_time is not null
      )
    )
    on conflict (source, source_reference, source_row_reference)
    do update set
      reporting_machine_id = excluded.reporting_machine_id,
      reporting_location_id = excluded.reporting_location_id,
      adjustment_date = excluded.adjustment_date,
      amount_cents = excluded.amount_cents,
      refund_case_id = excluded.refund_case_id,
      match_status = excluded.match_status,
      match_confidence = excluded.match_confidence,
      notes = excluded.notes,
      raw_payload = excluded.raw_payload
    returning * into adjustment_row;

    update public.refund_cases
    set reporting_adjustment_id = adjustment_row.id
    where id = after_row.id
    returning * into after_row;
  end if;

  event_message := concat_ws(
    ' ',
    'Status:', before_row.status || ' -> ' || after_row.status || '.',
    case
      when before_row.decision is distinct from after_row.decision
        then 'Decision: ' || coalesce(after_row.decision, 'none') || '.'
      else null
    end,
    nullif(trim(coalesce(p_internal_note, '')), '')
  );

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  values (
    after_row.id,
    actor_user_id,
    'admin_update',
    event_message,
    jsonb_build_object(
      'previous_status', before_row.status,
      'next_status', after_row.status,
      'previous_decision', before_row.decision,
      'next_decision', after_row.decision
    )
  );

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
    'refund_case.updated',
    'refund_case',
    after_row.id::text,
    jsonb_build_object(
      'status', before_row.status,
      'decision', before_row.decision,
      'assigned_manager_present', before_row.assigned_manager_id is not null,
      'refund_amount_cents', before_row.refund_amount_cents,
      'manual_refund_reference_present',
        nullif(trim(coalesce(before_row.manual_refund_reference, '')), '') is not null,
      'correlation_status', before_row.correlation_status,
      'correlation_source', before_row.correlation_source,
      'correlation_confidence', before_row.correlation_confidence,
      'matched_sales_fact_present', before_row.matched_sales_fact_id is not null,
      'matched_nayax_transaction_present',
        public.is_review_safe_nayax_transaction_reference(before_row.matched_nayax_transaction_id),
      'matched_nayax_site_id_present', before_row.matched_nayax_site_id is not null,
      'matched_nayax_machine_auth_time_present', before_row.matched_nayax_machine_auth_time is not null,
      'reporting_adjustment_present', before_row.reporting_adjustment_id is not null
    ),
    jsonb_build_object(
      'status', after_row.status,
      'decision', after_row.decision,
      'assigned_manager_present', after_row.assigned_manager_id is not null,
      'refund_amount_cents', after_row.refund_amount_cents,
      'manual_refund_reference_present',
        nullif(trim(coalesce(after_row.manual_refund_reference, '')), '') is not null,
      'correlation_status', after_row.correlation_status,
      'correlation_source', after_row.correlation_source,
      'correlation_confidence', after_row.correlation_confidence,
      'matched_sales_fact_present', after_row.matched_sales_fact_id is not null,
      'matched_nayax_transaction_present',
        public.is_review_safe_nayax_transaction_reference(after_row.matched_nayax_transaction_id),
      'matched_nayax_site_id_present', after_row.matched_nayax_site_id is not null,
      'matched_nayax_machine_auth_time_present', after_row.matched_nayax_machine_auth_time is not null,
      'reporting_adjustment_present', after_row.reporting_adjustment_id is not null
    ),
    jsonb_build_object(
      'internal_note_present', nullif(trim(coalesce(p_internal_note, '')), '') is not null,
      'audit_payload_redacted', true
    )
  );

  return to_jsonb(after_row);
end;
$$;

alter table public.reporting_machine_refund_managers enable row level security;
alter table public.refund_cases enable row level security;
alter table public.refund_case_events enable row level security;
alter table public.refund_case_messages enable row level security;
alter table public.refund_case_attachments enable row level security;

drop policy if exists "reporting_machine_refund_managers_select_accessible"
  on public.reporting_machine_refund_managers;
create policy "reporting_machine_refund_managers_select_accessible"
on public.reporting_machine_refund_managers
for select
using (
  manager_user_id = (select auth.uid())
  or public.can_manage_refund_machine_current_user(reporting_machine_id)
);

drop policy if exists "refund_cases_select_accessible" on public.refund_cases;
create policy "refund_cases_select_accessible"
on public.refund_cases
for select
using (public.can_manage_refund_case_current_user(id));

drop policy if exists "refund_cases_update_accessible" on public.refund_cases;

revoke update on public.refund_cases from anon, authenticated;

drop policy if exists "refund_case_events_select_accessible" on public.refund_case_events;
create policy "refund_case_events_select_accessible"
on public.refund_case_events
for select
using (public.can_manage_refund_case_current_user(refund_case_id));

drop policy if exists "refund_case_messages_select_accessible" on public.refund_case_messages;
create policy "refund_case_messages_select_accessible"
on public.refund_case_messages
for select
using (public.can_manage_refund_case_current_user(refund_case_id));

drop policy if exists "refund_case_attachments_select_accessible" on public.refund_case_attachments;
create policy "refund_case_attachments_select_accessible"
on public.refund_case_attachments
for select
using (public.can_manage_refund_case_current_user(refund_case_id));

drop policy if exists "refund_case_attachment_objects_read_accessible" on storage.objects;
create policy "refund_case_attachment_objects_read_accessible"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'refund-case-attachments'
  and exists (
    select 1
    from public.refund_case_attachments attachment
    where attachment.storage_bucket = bucket_id
      and attachment.storage_path = name
      and public.can_manage_refund_case_current_user(attachment.refund_case_id)
  )
);

comment on table public.refund_cases is
  'Bloomjoy-hosted refund inquiry cases. Customer PII stays in this operational table and only approved/completed correlated cases write settlement adjustments.';
comment on table public.reporting_machine_refund_managers is
  'Authenticated manager assignments for refund operations; each machine is limited to 3 active managers.';
comment on function public.public_refund_machine_options() is
  'Public noindex refund intake machine/location selector. Exposes only active reporting machine labels and locations.';
comment on function public.can_manage_refund_machine_current_user(uuid) is
  'RLS helper for current-user refund machine access checks without exposing arbitrary user-id checks to browser callers.';
comment on function public.can_manage_refund_case_current_user(uuid) is
  'RLS helper for current-user refund case access checks without exposing arbitrary user-id checks to browser callers.';
comment on function public.admin_get_refund_operations_overview() is
  'Refund operations queue for Super Admins, Scoped Admins inside scope, and active machine refund managers.';
comment on function public.admin_set_reporting_machine_nayax_config(uuid, text, text, text) is
  'Admin RPC for mapping a Bloomjoy reporting machine to its server-side Nayax Lynx machine identifier.';

revoke execute on function public.user_is_refund_manager(uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_refund_machine(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_refund_case(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_manage_refund_machine_current_user(uuid) from public, anon;
revoke execute on function public.can_manage_refund_case_current_user(uuid) from public, anon;
revoke execute on function public.is_review_safe_nayax_transaction_reference(text) from public, anon, authenticated;
revoke execute on function public.admin_set_reporting_machine_refund_managers(uuid, text[], text)
  from public, anon, authenticated;
revoke execute on function public.admin_set_reporting_machine_nayax_config(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)
  from public, anon, authenticated;

grant execute on function public.user_is_refund_manager(uuid) to service_role;
grant execute on function public.can_manage_refund_machine(uuid, uuid) to service_role;
grant execute on function public.can_manage_refund_case(uuid, uuid) to service_role;
grant execute on function public.can_manage_refund_machine_current_user(uuid) to authenticated;
grant execute on function public.can_manage_refund_case_current_user(uuid) to authenticated;
grant execute on function public.is_review_safe_nayax_transaction_reference(text) to service_role;
grant execute on function public.public_refund_machine_options() to anon, authenticated;
grant execute on function public.get_my_admin_access_context() to authenticated;
grant execute on function public.admin_get_refund_operations_overview() to authenticated;
grant execute on function public.admin_set_reporting_machine_refund_managers(uuid, text[], text)
  to authenticated;
grant execute on function public.admin_set_reporting_machine_nayax_config(uuid, text, text, text)
  to authenticated;
grant execute on function public.admin_update_refund_case(uuid, text, text, text, text, text, integer, text, boolean, text, integer, timestamp with time zone, integer, text, text)
  to authenticated;

select pg_notify('pgrst', 'reload schema');
