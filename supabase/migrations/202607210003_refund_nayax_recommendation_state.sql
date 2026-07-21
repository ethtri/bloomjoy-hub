-- Persist explainable, deterministic Nayax recommendation safety state. Raw
-- provider identifiers remain in private refund tables and never reach clients.

alter table public.refund_cases
  add column if not exists incident_local_datetime text,
  add column if not exists incident_timezone text,
  add column if not exists incident_time_resolution text,
  add column if not exists nayax_recommendation_state text,
  add column if not exists nayax_recommendation_policy_version text,
  add column if not exists nayax_recommendation_evaluated_at timestamptz,
  add column if not exists nayax_match_execution_eligible boolean not null default false;

update public.refund_cases
set incident_time_resolution = 'legacy_absolute'
where incident_at is not null
  and incident_time_resolution is null;

do $$
begin
  if exists (
    select 1
    from public.refund_cases
    where matched_nayax_transaction_id is not null
    group by matched_nayax_transaction_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'Duplicate matched Nayax transaction IDs must be reviewed before recommendation safety can be enabled.',
      hint = 'Resolve duplicate refund-case correlations without deleting audit history, then rerun this migration.';
  end if;
end;
$$;

create unique index if not exists refund_cases_unique_matched_nayax_transaction_id_idx
  on public.refund_cases (matched_nayax_transaction_id)
  where matched_nayax_transaction_id is not null;

alter table public.refund_cases
  drop constraint if exists refund_cases_incident_time_resolution_check,
  add constraint refund_cases_incident_time_resolution_check
    check (
      incident_time_resolution is null
      or incident_time_resolution in (
        'exact',
        'ambiguous',
        'nonexistent',
        'invalid_local_time',
        'invalid_timezone',
        'legacy_absolute'
      )
    ),
  drop constraint if exists refund_cases_nayax_recommendation_state_check,
  add constraint refund_cases_nayax_recommendation_state_check
    check (
      nayax_recommendation_state is null
      or nayax_recommendation_state in (
        'high_confidence',
        'ambiguous',
        'no_safe_match',
        'manual_exception'
      )
    ),
  drop constraint if exists refund_cases_nayax_execution_eligibility_check,
  add constraint refund_cases_nayax_execution_eligibility_check
    check (
      nayax_match_execution_eligible = false
      or (
        nayax_recommendation_state = 'high_confidence'
        and correlation_status = 'matched'
        and correlation_source = 'nayax'
        and matched_nayax_transaction_id is not null
        and card_wallet_used = false
        and nayax_recommendation_policy_version is not null
      )
    );

comment on column public.refund_cases.incident_local_datetime is
  'Customer-entered local incident date/time before conversion to UTC.';
comment on column public.refund_cases.incident_timezone is
  'Canonical IANA timezone from the selected reporting location.';
comment on column public.refund_cases.incident_time_resolution is
  'Resolution result for the local incident time. Non-exact values require manual review.';
comment on column public.refund_cases.nayax_recommendation_state is
  'Deterministic advisory state from the versioned Nayax matching policy.';
comment on column public.refund_cases.nayax_match_execution_eligible is
  'Fail-closed flag set only after a manager confirms the uniquely high-confidence recommendation.';

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
  'Fail-closed readiness predicate. Requires manager confirmation of a uniquely high-confidence, versioned Nayax recommendation.';

revoke execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_prepare_nayax_refund_execution(uuid, uuid) to service_role;

-- Preserve the established, scoped overview logic and wrap it with the new
-- sanitized recommendation contract. This avoids duplicating the full access
-- query while ensuring reloads receive the same evidence as direct lookup.
alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_legacy_20260721;

revoke execute on function public.admin_get_refund_operations_overview_legacy_20260721()
  from public, anon, authenticated;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  base_result jsonb;
  enriched_cases jsonb;
begin
  base_result := public.admin_get_refund_operations_overview_legacy_20260721();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'nayaxMatchExecutionEligible', refund_case.nayax_match_execution_eligible,
        'nayaxRecommendationState', refund_case.nayax_recommendation_state,
        'nayaxRecommendationPolicyVersion', refund_case.nayax_recommendation_policy_version,
        'nayaxLookupCandidates', case
          when refund_case.payment_method <> 'card' then coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
          else coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'candidateToken', candidate.token,
                'authorizedAt', candidate.machine_authorization_time,
                'machineAuthorizationTime', candidate.machine_authorization_time,
                'amountCents', candidate.amount_cents,
                'amountDeltaCents', case
                  when candidate.evidence_summary ->> 'amount_delta_cents' ~ '^\d+$'
                    then (candidate.evidence_summary ->> 'amount_delta_cents')::int
                  else null
                end,
                'timeDeltaMinutes', case
                  when candidate.evidence_summary ->> 'time_delta_minutes' ~ '^\d+$'
                    then (candidate.evidence_summary ->> 'time_delta_minutes')::int
                  else null
                end,
                'currencyCode', candidate.currency_code,
                'cardLast4', candidate.card_last4,
                'cardBrand', coalesce(candidate.evidence_summary ->> 'card_brand', ''),
                'recognitionMethod', coalesce(candidate.evidence_summary ->> 'recognition_method', ''),
                'paymentStatus', coalesce(candidate.evidence_summary ->> 'payment_status', ''),
                'recommendationRank', case
                  when candidate.evidence_summary ->> 'recommendation_rank' ~ '^\d+$'
                    then (candidate.evidence_summary ->> 'recommendation_rank')::int
                  else null
                end,
                'isTopRanked', case
                  when candidate.evidence_summary ->> 'is_top_ranked' in ('true', 'false')
                    then (candidate.evidence_summary ->> 'is_top_ranked')::boolean
                  else false
                end,
                'isRecommended', case
                  when candidate.evidence_summary ->> 'is_recommended' in ('true', 'false')
                    then (candidate.evidence_summary ->> 'is_recommended')::boolean
                  else false
                end,
                'recommendationState', candidate.evidence_summary ->> 'recommendation_state',
                'oneClickEligible', case
                  when candidate.evidence_summary ->> 'one_click_eligible' in ('true', 'false')
                    then (candidate.evidence_summary ->> 'one_click_eligible')::boolean
                  else false
                end,
                'selectionAllowed', case
                  when candidate.evidence_summary ->> 'selection_allowed' in ('true', 'false')
                    then (candidate.evidence_summary ->> 'selection_allowed')::boolean
                  else false
                end,
                'matchStrength', coalesce(candidate.evidence_summary ->> 'match_strength', 'insufficient'),
                'matchFactors', case
                  when jsonb_typeof(candidate.evidence_summary -> 'match_factors') = 'array'
                    then candidate.evidence_summary -> 'match_factors'
                  else '[]'::jsonb
                end,
                'manualReviewReasons', case
                  when jsonb_typeof(candidate.evidence_summary -> 'manual_review_reasons') = 'array'
                    then candidate.evidence_summary -> 'manual_review_reasons'
                  else '[]'::jsonb
                end,
                'hardExclusions', case
                  when jsonb_typeof(candidate.evidence_summary -> 'hard_exclusions') = 'array'
                    then candidate.evidence_summary -> 'hard_exclusions'
                  else '[]'::jsonb
                end,
                'matchReason', coalesce(candidate.evidence_summary ->> 'match_reason', 'Review Nayax card-sale evidence.'),
                'policyVersion', candidate.evidence_summary ->> 'policy_version',
                'expiresAt', candidate.expires_at,
                'createdAt', candidate.created_at
              )
              order by
                case
                  when candidate.evidence_summary ->> 'recommendation_rank' ~ '^\d+$'
                    then (candidate.evidence_summary ->> 'recommendation_rank')::int
                  else 999
                end,
                candidate.machine_authorization_time desc
            )
            from public.refund_nayax_lookup_candidates candidate
            where candidate.refund_case_id = refund_case.id
              and candidate.expires_at > now()
          ), '[]'::jsonb)
        end,
        'nayaxLookupSummary', coalesce(item.case_json -> 'nayaxLookupSummary', '{}'::jsonb) || jsonb_build_object(
          'lookupStatus', case
            when public.is_review_safe_nayax_transaction_reference(refund_case.matched_nayax_transaction_id) then 'match_found'
            when refund_case.nayax_recommendation_state = 'high_confidence' then 'match_found'
            when refund_case.nayax_recommendation_state = 'ambiguous' then 'multiple_matches'
            when refund_case.nayax_recommendation_state = 'manual_exception' then 'manual_exception'
            when refund_case.nayax_recommendation_state = 'no_safe_match' then 'no_match'
            else coalesce(item.case_json #>> '{nayaxLookupSummary,lookupStatus}', 'not_started')
          end,
          'recommendationState', refund_case.nayax_recommendation_state,
          'policyVersion', refund_case.nayax_recommendation_policy_version,
          'oneClickEligible', refund_case.nayax_match_execution_eligible,
          'lastCheckedAt', coalesce(
            to_jsonb(refund_case.nayax_recommendation_evaluated_at),
            item.case_json #> '{nayaxLookupSummary,lastCheckedAt}'
          ),
          'summary', coalesce(
            refund_case.correlation_summary,
            item.case_json #>> '{nayaxLookupSummary,summary}',
            'Nayax checks the mapped machine around the reported incident time.'
          ),
          'recommendedAction', case
            when refund_case.nayax_match_execution_eligible then 'Continue to the guarded card refund action.'
            when refund_case.nayax_recommendation_state = 'high_confidence' then 'Confirm the recommended card sale before approving the refund.'
            when refund_case.nayax_recommendation_state = 'ambiguous' then 'Compare the alternate transactions and record why the selected sale is correct.'
            when refund_case.nayax_recommendation_state = 'manual_exception' then 'Continue with manual review; one-click refund stays unavailable.'
            when refund_case.nayax_recommendation_state = 'no_safe_match' then 'Ask the customer for another detail or continue with manual review.'
            else coalesce(
              item.case_json #>> '{nayaxLookupSummary,recommendedAction}',
              'Run the Nayax transaction check.'
            )
          end
        )
      )
      order by item.case_order
    ),
    '[]'::jsonb
  )
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality as item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview with sanitized, versioned Nayax recommendation evidence and fail-closed eligibility.';

revoke execute on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated, service_role;
