-- Cross-channel refund case reconciliation.
--
-- Source-specific ingestion remains authoritative for exact replay protection:
-- hosted form server_dedupe_key, Gmail provider IDs, and the Google Form opaque
-- response ledger. This migration adds a privacy-minimized case-level review
-- layer and fail-closed guards before any official refund or settlement action.

alter table public.refund_cases
  add column if not exists duplicate_of_refund_case_id uuid,
  add column if not exists duplicate_marked_at timestamptz,
  add column if not exists duplicate_marked_by uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'refund_cases_duplicate_of_fkey'
      and conrelid = 'public.refund_cases'::regclass
  ) then
    alter table public.refund_cases
      add constraint refund_cases_duplicate_of_fkey
      foreign key (duplicate_of_refund_case_id)
      references public.refund_cases (id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'refund_cases_duplicate_marked_by_fkey'
      and conrelid = 'public.refund_cases'::regclass
  ) then
    alter table public.refund_cases
      add constraint refund_cases_duplicate_marked_by_fkey
      foreign key (duplicate_marked_by)
      references auth.users (id)
      on delete set null;
  end if;
end;
$$;

alter table public.refund_cases
  drop constraint if exists refund_cases_duplicate_not_self;

alter table public.refund_cases
  add constraint refund_cases_duplicate_not_self
  check (duplicate_of_refund_case_id is null or duplicate_of_refund_case_id <> id);

create index if not exists refund_cases_duplicate_of_idx
  on public.refund_cases (duplicate_of_refund_case_id)
  where duplicate_of_refund_case_id is not null;

create table if not exists public.refund_case_reconciliation_reviews (
  id uuid primary key default gen_random_uuid(),
  left_refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  right_refund_case_id uuid not null references public.refund_cases (id) on delete cascade,
  match_class text not null check (match_class in ('exact', 'possible')),
  status text not null default 'pending'
    check (status in ('pending', 'confirmed_duplicate', 'confirmed_distinct', 'superseded')),
  reason_codes text[] not null default '{}',
  policy_version text not null default '2026-08-04.v1',
  canonical_refund_case_id uuid references public.refund_cases (id) on delete restrict,
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
    resolution_reason_code is null
    or resolution_reason_code in (
      'same_incident',
      'source_replay',
      'customer_confirmed',
      'different_purchase',
      'incorrect_match'
    )
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
revoke all on table public.refund_case_reconciliation_reviews from public, anon, authenticated;
grant select, insert, update on table public.refund_case_reconciliation_reviews to service_role;

comment on table public.refund_case_reconciliation_reviews is
  'PII-free comparison outcomes for possible duplicate refund cases. Raw matching facts stay in access-controlled refund_cases; only fixed reason codes are persisted here.';

create or replace function public.refund_case_has_unresolved_reconciliation(p_refund_case_id uuid)
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
      and p_refund_case_id in (review.left_refund_case_id, review.right_refund_case_id)
  );
$$;

create or replace function public.refund_case_has_official_action(p_refund_case_id uuid)
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
            and attempt.status in ('in_progress', 'requested', 'approved', 'succeeded', 'ambiguous')
        )
      )
  );
$$;

revoke all on function public.refund_case_has_unresolved_reconciliation(uuid) from public, anon, authenticated;
revoke all on function public.refund_case_has_official_action(uuid) from public, anon, authenticated;
grant execute on function public.refund_case_has_unresolved_reconciliation(uuid) to service_role;
grant execute on function public.refund_case_has_official_action(uuid) to service_role;

create or replace function public.reconcile_refund_case_candidates()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate_ids uuid[] := '{}';
begin
  if new.duplicate_of_refund_case_id is not null
    or nullif(lower(btrim(coalesce(new.customer_email, ''))), '') is null
    or new.reporting_machine_id is null
    or new.incident_at is null then
    return new;
  end if;

  -- The lock key is transaction-local and never persisted. It serializes likely
  -- identical intake arriving through two channels at nearly the same time.
  perform pg_advisory_xact_lock(hashtextextended(
    lower(btrim(new.customer_email)) || ':' || new.reporting_machine_id::text || ':' || new.incident_at::date::text,
    0
  ));

  select coalesce(array_agg(candidate.id), '{}')
  into candidate_ids
  from public.refund_cases candidate
  where candidate.id <> new.id
    and candidate.duplicate_of_refund_case_id is null
    and candidate.status not in ('denied', 'closed')
    and lower(btrim(candidate.customer_email)) = lower(btrim(new.customer_email))
    and candidate.reporting_machine_id = new.reporting_machine_id
    and candidate.incident_at is not null
    and abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 21600
    and (
      candidate.payment_amount_cents = new.payment_amount_cents
      or (
        candidate.payment_method = new.payment_method
        and candidate.payment_method = 'card'
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
    policy_version
  )
  select
    least(new.id, candidate.id),
    greatest(new.id, candidate.id),
    case
      when abs(extract(epoch from (candidate.incident_at - new.incident_at))) <= 900
        and candidate.payment_amount_cents is not null
        and candidate.payment_amount_cents = new.payment_amount_cents
        and candidate.payment_method is not null
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
      case
        when candidate.card_last4 is not null and candidate.card_last4 = new.card_last4
          then 'card_last4_exact'
      end,
      case when candidate.card_wallet_used = new.card_wallet_used then 'wallet_state_exact' end
    ]::text[], null),
    '2026-08-04.v1'
  from public.refund_cases candidate
  where candidate.id = any(candidate_ids)
  on conflict (left_refund_case_id, right_refund_case_id) do update
  set
    match_class = excluded.match_class,
    reason_codes = excluded.reason_codes,
    policy_version = excluded.policy_version,
    updated_at = now()
  where refund_case_reconciliation_reviews.status = 'pending';

  return new;
