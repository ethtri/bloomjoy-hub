-- Expose verified QR timing and versioned, redacted recommendation evidence to
-- authorized Refund Operations users. Raw QR tokens and Nayax identifiers stay
-- in service-only tables.

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_qr_match_v2;

revoke execute on function public.admin_get_refund_operations_overview_pre_qr_match_v2()
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
  base_result := public.admin_get_refund_operations_overview_pre_qr_match_v2();

  select coalesce(
    jsonb_agg(
      item.case_json || jsonb_build_object(
        'qrClaimOpenedAt', verified_claim.opened_at,
        'nayaxLookupCandidates', case
          when refund_case.payment_method <> 'card'
            then coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
          else coalesce((
            select jsonb_agg(
              candidate_json || jsonb_build_object(
                'qrTimeDeltaMinutes', case
                  when private_candidate.evidence_summary ->> 'qr_time_delta_minutes' ~ '^-?\d+$'
                    then (private_candidate.evidence_summary ->> 'qr_time_delta_minutes')::int
                  else null
                end,
                'confidenceClass', coalesce(
                  private_candidate.evidence_summary ->> 'confidence_class',
                  'ambiguous_manual'
                ),
                'reasonCodes', case
                  when jsonb_typeof(private_candidate.evidence_summary -> 'reason_codes') = 'array'
                    then private_candidate.evidence_summary -> 'reason_codes'
                  else '[]'::jsonb
                end
              )
              order by candidate_order
            )
            from jsonb_array_elements(
              coalesce(item.case_json -> 'nayaxLookupCandidates', '[]'::jsonb)
            ) with ordinality as visible_candidate(candidate_json, candidate_order)
            left join public.refund_nayax_lookup_candidates private_candidate
              on private_candidate.token::text = candidate_json ->> 'candidateToken'
             and private_candidate.refund_case_id = refund_case.id
             and private_candidate.expires_at > now()
          ), '[]'::jsonb)
        end,
        'nayaxLookupSummary',
          coalesce(item.case_json -> 'nayaxLookupSummary', '{}'::jsonb) ||
          jsonb_build_object(
            'incidentAt', refund_case.incident_at,
            'qrClaimOpenedAt', verified_claim.opened_at,
            'qrClaimEvidenceStatus', case
              when refund_case.refund_qr_claim_context_id is null then 'missing'
              when verified_claim.opened_at is not null then 'verified'
              else 'invalid'
            end,
            'confidenceClass', coalesce(
              recommendation_evidence.evidence_summary ->> 'confidence_class',
              'ambiguous_manual'
            ),
            'oneClickEligible', case
              when item.case_json #>> '{nayaxLookupSummary,oneClickEligible}' in ('true', 'false')
                then (item.case_json #>> '{nayaxLookupSummary,oneClickEligible}')::boolean
              else false
            end,
            'reasonCodes', case
              when jsonb_typeof(recommendation_evidence.evidence_summary -> 'reason_codes') = 'array'
                then recommendation_evidence.evidence_summary -> 'reason_codes'
              else '[]'::jsonb
            end,
            'maximumUniqueQrLagMinutes', 30
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
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join public.refund_qr_claim_contexts verified_claim
    on verified_claim.id = refund_case.refund_qr_claim_context_id
   and verified_claim.reporting_machine_id = refund_case.reporting_machine_id
   and verified_claim.consumed_at is not null
   and verified_claim.consumed_at >= verified_claim.opened_at
  left join lateral (
    select private_candidate.evidence_summary
    from public.refund_nayax_lookup_candidates private_candidate
    where private_candidate.refund_case_id = refund_case.id
      and private_candidate.expires_at > now()
    order by
      case when private_candidate.evidence_summary ->> 'is_recommended' = 'true' then 0 else 1 end,
      case
        when private_candidate.evidence_summary ->> 'recommendation_rank' ~ '^\d+$'
          then (private_candidate.evidence_summary ->> 'recommendation_rank')::int
        else 999
      end,
      private_candidate.created_at desc
    limit 1
  ) recommendation_evidence on true;

  return jsonb_set(base_result, '{cases}', enriched_cases, true);
end;
$$;

comment on function public.admin_get_refund_operations_overview() is
  'Scoped Refund Operations overview with separate reported/QR times and redacted QR-aware Nayax recommendation evidence.';

revoke execute on function public.admin_get_refund_operations_overview() from public, anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated, service_role;
