-- #1359: the scorer and database must agree that an unproven wallet/device
-- suffix difference is reviewable. This changes manager selection only; the
-- existing machine, provider, refund-state, duplicate, and payment gates stay.
-- The evidence JSON contract remains v12, so no new policy-version adapter is
-- needed for either persisted candidates or selected-transaction validation.
do $wallet_review$
declare
  source text;
  old_fragment text := E'  neutral_physical_contactless_mismatch :=\n    expected_customer_credential = ''customer_physical_contactless_pan''\n    and p_evidence ->> ''card_last4_comparison'' = ''mismatch_neutral_unproven_scope''';
  new_fragment text := E'  neutral_physical_contactless_mismatch :=\n    p_evidence ->> ''card_last4_comparison'' = ''mismatch_neutral_unproven_scope''';
begin
  source := pg_catalog.replace(pg_catalog.pg_get_functiondef(
    'public.refund_nayax_candidate_id_state_time_v1(uuid,uuid,integer,timestamptz,integer,text,text,jsonb)'::regprocedure
  ), E'\r\n', E'\n');
  if (pg_catalog.length(source) - pg_catalog.length(pg_catalog.replace(source, old_fragment, '')))
    / pg_catalog.length(old_fragment) <> 1 then
    raise exception 'Refund candidate neutral-mismatch validator changed';
  end if;
  execute pg_catalog.replace(source, old_fragment, new_fragment);
end;
$wallet_review$;
