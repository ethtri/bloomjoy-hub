-- A completed broad Nayax read is not a Manager-reviewed candidate set when
-- the customer supplied a wallet/device suffix, time remains rough, and none
-- of the hard-safe provider purchases has that identifier. Preserve every
-- candidate for internal research, without authorizing a guess or payment.
create function public.refund_wallet_identifier_research_required(p_refund_case_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.refund_cases c
    where c.id=p_refund_case_id and c.payment_method='card'
      and c.card_wallet_used and c.card_last4_provenance='wallet_device_token'
      and c.card_last4 ~ '^[0-9]{4}$'
      and c.incident_time_confidence='rough'
      and c.nayax_lookup_status in ('multiple_matches','manual_exception')
      and c.nayax_lookup_finished_at is not null
      and c.decision is null and c.refund_completed_at is null
      and exists (select 1 from public.refund_nayax_lookup_candidates k
        where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation)
      and not exists (select 1 from public.refund_nayax_lookup_candidates k
        where k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
          and k.card_last4=c.card_last4
          and public.refund_reviewed_card_candidate_safe_v1(c.id,k.token))
      -- A consumed, machine-bound QR claim can independently identify one
      -- current safe sale despite a tokenized wallet suffix mismatch.
      and not (
        select count(*)=1
        from public.refund_qr_claim_contexts q
        join public.refund_nayax_lookup_candidates k
          on k.refund_case_id=c.id and k.lookup_generation=c.nayax_lookup_generation
        where q.id=c.refund_qr_claim_context_id
          and q.reporting_machine_id=c.reporting_machine_id
          and q.consumed_at is not null and q.consumed_at>=q.opened_at
          and q.opened_at-k.machine_authorization_time
            between interval '0 minutes' and interval '30 minutes'
          and k.evidence_summary->'reason_codes' ? 'qr_time_within_30m'
          and public.refund_reviewed_card_candidate_safe_v1(c.id,k.token)
      )
  );
$$;
revoke all on function public.refund_wallet_identifier_research_required(uuid)
  from public,anon,authenticated;
grant execute on function public.refund_wallet_identifier_research_required(uuid)
  to service_role;

-- Both readiness and the final approval transaction use this same snapshot.
-- A caller cannot bypass the internal-research gate by supplying a stale proof.
do $wallet_snapshot_gate$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_reviewed_card_candidate_set_snapshot_v1(uuid,bigint)'::regprocedure),
    E'\r\n',E'\n');
  anchor:=$anchor$  select e.id, e.created_at,$anchor$;
  replacement:=$replacement$  if public.refund_wallet_identifier_research_required(c.id) then
    return null;
  end if;
  select e.id, e.created_at,$replacement$;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected reviewed-card preparation snapshot shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$wallet_snapshot_gate$;

create function public.refund_wallet_identifier_internal_queue(
  p_lifecycle jsonb,p_projected_lifecycle jsonb
) returns jsonb language sql immutable set search_path='' as $$
  select case when p_projected_lifecycle->>'walletIdentifierResearchRequired'='true'
    then p_lifecycle||jsonb_build_object(
      'managerAction',coalesce(p_lifecycle->'managerAction','{}'::jsonb)
        ||jsonb_build_object('action','none','owner','System'),
      'managerNextAction','research_purchase',
      'managerQueue',coalesce(p_lifecycle->'managerQueue','{}'::jsonb)
        ||jsonb_build_object('bucket','in_progress',
          'label','Wallet purchase needs research','nextAction','research_purchase',
          'customerActionFields','[]'::jsonb))
    else p_lifecycle end;
$$;
revoke all on function public.refund_wallet_identifier_internal_queue(jsonb,jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_wallet_identifier_internal_queue(jsonb,jsonb)
  to service_role;

do $wallet_next_work_gate$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_next_work_projection(jsonb,timestamptz)'::regprocedure),
    E'\r\n',E'\n');
  anchor:=$anchor$  elsif p_lifecycle ->> 'preparationPending' = 'true' then$anchor$;
  replacement:=$replacement$  elsif p_lifecycle->>'walletIdentifierResearchRequired'='true' then
    actor_name := 'agent';
    action_code := 'research_purchase';
    action_label := 'Investigate the wallet charge and provider identifier before a Manager decision.';
    blocker := jsonb_build_object(
      'code','wallet_identifier_unverified','owner','Agent',
      'nextStep','Compare current charge evidence with the provider read; do not choose an unrelated purchase.'
    );
  elsif p_lifecycle ->> 'preparationPending' = 'true' then$replacement$;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected preparation next-work projection shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$wallet_next_work_gate$;

do $wallet_case_projection_gate$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.refund_next_work_for_case(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:=$anchor$  return public.refund_resolved_reply_internal_queue(p_lifecycle,projected_lifecycle)
    || jsonb_build_object($anchor$;
  replacement:=$replacement$  if public.refund_wallet_identifier_research_required(p_refund_case_id) then
    projected_lifecycle:=projected_lifecycle||jsonb_build_object(
      'walletIdentifierResearchRequired',true);
  end if;
  return public.refund_wallet_identifier_internal_queue(
    public.refund_resolved_reply_internal_queue(p_lifecycle,projected_lifecycle),
    projected_lifecycle)
    || jsonb_build_object($replacement$;
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected settled-reply next-work wrapper shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$wallet_case_projection_gate$;

select pg_notify('pgrst','reload schema');
