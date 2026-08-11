-- Capture structured, non-sensitive customer evidence and expose only the
-- sanitized snapshot used by the Refund Operations manager workbench.

alter table public.refund_cases
  add column if not exists payment_interaction text not null default 'unsure',
  add column if not exists wallet_provider text,
  add column if not exists incident_time_confidence text not null default 'rough',
  add column if not exists issue_category text not null default 'other',
  add column if not exists product_description text;

update public.refund_cases
set payment_interaction = case
  when payment_method = 'cash' then 'cash'
  when card_wallet_used then 'phone_watch_wallet'
  else 'unsure'
end
where payment_interaction = 'unsure';

alter table public.refund_cases
  drop constraint if exists refund_cases_payment_interaction_check,
  add constraint refund_cases_payment_interaction_check
    check (payment_interaction in (
      'phone_watch_wallet',
      'tap_card',
      'insert_or_swipe',
      'cash',
      'unsure'
    )),
  drop constraint if exists refund_cases_payment_interaction_method_check,
  add constraint refund_cases_payment_interaction_method_check
    check (
      (payment_method = 'cash' and payment_interaction in ('cash', 'unsure'))
      or (payment_method <> 'cash' and payment_interaction <> 'cash')
    ),
  drop constraint if exists refund_cases_wallet_provider_check,
  add constraint refund_cases_wallet_provider_check
    check (
      wallet_provider is null
      or (
        payment_interaction = 'phone_watch_wallet'
        and wallet_provider in ('apple_pay', 'google_wallet', 'other', 'unsure')
      )
    ),
  drop constraint if exists refund_cases_incident_time_confidence_check,
  add constraint refund_cases_incident_time_confidence_check
    check (incident_time_confidence in (
      'exact',
      'within_15_minutes',
      'within_1_hour',
      'rough'
    )),
  drop constraint if exists refund_cases_issue_category_check,
  add constraint refund_cases_issue_category_check
    check (issue_category in (
      'charged_no_product',
      'product_problem',
      'charged_more_than_once',
      'wrong_amount',
      'other'
    )),
  drop constraint if exists refund_cases_product_description_length_check,
  add constraint refund_cases_product_description_length_check
    check (product_description is null or char_length(product_description) <= 160);

comment on column public.refund_cases.payment_interaction is
  'Customer-described payment interaction. This is evidence from the customer, not an inference from Nayax.';
comment on column public.refund_cases.wallet_provider is
  'Customer-described wallet provider. Current Last Sales data must not be used to infer this value.';
comment on column public.refund_cases.incident_time_confidence is
  'Customer estimate of how closely the submitted local time reflects the purchase time.';
comment on column public.refund_cases.issue_category is
  'Structured customer-service issue category used for triage, not transaction matching.';
comment on column public.refund_cases.product_description is
  'Optional customer-described product or selection, limited to non-sensitive text.';

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_evidence_clarity_v1;

revoke execute on function public.admin_get_refund_operations_overview_pre_evidence_clarity_v1()
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
  -- The upstream scoped function remains authoritative for the existing
  -- nayaxLookupCandidates, oneClickEligible, qrClaimOpenedAt, incidentAt,
  -- confidenceClass, reasonCodes, and qrTimeDeltaMinutes contract. It also
  -- requires consumed_at is not null and reporting_machine_id = refund_case.reporting_machine_id
  -- before verified QR evidence is shown.
  base_result := public.admin_get_refund_operations_overview_pre_evidence_clarity_v1();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'paymentInteraction', refund_case.payment_interaction,
        'walletProvider', refund_case.wallet_provider,
        'incidentTimeConfidence', refund_case.incident_time_confidence,
        'issueCategory', refund_case.issue_category,
        'productDescription', refund_case.product_description,
        'nayaxLookupCandidates', case
          when refund_case.payment_method <> 'card'
            then coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
          else coalesce((
            select jsonb_agg(
              visible_candidate.candidate_json || jsonb_build_object(
                'productLabel', private_candidate.evidence_summary ->> 'product_label',
                'productCode', private_candidate.evidence_summary ->> 'product_code',
                'standardPriceCents', case
                  when private_candidate.evidence_summary ->> 'standard_price_cents' ~ '^\d+$'
                    then (private_candidate.evidence_summary ->> 'standard_price_cents')::int
                  else null
                end,
                'priceMatchesMachineConfiguration', case
                  when private_candidate.evidence_summary ->> 'price_matches_machine_configuration' in ('true', 'false')
                    then (private_candidate.evidence_summary ->> 'price_matches_machine_configuration')::boolean
                  else null
                end,
                'machineStatus', case
                  when jsonb_typeof(private_candidate.evidence_summary -> 'machine_status') = 'object'
                    then private_candidate.evidence_summary -> 'machine_status'
                  else null
                end,
                'nearbyMachineAlerts', case
                  when jsonb_typeof(private_candidate.evidence_summary -> 'nearby_machine_alerts') = 'array'
                    then private_candidate.evidence_summary -> 'nearby_machine_alerts'
                  else '[]'::jsonb
                end
              )
              order by visible_candidate.candidate_order
            )
            from jsonb_array_elements(
              coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
            ) with ordinality as visible_candidate(candidate_json, candidate_order)
            left join public.refund_nayax_lookup_candidates private_candidate
              on private_candidate.token::text = visible_candidate.candidate_json ->> 'candidateToken'
             and private_candidate.refund_case_id = refund_case.id
             and private_candidate.expires_at > now()
          ), '[]'::jsonb)
        end
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
  'Scoped Refund Operations overview with structured customer evidence and sanitized, immutable Nayax context.';

revoke execute on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated, service_role;
