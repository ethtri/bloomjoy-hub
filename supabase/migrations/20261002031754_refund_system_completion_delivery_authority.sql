-- The existing automatic completion predicate already proves immutable gift
-- issuance/message/case identity. The service worker needs read-only access to
-- that proof before admitting an existing System-authored gift completion.
grant execute on function public.is_refund_receipt_automatic_completion_message(uuid)
  to service_role;
select pg_catalog.pg_notify('pgrst','reload schema');
