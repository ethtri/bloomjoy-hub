-- Conservative website-form / designated-Gmail duplicate reconciliation.
--
-- Source-specific replay keys remain authoritative. This adds a PII-minimized
-- review record for likely cross-source duplicates and blocks every official
-- action boundary until a mapped manager resolves the pair. It enables no
-- payment provider and performs no refund.

alter table public.refund_cases
  add column if not exists duplicate_of_refund_case_id uuid,
  add column if not exists duplicate_marked_at timestamptz,
  add column if not exists duplicate_marked_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'refund_cases_duplicate_of_fkey'
      and conrelid = 'public.refund_cases'::regclass
  ) then
    alter table public.refund_cases
      add constraint refund_cases_duplicate_of_fkey
      foreign key (duplicate_of_refund_case_id)
      references public.refund_cases (id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'refund_cases_duplicate_marked_by_fkey'
      and conrelid = 'public.refund_cases'::regclass
  ) then
    alter table public.refund_cases
      add constraint refund_cases_duplicate_marked_by_fkey
      foreign key (duplicate_marked_by)
      references auth.users (id) on delete set null;
  end if;
end;
$$;

alter table public.refund_cases
  drop constraint if exists refund_cases_duplicate_not_self;
alter table public.refund_cases
  add constraint refund_cases_duplicate_not_self check (
    duplicate_of_refund_case_id is null or duplicate_of_refund_case_id <> id
  );

create index if not exists refund_cases_duplicate_of_idx
  on public.refund_cases (duplicate_of_refund_case_id)
  where duplicate_of_refund_case_id is not null;

create table if not exists public.refund_case_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  left_refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  right_refund_case_id uuid not null
    references public.refund_cases (id) on delete cascade,
  match_class text not null check (match_class in ('exact', 'possible')),
  status text not null default 'pending' check (
    status in ('pending', 'confirmed_duplicate', 'confirmed_distinct', 'superseded')
  ),
  reason_codes text[] not null default '{}',
  policy_version text not null default '2026-08-05.email.v1',
  left_fact_fingerprint text not null,
  right_fact_fingerprint text not null,
  canonical_refund_case_id uuid
    references public.refund_cases (id) on delete restrict,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_case_reconciliation_ordered_pair check (
    left_refund_case_id < right_refund_case_id
  ),
  constraint refund_case_reconciliation_pair_unique unique (
    left_refund_case_id,
    right_refund_case_id
  ),
  constraint refund_case_reconciliation_canonical_member check (
    canonical_refund_case_id is null
    or canonical_refund_case_id in (left_refund_case_id, right_refund_case_id)
  ),
  constraint refund_case_reconciliation_resolution_shape check (
    (status = 'confirmed_duplicate' and canonical_refund_case_id is not null and resolved_at is not null)
    or (status = 'confirmed_distinct' and canonical_refund_case_id is null and resolved_at is not null)
    or (status in ('pending', 'superseded') and canonical_refund_case_id is null)
  ),
  constraint refund_case_reconciliation_reason_codes_safe check (
    reason_codes <@ array[
      'customer_email_exact',
      'machine_exact',
      'incident_within_15_minutes',
      'incident_within_6_hours',
      'amount_exact',
      'payment_method_exact',
      'card_last4_exact',
      'wallet_state_exact'
    ]::text[]
  ),
  constraint refund_case_reconciliation_resolution_reason_safe check (
    resolution_reason_code is null or resolution_reason_code in (
      'same_incident',
      'source_replay',
      'customer_confirmed',
      'different_purchase',
      'incorrect_match'
    )
  ),
  constraint refund_case_reconciliation_fact_fingerprints_safe check (
    left_fact_fingerprint ~ '^[a-f0-9]{64}$'
    and right_fact_fingerprint ~ '^[a-f0-9]{64}$'
  )
);

create index if not exists refund_case_reconciliation_left_pending_idx
  on public.refund_case_reconciliation_reviews (left_refund_case_id, created_at)
  where status = 'pending';