end;
$$;

drop trigger if exists refund_cases_reconcile_candidates on public.refund_cases;
create trigger refund_cases_reconcile_candidates
after insert or update of
  reporting_machine_id,
  customer_email,
  incident_at,
  payment_method,
  payment_amount_cents,
  card_last4,
  card_wallet_used
on public.refund_cases
for each row execute function public.reconcile_refund_case_candidates();

revoke all on function public.reconcile_refund_case_candidates() from public, anon, authenticated;
grant execute on function public.reconcile_refund_case_candidates() to service_role;

create or replace function public.assert_refund_case_reconciliation_safe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
      new.status is distinct from old.status
      or new.decision is distinct from old.decision
      or new.refund_completed_at is distinct from old.refund_completed_at
      or new.reporting_adjustment_id is distinct from old.reporting_adjustment_id
    )
    and (
      new.status in ('approved', 'card_refund_pending', 'cash_zelle_pending', 'completed')
      or new.decision = 'approved'
      or new.refund_completed_at is not null
      or new.reporting_adjustment_id is not null
    ) then
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

drop trigger if exists refund_cases_reconciliation_action_guard on public.refund_cases;
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
    or new.status in ('in_progress', 'requested', 'approved', 'succeeded', 'ambiguous') then
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
    and (
      new.source = 'refund_case'
      or new.match_status = 'applied'
    )
    and exists (
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

  return new;
end;
$$;

drop trigger if exists sales_adjustment_refund_reconciliation_guard
  on public.sales_adjustment_facts;
create trigger sales_adjustment_refund_reconciliation_guard
before insert or update on public.sales_adjustment_facts
for each row execute function public.assert_refund_adjustment_reconciliation_safe();

revoke all on function public.assert_refund_case_reconciliation_safe() from public, anon, authenticated;
revoke all on function public.assert_refund_case_nayax_reconciliation_safe() from public, anon, authenticated;
revoke all on function public.assert_refund_adjustment_reconciliation_safe() from public, anon, authenticated;
grant execute on function public.assert_refund_case_reconciliation_safe() to service_role;
grant execute on function public.assert_refund_case_nayax_reconciliation_safe() to service_role;
grant execute on function public.assert_refund_adjustment_reconciliation_safe() to service_role;

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
        and refund_case.duplicate_of_refund_case_id is null
        and not public.refund_case_has_unresolved_reconciliation(refund_case.id)
        and refund_case.payment_method = 'card'
        and refund_case.decision = 'approved'
        and refund_case.status in ('approved', 'card_refund_pending')
        and refund_case.correlation_status = 'matched'
        and refund_case.correlation_source = 'nayax'
        and refund_case.nayax_recommendation_state = 'high_confidence'
        and refund_case.nayax_match_execution_eligible = true
        and refund_case.card_wallet_used = false
        and refund_case.nayax_recommendation_policy_version is not null
        and public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id)
        and refund_case.matched_nayax_site_id is not null
        and refund_case.matched_nayax_machine_auth_time is not null
        and refund_case.matched_nayax_currency_code = 'USD'
        and refund_case.refund_amount_cents is not null
        and refund_case.payment_amount_cents is not null
        and refund_case.matched_nayax_amount_cents is not null
        and refund_case.refund_amount_cents > 0
        and refund_case.refund_amount_cents = refund_case.payment_amount_cents
        and refund_case.refund_amount_cents = refund_case.matched_nayax_amount_cents
        and refund_case.reporting_adjustment_id is null
        and not exists (
          select 1
          from public.refund_cases duplicate_case
          where duplicate_case.id <> refund_case.id
            and duplicate_case.matched_nayax_transaction_id = refund_case.matched_nayax_transaction_id
        )
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
              or refund_case.refund_amount_cents <= machine.nayax_refund_max_amount_cents
            )
        )
    );
$$;

comment on function public.can_prepare_nayax_refund_execution(uuid, uuid) is
  'Fail-closed readiness predicate. Requires a manager-confirmed high-confidence recommendation and no unresolved or confirmed duplicate case.';

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) to service_role;

