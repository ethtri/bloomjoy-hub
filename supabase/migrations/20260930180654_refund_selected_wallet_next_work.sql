-- #1429: the unmatched wallet set needs research only until a reviewed,
-- current selected purchase is confirmed. The existing selection readiness
-- validates its exact candidate and immutable fact/generation-bound proof.
-- Do not change selection, approval, execution, or reconciliation authority.
do $migration$
declare
  definition text;
  anchor text := 'and c.decision is null and c.refund_completed_at is null';
begin
  definition := replace(pg_get_functiondef(
    'public.refund_wallet_identifier_research_required(uuid)'::regprocedure),
    E'\r\n', E'\n');
  if cardinality(string_to_array(definition, anchor)) <> 2 then
    raise exception 'Expected current unmatched-wallet research predicate';
  end if;
  execute replace(definition, anchor, anchor || E'\n'
    || '      and (public.refund_case_nayax_manager_readiness(null,c.id)'
    || ' ->> ''transactionConfirmed'') is distinct from ''true''');
end;
$migration$;