create index if not exists refund_case_reconciliation_right_pending_idx
  on public.refund_case_reconciliation_reviews (right_refund_case_id, created_at)
  where status = 'pending';

drop trigger if exists refund_case_reconciliation_reviews_set_updated_at
  on public.refund_case_reconciliation_reviews;
create trigger refund_case_reconciliation_reviews_set_updated_at
before update on public.refund_case_reconciliation_reviews
for each row execute function public.set_updated_at();

alter table public.refund_case_reconciliation_reviews enable row level security;
revoke all on table public.refund_case_reconciliation_reviews
  from public, anon, authenticated;
grant select, insert, update on table public.refund_case_reconciliation_reviews
  to service_role;

comment on table public.refund_case_reconciliation_reviews is
  'PII-free comparison outcomes for possible website-form / Gmail duplicate refund cases.';

create or replace function public.refund_case_has_unresolved_reconciliation(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.refund_case_reconciliation_reviews review
    where review.status = 'pending'
      and p_refund_case_id in (
        review.left_refund_case_id,
        review.right_refund_case_id
      )
  );
$$;

create or replace function public.refund_case_has_official_action(
  p_refund_case_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.refund_cases refund_case
    where refund_case.id = p_refund_case_id
      and (
        refund_case.reporting_adjustment_id is not null
        or refund_case.refund_completed_at is not null
        or refund_case.status = 'completed'
        or exists (
          select 1
          from public.refund_case_nayax_refund_attempts attempt
          where attempt.refund_case_id = refund_case.id
            and attempt.status in (
              'in_progress', 'requested', 'approved', 'succeeded', 'ambiguous'
            )
        )
      )
  );
$$;

create or replace function public.refund_reconciliation_scope_lock_key(
  p_customer_email text,
  p_reporting_machine_id uuid
)
returns bigint
language sql
immutable
strict
set search_path = public
as $$
  select hashtextextended(
    'refund-email-reconciliation:' || lower(btrim(p_customer_email)) || ':'
      || p_reporting_machine_id::text,
    0
  );
$$;

create or replace function public.refund_reconciliation_fact_fingerprint(
  p_customer_email text,
  p_reporting_machine_id uuid,
  p_incident_at timestamptz,
  p_payment_method text,
  p_payment_amount_cents integer,
  p_card_last4 text,
  p_card_wallet_used boolean
)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select encode(digest(concat_ws('|',
    lower(btrim(coalesce(p_customer_email, ''))),
    coalesce(p_reporting_machine_id::text, ''),
    coalesce(extract(epoch from p_incident_at)::text, ''),
    coalesce(p_payment_method, ''),
    coalesce(p_payment_amount_cents::text, ''),
    coalesce(p_card_last4, ''),
    coalesce(p_card_wallet_used::text, '')
  ), 'sha256'), 'hex');
$$;

