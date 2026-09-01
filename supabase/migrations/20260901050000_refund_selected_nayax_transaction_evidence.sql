-- #751: expose the exact selected Nayax sale in the actor-scoped manager view.
--
-- Unselected candidates remain tokenized. Once the existing guarded workflow
-- commits one exact transaction to a case, managers need the immutable provider
-- reference and correctly labeled machine-local evidence for deterministic
-- manual verification. This projection contains no raw provider payload.

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_selected_nayax_evidence_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_selected_nayax_evidence_v1()
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
  base_result :=
    public.admin_get_refund_operations_overview_pre_selected_nayax_evidence_v1();

  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'selectedNayaxTransaction', case
        when refund_case.payment_method = 'card'
          and refund_case.matched_nayax_transaction_id is not null
          and public.is_review_safe_nayax_transaction_reference(
            refund_case.matched_nayax_transaction_id
          )
          and refund_case.matched_nayax_machine_auth_time is not null
          and refund_case.matched_nayax_amount_cents is not null
          and refund_case.matched_nayax_currency_code ~ '^[A-Z]{3}$'
          and coalesce(nullif(refund_case.incident_timezone, ''), location.timezone) is not null
        then jsonb_build_object(
          'schemaVersion', 'refund_selected_nayax_transaction_v1',
          'transactionId', refund_case.matched_nayax_transaction_id,
          'saleAmountCents', refund_case.matched_nayax_amount_cents,
          'currencyCode', refund_case.matched_nayax_currency_code,
          'machineLabel', item.case_json ->> 'machineLabel',
          'locationName', item.case_json ->> 'locationName',
          'customerReportedAt', refund_case.incident_at,
          'providerAuthorizedAt', refund_case.matched_nayax_machine_auth_time,
          'machineTimezone', coalesce(
            nullif(refund_case.incident_timezone, ''),
            location.timezone
          ),
          'providerTimeResolution', coalesce(
            nullif(selected_candidate.evidence_summary ->> 'provider_time_resolution', ''),
            'unknown'
          ),
          'cardLast4', refund_case.matched_nayax_card_last4,
          'cardNetwork', case
            when selected_candidate.evidence_summary ->> 'card_network' in (
              'visa', 'mastercard', 'discover', 'american_express', 'other_unknown'
            ) then selected_candidate.evidence_summary ->> 'card_network'
            else null
          end,
          'recognitionMethod', nullif(
            selected_candidate.evidence_summary ->> 'recognition_method', ''
          ),
          'paymentInteraction', refund_case.payment_interaction,
          'walletProvider', refund_case.wallet_provider,
          'matchExplanation', coalesce(
            nullif(selected_candidate.evidence_summary ->> 'match_reason', ''),
            nullif(refund_case.correlation_summary, ''),
            'Manager confirmed this exact Nayax transaction.'
          ),
          'matchFactors', case
            when jsonb_typeof(selected_candidate.evidence_summary -> 'match_factors') = 'array'
              then selected_candidate.evidence_summary -> 'match_factors'
            else '[]'::jsonb
          end,
          'evidenceSource', case
            when selected_candidate.evidence_summary ->> 'source' = 'manual_nayax_portal'
              then 'manual_nayax_portal'
            when selected_candidate.evidence_summary is not null
              then 'nayax_last_sales'
            else 'selected_case_record'
          end,
          'payloadRedacted', true
        )
        else null
      end
    ) order by item.case_order
  ), '[]'::jsonb)
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  join public.refund_cases refund_case
    on refund_case.id = (item.case_json ->> 'id')::uuid
  left join public.reporting_locations location
    on location.id = refund_case.reporting_location_id
  left join lateral (
    select candidate.evidence_summary
    from public.refund_nayax_lookup_candidates candidate
    where candidate.refund_case_id = refund_case.id
      and candidate.provider_transaction_id = refund_case.matched_nayax_transaction_id
    order by candidate.created_at desc, candidate.token desc
    limit 1
  ) selected_candidate on true;

  return jsonb_set(
    base_result || jsonb_build_object(
      'selectedNayaxTransactionContractVersion',
      'refund_selected_nayax_transaction_v1'
    ),
    '{cases}', enriched_cases, true
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

comment on function public.admin_get_refund_operations_overview() is
  'Actor-scoped refund overview with one redacted, copyable exact Nayax transaction contract after guarded selection.';

comment on table public.refund_nayax_lookup_candidates is
  'Private server-side Nayax candidates. Unselected provider IDs remain tokenized; the actor-scoped manager overview may expose only the exact transaction already selected on a case.';

select pg_notify('pgrst', 'reload schema');
