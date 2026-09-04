-- A message-delivery review does not replace unpaid transaction/payment work.
-- Edit the v2 projection beneath the existing authoritative-receipt wrappers.
-- No case, message, approval, payment, authorization, or transport mutation.
begin;
do $migration$
declare
  definition text := pg_get_functiondef('public.refund_lifecycle_contract_pre_authoritative_receipt_v1(uuid)'::regprocedure);
  old_fragment text;
  new_fragment text;
begin
  old_fragment := $old$  if delivery_review_required
    and integrity_code is null
    and not terminal then
    manager_action := 'review_delivery_no_resend';
  end if;$old$;
  new_fragment := $new$  if delivery_review_required
    and integrity_code is null
    and stage in ('refund_confirmed', 'customer_notified')
    and not terminal then
    manager_action := 'review_delivery_no_resend';
  end if;$new$;
  if position(old_fragment in definition) = 0 then raise exception 'Expected lifecycle delivery-action projection was not found'; end if;
  definition := replace(definition, old_fragment, new_fragment);
  old_fragment := $old$      'failureClass', case
        when delivery_review_required then 'customer_delivery_exception'
        else coalesce(integrity_code, attempt_row.safe_failure_class)
      end,$old$;
  new_fragment := $new$      'failureClass', case
        when integrity_code is not null then integrity_code
        when payment_operations_required then attempt_row.safe_failure_class
        when delivery_review_required then 'customer_delivery_exception'
        else attempt_row.safe_failure_class
      end,$new$;
  if position(old_fragment in definition) = 0 then raise exception 'Expected lifecycle operations-failure projection was not found'; end if;
  definition := replace(definition, old_fragment, new_fragment);
  old_fragment := $old$        when delivery_review_required
          then 'Review customer delivery evidence. Do not replay the message or payment.'
        when payment_operations_required
          then 'Confirm the authoritative Nayax result. Do not retry.'$old$;
  new_fragment := $new$        when payment_operations_required
          then 'Confirm the authoritative Nayax result. Do not retry.'
        when delivery_review_required
          then 'Review customer delivery evidence. Do not resend the message blindly. Follow the current refund step separately.'$new$;
  if position(old_fragment in definition) = 0 then raise exception 'Expected lifecycle operations-next-step projection was not found'; end if;
  definition := replace(definition, old_fragment, new_fragment);
  execute definition;
end;
$migration$;
commit;