create or replace function public.lock_refund_case_reconciliation_scope(
  p_refund_case_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  scope_key bigint;
begin
  select public.refund_reconciliation_scope_lock_key(
    refund_case.customer_email,
    refund_case.reporting_machine_id
  ) into scope_key
  from public.refund_cases refund_case
  where refund_case.id = p_refund_case_id
    and nullif(lower(btrim(coalesce(refund_case.customer_email, ''))), '') is not null
    and refund_case.reporting_machine_id is not null;

  if scope_key is not null then
    perform pg_advisory_xact_lock(scope_key);
  end if;
end;
$$;

create or replace function public.reconcile_refund_email_case_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_ids uuid[] := '{}';
  new_scope_key bigint;
  old_scope_key bigint;
begin
  if nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is not null
    and new.reporting_machine_id is not null then
    new_scope_key := public.refund_reconciliation_scope_lock_key(
      new.customer_email,
      new.reporting_machine_id
    );
  end if;
  if tg_op = 'UPDATE'
    and nullif(lower(btrim(coalesce(old.customer_email, ''))), '') is not null
    and old.reporting_machine_id is not null then
    old_scope_key := public.refund_reconciliation_scope_lock_key(
      old.customer_email,
      old.reporting_machine_id
    );
  end if;

  if old_scope_key is not null and new_scope_key is not null
    and old_scope_key <> new_scope_key then
    perform pg_advisory_xact_lock(least(old_scope_key, new_scope_key));
    perform pg_advisory_xact_lock(greatest(old_scope_key, new_scope_key));
  elsif coalesce(new_scope_key, old_scope_key) is not null then
    perform pg_advisory_xact_lock(coalesce(new_scope_key, old_scope_key));
  end if;

  if new.duplicate_of_refund_case_id is not null then
    return new;
  end if;

  if new.status = 'draft'
    or nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is null
    or new.reporting_machine_id is null
    or new.incident_at is null then
    update public.refund_case_reconciliation_reviews review
    set status = 'superseded', updated_at = now()
    where review.status in ('pending', 'confirmed_distinct')
      and new.id in (review.left_refund_case_id, review.right_refund_case_id);
    return new;
  end if;

  select coalesce(array_agg(candidate.id), '{}')
  into candidate_ids
  from public.refund_cases candidate
  where candidate.id <> new.id
    and candidate.status <> 'draft'
    and candidate.duplicate_of_refund_case_id is null
    and candidate.status not in ('denied', 'closed')
    and candidate.intake_source <> new.intake_source
    and candidate.intake_source in ('form', 'gmail')
    and new.intake_source in ('form', 'gmail')
    and lower(btrim(candidate.customer_email)) = lower(btrim(new.customer_email))
    and candidate.reporting_machine_id = new.reporting_machine_id
    and candidate.incident_at is not null
    and abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 21600
    and (
      candidate.payment_amount_cents = new.payment_amount_cents
      or (
        candidate.payment_method = 'card'
        and new.payment_method = 'card'
        and candidate.card_last4 is not null
        and candidate.card_last4 = new.card_last4
      )
    );

  update public.refund_case_reconciliation_reviews review
  set status = 'superseded', updated_at = now()
  where review.status = 'pending'
    and new.id in (review.left_refund_case_id, review.right_refund_case_id)
    and case
      when review.left_refund_case_id = new.id then review.right_refund_case_id
      else review.left_refund_case_id
    end <> all(candidate_ids);

  insert into public.refund_case_reconciliation_reviews (
    left_refund_case_id,
    right_refund_case_id,
    match_class,
    reason_codes,
    policy_version,
    left_fact_fingerprint,
    right_fact_fingerprint
  )
  select
    least(new.id, candidate.id),
    greatest(new.id, candidate.id),
    case
      when abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 900
        and candidate.payment_amount_cents is not null
        and candidate.payment_amount_cents = new.payment_amount_cents
        and candidate.payment_method = new.payment_method
        and candidate.card_wallet_used = new.card_wallet_used
        and (
          candidate.payment_method <> 'card'
          or (
            candidate.card_last4 is not null
            and candidate.card_last4 = new.card_last4
          )
        )
      then 'exact'
      else 'possible'
    end,
    array_remove(array[
      'customer_email_exact',
      'machine_exact',
      case
        when abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 900
          then 'incident_within_15_minutes'
        else 'incident_within_6_hours'
      end,
      case when candidate.payment_amount_cents = new.payment_amount_cents then 'amount_exact' end,
      case when candidate.payment_method = new.payment_method then 'payment_method_exact' end,
      case when candidate.card_last4 is not null and candidate.card_last4 = new.card_last4 then 'card_last4_exact' end,
      case when candidate.card_wallet_used = new.card_wallet_used then 'wallet_state_exact' end
    ]::text[], null),
    '2026-08-05.email.v1',
    case when new.id < candidate.id then
      public.refund_reconciliation_fact_fingerprint(
        new.customer_email, new.reporting_machine_id, new.incident_at,
        new.payment_method, new.payment_amount_cents, new.card_last4,
        new.card_wallet_used
      )
    else
      public.refund_reconciliation_fact_fingerprint(
        candidate.customer_email, candidate.reporting_machine_id,
        candidate.incident_at, candidate.payment_method,
        candidate.payment_amount_cents, candidate.card_last4,
        candidate.card_wallet_used
      )
    end,
    case when new.id < candidate.id then
      public.refund_reconciliation_fact_fingerprint(
        candidate.customer_email, candidate.reporting_machine_id,
        candidate.incident_at, candidate.payment_method,
        candidate.payment_amount_cents, candidate.card_last4,
        candidate.card_wallet_used
      )
    else
      public.refund_reconciliation_fact_fingerprint(
        new.customer_email, new.reporting_machine_id, new.incident_at,
        new.payment_method, new.payment_amount_cents, new.card_last4,
        new.card_wallet_used
      )
    end
  from public.refund_cases candidate
  where candidate.id = any(candidate_ids)
  on conflict (left_refund_case_id, right_refund_case_id) do update
  set
    match_class = excluded.match_class,
    reason_codes = excluded.reason_codes,
    policy_version = excluded.policy_version,
    left_fact_fingerprint = excluded.left_fact_fingerprint,
    right_fact_fingerprint = excluded.right_fact_fingerprint,
    status = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then 'pending'
      else refund_case_reconciliation_reviews.status
    end,
    canonical_refund_case_id = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.canonical_refund_case_id
    end,
    resolved_by = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolved_by
    end,
    resolved_at = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolved_at
    end,
    resolution_reason_code = case
      when refund_case_reconciliation_reviews.left_fact_fingerprint
        is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
        then null
      else refund_case_reconciliation_reviews.resolution_reason_code
    end,
    updated_at = now()
  where refund_case_reconciliation_reviews.status = 'pending'
    or (
      refund_case_reconciliation_reviews.status = 'confirmed_distinct'
      and (
        refund_case_reconciliation_reviews.left_fact_fingerprint
          is distinct from excluded.left_fact_fingerprint
        or refund_case_reconciliation_reviews.right_fact_fingerprint
          is distinct from excluded.right_fact_fingerprint
      )
    );

  return new;
end;
$$;

drop trigger if exists refund_cases_reconcile_email_candidates
  on public.refund_cases;
create trigger refund_cases_reconcile_email_candidates
after insert or update of
  reporting_machine_id,
  customer_email,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_wallet_used,
  status
on public.refund_cases
for each row execute function public.reconcile_refund_email_case_candidates();

create or replace function public.assert_refund_case_reconciliation_safe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_scope_key bigint;
  old_scope_key bigint;
begin
  if (
      new.status is distinct from old.status
      or new.decision is distinct from old.decision
      or new.refund_completed_at is distinct from old.refund_completed_at
      or new.reporting_adjustment_id is distinct from old.reporting_adjustment_id
    ) and (
      new.status in (
        'approved', 'card_refund_pending', 'cash_zelle_pending', 'completed'
      )
      or new.decision = 'approved'
      or new.refund_completed_at is not null
      or new.reporting_adjustment_id is not null
    ) then
    if (
        new.customer_email is distinct from old.customer_email
        or new.reporting_machine_id is distinct from old.reporting_machine_id
        or new.incident_at is distinct from old.incident_at
        or new.payment_method is distinct from old.payment_method
        or new.payment_amount_cents is distinct from old.payment_amount_cents
        or new.card_last4 is distinct from old.card_last4
        or new.card_wallet_used is distinct from old.card_wallet_used
      ) and exists (
        select 1
        from public.refund_cases candidate
        where candidate.id <> new.id
          and candidate.status <> 'draft'
          and candidate.duplicate_of_refund_case_id is null
          and candidate.status not in ('denied', 'closed')
          and candidate.intake_source <> new.intake_source
          and candidate.intake_source in ('form', 'gmail')
          and new.intake_source in ('form', 'gmail')
          and lower(btrim(candidate.customer_email)) = lower(btrim(new.customer_email))
          and candidate.reporting_machine_id = new.reporting_machine_id
          and candidate.incident_at is not null
          and new.incident_at is not null
          and abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 21600
          and (
            candidate.payment_amount_cents = new.payment_amount_cents
            or (
              candidate.payment_method = 'card'
              and new.payment_method = 'card'
              and candidate.card_last4 is not null
              and candidate.card_last4 = new.card_last4
            )
          )
      ) then
      raise exception 'Save changed refund facts and reconcile duplicates before taking an official action';
    end if;

    if nullif(lower(btrim(coalesce(old.customer_email, ''))), '') is not null
      and old.reporting_machine_id is not null then
      old_scope_key := public.refund_reconciliation_scope_lock_key(
        old.customer_email,
        old.reporting_machine_id
      );
    end if;
    if nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is not null
      and new.reporting_machine_id is not null then
      new_scope_key := public.refund_reconciliation_scope_lock_key(
        new.customer_email,
        new.reporting_machine_id
      );
    end if;
    if old_scope_key is not null and new_scope_key is not null
      and old_scope_key <> new_scope_key then
      perform pg_advisory_xact_lock(least(old_scope_key, new_scope_key));
      perform pg_advisory_xact_lock(greatest(old_scope_key, new_scope_key));
    elsif coalesce(new_scope_key, old_scope_key) is not null then
      perform pg_advisory_xact_lock(coalesce(new_scope_key, old_scope_key));
    end if;

    if new.duplicate_of_refund_case_id is not null then
      raise exception 'Official refund actions are blocked for a confirmed duplicate case';
    end if;
    if public.refund_case_has_unresolved_reconciliation(new.id) then
      raise exception 'Resolve possible duplicate refund cases before taking an official action';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_cases_reconciliation_action_guard
  on public.refund_cases;
create trigger refund_cases_reconciliation_action_guard
before update on public.refund_cases
for each row execute function public.assert_refund_case_reconciliation_safe();

create or replace function public.assert_refund_case_nayax_reconciliation_safe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.execution_mode <> 'preflight'
    or new.status in (
      'in_progress', 'requested', 'approved', 'succeeded', 'ambiguous'
    ) then
    perform public.lock_refund_case_reconciliation_scope(new.refund_case_id);
    if exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id
        and (
          refund_case.duplicate_of_refund_case_id is not null
          or public.refund_case_has_unresolved_reconciliation(refund_case.id)
        )
    ) then
      raise exception 'Resolve possible duplicate refund cases before provider execution';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists refund_case_nayax_reconciliation_guard
  on public.refund_case_nayax_refund_attempts;