create or replace function public.admin_get_refund_case_reconciliation(p_refund_case_id uuid)
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
          when review.left_refund_case_id = refund_case.id then review.right_refund_case_id
          else review.left_refund_case_id
        end
      where refund_case.id in (review.left_refund_case_id, review.right_refund_case_id)
        and review.status <> 'superseded'
        and public.can_manage_refund_case(actor_user_id, other_case.id)
    ), '[]'::jsonb)
  )
  into result
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
  previous_duplicate_case_id uuid;
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
    'same_incident',
    'source_replay',
    'customer_confirmed',
    'different_purchase',
    'incorrect_match'
  ) then
    raise exception 'A supported resolution reason is required';
  end if;

  select * into review_row
  from public.refund_case_reconciliation_reviews
  where id = p_review_id
  for update;

  if review_row.id is null then
    raise exception 'Reconciliation review not found';
  end if;
  if review_row.status = 'superseded' then
    raise exception 'Superseded reconciliation reviews cannot be resolved';
  end if;
  if not public.can_manage_refund_case(actor_user_id, review_row.left_refund_case_id)
    or not public.can_manage_refund_case(actor_user_id, review_row.right_refund_case_id) then
    raise exception 'Refund case access required';
  end if;

  perform 1
  from public.refund_cases
  where id in (review_row.left_refund_case_id, review_row.right_refund_case_id)
  order by id
  for update;

  previous_duplicate_case_id := case
    when review_row.status = 'confirmed_duplicate'
      and review_row.canonical_refund_case_id = review_row.left_refund_case_id
      then review_row.right_refund_case_id
    when review_row.status = 'confirmed_duplicate'
      then review_row.left_refund_case_id
    else null
  end;

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
    if exists (
      select 1 from public.refund_cases
      where id = duplicate_case_id
        and duplicate_of_refund_case_id is not null
        and duplicate_of_refund_case_id <> p_canonical_refund_case_id
    ) then
      raise exception 'The duplicate case is already linked to another canonical case';
    end if;

    if previous_duplicate_case_id is not null and previous_duplicate_case_id <> duplicate_case_id then
      if public.refund_case_has_official_action(previous_duplicate_case_id) then
        raise exception 'The prior duplicate resolution has an official action and cannot be changed';
      end if;
      update public.refund_cases
      set duplicate_of_refund_case_id = null,
          duplicate_marked_at = null,
          duplicate_marked_by = null
      where id = previous_duplicate_case_id
        and duplicate_of_refund_case_id = review_row.canonical_refund_case_id;
    end if;

    update public.refund_cases
    set duplicate_of_refund_case_id = p_canonical_refund_case_id,
        duplicate_marked_at = now(),
        duplicate_marked_by = actor_user_id
    where id = duplicate_case_id;

    update public.refund_case_reconciliation_reviews
    set status = 'confirmed_duplicate',
        canonical_refund_case_id = p_canonical_refund_case_id,
        resolved_by = actor_user_id,
        resolved_at = now(),
        resolution_reason_code = normalized_reason,
        updated_at = now()
    where id = review_row.id;

    update public.refund_case_reconciliation_reviews
    set status = 'superseded', updated_at = now()
    where id <> review_row.id
      and status = 'pending'
      and duplicate_case_id in (left_refund_case_id, right_refund_case_id);
  else
    if previous_duplicate_case_id is not null then
      if public.refund_case_has_official_action(previous_duplicate_case_id) then
        raise exception 'A duplicate resolution with an official action cannot be reversed';
      end if;
      update public.refund_cases
      set duplicate_of_refund_case_id = null,
          duplicate_marked_at = null,
          duplicate_marked_by = null
      where id = previous_duplicate_case_id
        and duplicate_of_refund_case_id = review_row.canonical_refund_case_id;
    end if;

    update public.refund_case_reconciliation_reviews
    set status = 'confirmed_distinct',
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
    'cross_channel_reconciliation_resolved',
    case
      when normalized_resolution = 'duplicate'
        then 'A manager marked the reviewed cases as the same customer incident.'
      else 'A manager confirmed the reviewed cases are distinct customer incidents.'
    end,
    jsonb_build_object(
      'review_id', review_row.id,
      'resolution', normalized_resolution,
      'reason_code', normalized_reason,
      'canonical_case_id', p_canonical_refund_case_id,
      'payload_redacted', true,
      'official_action', false
    )
  from unnest(array[review_row.left_refund_case_id, review_row.right_refund_case_id]) case_id;

  return public.admin_get_refund_case_reconciliation(review_row.left_refund_case_id);
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
    'policyVersion', '2026-08-04.v1'
  );
end;
$$;

revoke all on function public.admin_get_refund_case_reconciliation(uuid) from public, anon;
revoke all on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text) from public, anon;
revoke all on function public.admin_get_refund_reconciliation_health() from public, anon;
grant execute on function public.admin_get_refund_case_reconciliation(uuid) to authenticated, service_role;
grant execute on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text) to authenticated, service_role;
grant execute on function public.admin_get_refund_reconciliation_health() to authenticated, service_role;

comment on function public.admin_get_refund_case_reconciliation(uuid) is
  'Returns manager-scoped, PII-minimized duplicate review context for one refund case.';
comment on function public.admin_resolve_refund_case_reconciliation(uuid,text,uuid,text) is
  'Records a reversible manager duplicate/distinct decision. It never calls a payment provider or creates a settlement adjustment.';
comment on function public.admin_get_refund_reconciliation_health() is
  'Returns manager-scoped aggregate duplicate-review health without customer identifiers.';
