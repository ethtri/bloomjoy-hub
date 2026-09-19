-- Pending Gmail case-link review controls customer communication and remains a
-- manager queue task. It is not a payment-authorization invariant. Replace the
-- historical internal overview layer that coupled those two concerns, while
-- preserving the redacted review contract and lifecycle projection.

create or replace function
  public.admin_get_refund_operations_overview_pre_lifecycle_v2()
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
    public.admin_get_refund_operations_overview_pre_gmail_case_link_v1();

  select coalesce(jsonb_agg(
    item.case_json || jsonb_build_object(
      'inboundLinkReview', case when review.id is null then null
        else public.refund_gmail_case_link_review_contract(review.id) end,
      'lifecycle', case when review.id is null
        then item.case_json -> 'lifecycle'
        else coalesce(item.case_json -> 'lifecycle', '{}'::jsonb)
          || jsonb_build_object(
            'managerNextAction', 'review_inbound_case_link',
            'managerQueue', coalesce(
              item.case_json -> 'lifecycle' -> 'managerQueue',
              '{}'::jsonb
            ) || jsonb_build_object(
              'schemaVersion', 'refund_manager_queue_v1',
              'bucket', 'needs_action',
              'label', 'Action needed',
              'nextAction', 'review_inbound_case_link',
              'safeRetryEligible', false,
              'payloadRedacted', true
            )
          )
      end
    ) order by item.case_order
  ), '[]'::jsonb)
  into enriched_cases
  from jsonb_array_elements(coalesce(base_result -> 'cases', '[]'::jsonb))
    with ordinality item(case_json, case_order)
  left join lateral (
    select pending_review.*
    from public.refund_gmail_case_link_review_candidates candidate
    join public.refund_gmail_case_link_reviews pending_review
      on pending_review.id = candidate.review_id
    where candidate.refund_case_id = (item.case_json ->> 'id')::uuid
      and pending_review.status = 'pending'
    order by pending_review.created_at, pending_review.id
    limit 1
  ) review on true;

  return jsonb_set(
    base_result || jsonb_build_object(
      'inboundLinkReviewContractVersion', 'refund_gmail_case_link_review_v1'
    ),
    '{cases}', enriched_cases, true
  );
end;
$$;

revoke all on function
  public.admin_get_refund_operations_overview_pre_lifecycle_v2()
  from public, anon, authenticated, service_role;

comment on function
  public.admin_get_refund_operations_overview_pre_lifecycle_v2() is
  'Internal overview projection: pending Gmail linkage suppresses customer contact and remains manager case work without replacing authoritative payment capability fields.';

select pg_notify('pgrst', 'reload schema');