create trigger refund_case_nayax_reconciliation_guard
before insert or update on public.refund_case_nayax_refund_attempts
for each row execute function public.assert_refund_case_nayax_reconciliation_safe();

create or replace function public.assert_refund_adjustment_reconciliation_safe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.refund_case_id is not null
    and (new.source = 'refund_case' or new.match_status = 'applied') then
    perform public.lock_refund_case_reconciliation_scope(new.refund_case_id);
    if exists (
      select 1
      from public.refund_cases refund_case
      where refund_case.id = new.refund_case_id
        and (
          refund_case.duplicate_of_refund_case_id is not null
          or public.refund_case_has_unresolved_reconciliation(refund_case.id)
        )
    ) then
      raise exception 'Resolve possible duplicate refund cases before settlement';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_adjustment_refund_reconciliation_guard
  on public.sales_adjustment_facts;
create trigger sales_adjustment_refund_reconciliation_guard
before insert or update on public.sales_adjustment_facts
for each row execute function public.assert_refund_adjustment_reconciliation_safe();

-- Preserve PR #701's stricter manager-only authority while adding duplicate
-- readiness to every step-up and provider predicate that delegates here.
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
    and not exists (
      select 1
      from public.admin_roles admin_role
      where admin_role.user_id = p_user_id
        and admin_role.active = true
    )
    and not exists (
      select 1
      from public.admin_scoped_access_grants admin_grant
      where admin_grant.user_id = p_user_id
        and public.admin_scoped_grant_is_active(
          admin_grant.starts_at,
          admin_grant.expires_at,
          admin_grant.revoked_at
        )
    )
    and exists (
      select 1
      from public.refund_cases refund_case
      join public.reporting_machine_refund_managers manager
        on manager.reporting_machine_id = refund_case.reporting_machine_id
      where refund_case.id = p_refund_case_id
        and refund_case.duplicate_of_refund_case_id is null
        and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
        and manager.manager_user_id = p_user_id
        and manager.status = 'active'
        and manager.revoked_at is null
    );
