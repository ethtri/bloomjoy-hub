-- Allow assigned Machine Managers and scoped admins who can manage a refund case
-- to prepare guarded Nayax refund execution. Safety gates, caps, duplicate
-- prevention, and provider execution kill switches remain fail-closed.

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
  'Readiness predicate for guarded Nayax refund execution by authorized refund case managers. This does not call Nayax or approve refunds.';

