begin;
set local lock_timeout='3s';

-- Reuse one independently computed safety result per current candidate inside
-- this statement. Every row still contributes to the digest, including blocked
-- and unselectable rows. No result survives a call, actor or source change.
-- Preserve all event/wallet gates, hash inputs, token order and function grants.
do $patch$
declare
 definition text;
 before_aggregate text:=$aggregate_before$
  select count(*)::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true')::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true'
      and public.refund_reviewed_card_candidate_safe_v1(c.id, k.token))::integer,
    jsonb_agg(k.token order by k.token) filter (
      where k.evidence_summary ->> 'selection_allowed' = 'true'
        and public.refund_reviewed_card_candidate_safe_v1(c.id, k.token)),
    encode(extensions.digest(convert_to(
      coalesce(string_agg(
        public.refund_nayax_candidate_evidence_hash(
          k.refund_case_id, k.actor_user_id, k.provider_transaction_id,
          k.site_id, k.machine_authorization_time, k.amount_cents,
          k.card_last4, k.currency_code, k.evidence_summary,
          k.expires_at, k.created_at
        ) || ':' || case when public.refund_reviewed_card_candidate_safe_v1(c.id,k.token)
          then 'safe' else 'blocked' end, '|' order by k.token), ''),
      'UTF8'), 'sha256'), 'hex')
    into candidate_count, selectable_count, safe_count, eligible_tokens, set_digest
  from public.refund_nayax_lookup_candidates k
  where k.refund_case_id = c.id
    and k.lookup_generation = c.nayax_lookup_generation;
$aggregate_before$;
 after_aggregate text:=$aggregate_after$
  with checked as materialized (
    select k.token,k.refund_case_id,k.actor_user_id,k.provider_transaction_id,
      k.site_id,k.machine_authorization_time,k.amount_cents,k.card_last4,
      k.currency_code,k.evidence_summary,k.expires_at,k.created_at,
      public.refund_reviewed_card_candidate_safe_v1(c.id,k.token) as current_safety
    from public.refund_nayax_lookup_candidates k
    where k.refund_case_id = c.id
      and k.lookup_generation = c.nayax_lookup_generation
  )
  select count(*)::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true')::integer,
    count(*) filter (where k.evidence_summary ->> 'selection_allowed' = 'true'
      and k.current_safety)::integer,
    jsonb_agg(k.token order by k.token) filter (
      where k.evidence_summary ->> 'selection_allowed' = 'true'
        and k.current_safety),
    encode(extensions.digest(convert_to(
      coalesce(string_agg(
        public.refund_nayax_candidate_evidence_hash(
          k.refund_case_id, k.actor_user_id, k.provider_transaction_id,
          k.site_id, k.machine_authorization_time, k.amount_cents,
          k.card_last4, k.currency_code, k.evidence_summary,
          k.expires_at, k.created_at
        ) || ':' || case when k.current_safety
          then 'safe' else 'blocked' end, '|' order by k.token), ''),
      'UTF8'), 'sha256'), 'hex')
    into candidate_count, selectable_count, safe_count, eligible_tokens, set_digest
  from checked k;
$aggregate_after$;
begin
 if (select provolatile from pg_proc where oid=
   'public.refund_reviewed_card_candidate_safe_v1(uuid,uuid)'::regprocedure) is distinct from 's'
   or (select provolatile from pg_proc where oid=
   'public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint)'::regprocedure) is distinct from 's' then
   raise exception 'Reviewed candidate checks must remain STABLE';
 end if;
 definition:=replace(pg_get_functiondef(
   'public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint)'::regprocedure),E'\r\n',E'\n');
 if cardinality(string_to_array(definition,before_aggregate))<>2 then
   raise exception 'Reviewed candidate aggregate changed';
 end if;
 execute replace(definition,before_aggregate,after_aggregate);
end $patch$;

commit;