$$;

create or replace function public.admin_get_refund_case_reconciliation(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  result jsonb;
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if not public.can_manage_refund_case(actor_user_id, p_refund_case_id) then
    raise exception 'Refund case access required';
  end if;

  select jsonb_build_object(
    'caseId', refund_case.id,
    'duplicateOfCaseId', refund_case.duplicate_of_refund_case_id,
    'duplicateOfPublicReference', canonical_case.public_reference,
    'actionBlocked', refund_case.duplicate_of_refund_case_id is not null
      or public.refund_case_has_unresolved_reconciliation(refund_case.id),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', review.id,
        'status', review.status,
        'matchClass', review.match_class,
        'reasonCodes', to_jsonb(review.reason_codes),
        'policyVersion', review.policy_version,
        'otherCaseId', other_case.id,
        'otherPublicReference', other_case.public_reference,
        'otherIntakeSource', other_case.intake_source,
        'otherStatus', other_case.status,
        'canonicalCaseId', review.canonical_refund_case_id,
        'resolutionReasonCode', review.resolution_reason_code,
        'createdAt', review.created_at,
        'resolvedAt', review.resolved_at
      ) order by
        case review.status when 'pending' then 0 else 1 end,
        review.created_at desc)
      from public.refund_case_reconciliation_reviews review
      join public.refund_cases other_case
        on other_case.id = case
          when review.left_refund_case_id = refund_case.id
            then review.right_refund_case_id
          else review.left_refund_case_id
        end
      where refund_case.id in (
        review.left_refund_case_id,
        review.right_refund_case_id
      )
        and review.status <> 'superseded'
        and public.can_manage_refund_case(actor_user_id, other_case.id)
    ), '[]'::jsonb)
  ) into result
  from public.refund_cases refund_case
  left join public.refund_cases canonical_case
    on canonical_case.id = refund_case.duplicate_of_refund_case_id
  where refund_case.id = p_refund_case_id;

  if result is null then
    raise exception 'Refund case not found';
  end if;
  return result;
end;
$$;

create or replace function public.admin_resolve_refund_case_reconciliation(
  p_review_id uuid,
  p_resolution text,
  p_canonical_refund_case_id uuid default null,
  p_reason_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
  review_row public.refund_case_reconciliation_reviews;
  duplicate_case_id uuid;
  scope_key bigint;
  normalized_resolution text := lower(btrim(coalesce(p_resolution, '')));
  normalized_reason text := lower(btrim(coalesce(p_reason_code, '')));
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  if normalized_resolution not in ('duplicate', 'distinct') then
    raise exception 'Resolution must be duplicate or distinct';
  end if;
  if normalized_reason not in (
    'same_incident', 'source_replay', 'customer_confirmed',
    'different_purchase', 'incorrect_match'
  ) then
    raise exception 'A supported resolution reason is required';
  end if;

  select * into review_row
  from public.refund_case_reconciliation_reviews
  where id = p_review_id;

  if review_row.id is null or review_row.status <> 'pending' then
    raise exception 'A pending reconciliation review is required';
  end if;
  if not public.can_manage_refund_case(
      actor_user_id,
      review_row.left_refund_case_id
    ) or not public.can_manage_refund_case(
      actor_user_id,
      review_row.right_refund_case_id
    ) then
    raise exception 'Refund case access required';
  end if;

  for scope_key in
    select distinct public.refund_reconciliation_scope_lock_key(
      refund_case.customer_email,
      refund_case.reporting_machine_id
    )
    from public.refund_cases refund_case
    where refund_case.id in (
      review_row.left_refund_case_id,
      review_row.right_refund_case_id
    )
      and nullif(lower(btrim(coalesce(refund_case.customer_email, ''))), '') is not null
      and refund_case.reporting_machine_id is not null
    order by 1
  loop
    perform pg_advisory_xact_lock(scope_key);
  end loop;

  select * into review_row
  from public.refund_case_reconciliation_reviews
  where id = p_review_id
  for update;

  if review_row.id is null or review_row.status <> 'pending' then
    raise exception 'A pending reconciliation review is required';
  end if;

  perform 1
  from public.refund_cases
  where id in (review_row.left_refund_case_id, review_row.right_refund_case_id)
  order by id
  for update;

  if normalized_resolution = 'duplicate' then
    if p_canonical_refund_case_id not in (
      review_row.left_refund_case_id,
      review_row.right_refund_case_id
    ) then
      raise exception 'Canonical case must be one of the reviewed cases';
    end if;
    duplicate_case_id := case
      when p_canonical_refund_case_id = review_row.left_refund_case_id
        then review_row.right_refund_case_id
      else review_row.left_refund_case_id
    end;
    if public.refund_case_has_official_action(duplicate_case_id) then
      raise exception 'A case with an official refund action cannot be marked duplicate';
    end if;
    if exists (
      select 1 from public.refund_cases
      where id = p_canonical_refund_case_id
        and duplicate_of_refund_case_id is not null
    ) then
      raise exception 'A duplicate case cannot become the canonical case';
    end if;

    update public.refund_cases
    set
      duplicate_of_refund_case_id = p_canonical_refund_case_id,
      duplicate_marked_at = now(),
      duplicate_marked_by = actor_user_id
    where id = duplicate_case_id;

    update public.refund_case_reconciliation_reviews
    set
      status = 'confirmed_duplicate',
      canonical_refund_case_id = p_canonical_refund_case_id,
      resolved_by = actor_user_id,
      resolved_at = now(),
      resolution_reason_code = normalized_reason,
      updated_at = now()
    where id = review_row.id;
  else
    update public.refund_case_reconciliation_reviews
    set
      status = 'confirmed_distinct',
      canonical_refund_case_id = null,
      resolved_by = actor_user_id,
      resolved_at = now(),
      resolution_reason_code = normalized_reason,
      updated_at = now()
    where id = review_row.id;
  end if;

  insert into public.refund_case_events (
    refund_case_id,
    actor_user_id,
    event_type,
    message,
    metadata
  )
  select
    case_id,
    actor_user_id,
    'email_intake_reconciliation_resolved',
    case
      when normalized_resolution = 'duplicate'
        then 'A manager marked the reviewed website/email cases as the same incident.'
      else 'A manager confirmed the reviewed website/email cases are distinct incidents.'
    end,
    jsonb_build_object(
      'review_id', review_row.id,
      'resolution', normalized_resolution,
      'reason_code', normalized_reason,
      'canonical_case_id', p_canonical_refund_case_id,
      'payload_redacted', true,
      'official_action', false
    )
  from unnest(array[
    review_row.left_refund_case_id,
    review_row.right_refund_case_id
  ]) case_id;

  return public.admin_get_refund_case_reconciliation(
    review_row.left_refund_case_id
  );
end;
$$;

create or replace function public.admin_get_refund_reconciliation_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;
  return jsonb_build_object(
    'pendingReviewCount', (
      select count(*)
      from public.refund_case_reconciliation_reviews review
      where review.status = 'pending'
        and public.can_manage_refund_case(actor_user_id, review.left_refund_case_id)
        and public.can_manage_refund_case(actor_user_id, review.right_refund_case_id)
    ),
    'exactPendingCount', (
      select count(*)
      from public.refund_case_reconciliation_reviews review
      where review.status = 'pending'
        and review.match_class = 'exact'
        and public.can_manage_refund_case(actor_user_id, review.left_refund_case_id)
        and public.can_manage_refund_case(actor_user_id, review.right_refund_case_id)
    ),
    'oldestPendingAt', (
      select min(review.created_at)
      from public.refund_case_reconciliation_reviews review
      where review.status = 'pending'
        and public.can_manage_refund_case(actor_user_id, review.left_refund_case_id)
        and public.can_manage_refund_case(actor_user_id, review.right_refund_case_id)
    ),
    'confirmedDuplicateCount', (
      select count(*)
      from public.refund_case_reconciliation_reviews review
      where review.status = 'confirmed_duplicate'
        and public.can_manage_refund_case(actor_user_id, review.left_refund_case_id)
        and public.can_manage_refund_case(actor_user_id, review.right_refund_case_id)
    ),
    'payloadRedacted', true,
    'policyVersion', '2026-08-05.email.v1'
  );
end;
$$;

revoke all on function public.refund_case_has_unresolved_reconciliation(uuid)
  from public, anon, authenticated;
revoke all on function public.refund_case_has_official_action(uuid)
  from public, anon, authenticated;
revoke all on function public.refund_reconciliation_scope_lock_key(text,uuid)
  from public, anon, authenticated;
revoke all on function public.refund_reconciliation_fact_fingerprint(text,uuid,timestamptz,text,integer,text,boolean)
  from public, anon, authenticated;
revoke all on function public.lock_refund_case_reconciliation_scope(uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_refund_email_case_candidates()
  from public, anon, authenticated;
revoke all on function public.assert_refund_case_reconciliation_safe()
  from public, anon, authenticated;
revoke all on function public.assert_refund_case_nayax_reconciliation_safe()
  from public, anon, authenticated;
revoke all on function public.assert_refund_adjustment_reconciliation_safe()
  from public, anon, authenticated;
revoke all on function public.admin_get_refund_case_reconciliation(uuid)
  from public, anon;
revoke all on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text)
  from public, anon;
revoke all on function public.admin_get_refund_reconciliation_health()
  from public, anon;
grant execute on function public.refund_case_has_unresolved_reconciliation(uuid)
  to service_role;
grant execute on function public.refund_case_has_official_action(uuid)
  to service_role;
grant execute on function public.refund_reconciliation_scope_lock_key(text,uuid)
  to service_role;
grant execute on function public.refund_reconciliation_fact_fingerprint(text,uuid,timestamptz,text,integer,text,boolean)
  to service_role;
grant execute on function public.lock_refund_case_reconciliation_scope(uuid)
  to service_role;
grant execute on function public.reconcile_refund_email_case_candidates()
  to service_role;
grant execute on function public.assert_refund_case_reconciliation_safe()
  to service_role;
grant execute on function public.assert_refund_case_nayax_reconciliation_safe()
  to service_role;
grant execute on function public.assert_refund_adjustment_reconciliation_safe()
  to service_role;
grant execute on function public.admin_get_refund_case_reconciliation(uuid)
  to authenticated, service_role;
grant execute on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text)
  to authenticated, service_role;
grant execute on function public.admin_get_refund_reconciliation_health()
  to authenticated, service_role;

comment on function public.admin_get_refund_case_reconciliation(uuid) is
  'Returns manager-scoped, PII-minimized website/email duplicate review context.';
comment on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text) is
  'Records a manager duplicate/distinct review. It never calls a payment provider or creates a settlement.';

select pg_notify('pgrst', 'reload schema');
