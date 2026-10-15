-- #1945: one final gift decision, one durable notice, truthful delivery work.
-- No issuance, allowance, settlement, amount or authorization policy changes.

create function private.refund_gift_delivery_unresolved(p_message jsonb)
returns boolean language sql immutable set search_path='' as $$
  select coalesce(p_message->>'manual_delivery_state'='claimed'
      and p_message->>'manual_delivery_provider_attempted_at' is not null,false)
    or coalesce(
    (p_message->>'manual_delivery_state'='delivery_unknown'
      or (p_message->>'delivery_state'='unknown'
        and p_message->>'manual_delivery_provider_attempted_at' is not null))
    and not coalesce((p_message->>'delivery_transport'='resend'
      and p_message->>'provider_message_id' ~ '^[A-Za-z0-9_-]{8,255}$'
      and p_message->>'delivery_state_updated_at' is not null
      and p_message->>'delivery_state' in ('accepted','deferred','delivered','failed','bounced','complained')),false),
    false);
$$;
revoke all on function private.refund_gift_delivery_unresolved(jsonb) from public,anon,authenticated,service_role;

create function private.refund_gift_delivery_recovery(p_case_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when c.gift_card_state<>'issued' or i.id is null then 'not_issued'
    when i.expires_at<=statement_timestamp() or code.expires_at<=statement_timestamp()
      or code.status<>'issued' then 'code_unavailable'
    when exists(select 1 from public.refund_case_messages m
      where (m.id=i.message_id or m.gift_card_issuance_id=i.id)
        and private.refund_gift_delivery_unresolved(to_jsonb(m))) then 'reconciliation_required'
    when exists(select 1 from public.refund_case_messages m
      where (m.id=i.message_id or m.gift_card_issuance_id=i.id)
        and m.manual_delivery_state in ('queued','claimed')) then 'queued'
    else 'ready' end
  from public.refund_cases c
  left join public.refund_gift_card_issuances i on i.refund_case_id=c.id
  left join public.refund_gift_card_codes code on code.id=i.code_id
  where c.id=p_case_id;
$$;
revoke all on function private.refund_gift_delivery_recovery(uuid) from public,anon,authenticated,service_role;

-- The existing provider ledger is bound to the exact message by its receipt.
-- A late resolved outcome supersedes a stale manual unknown flag. A failure or
-- bounce is a known delivery outcome, never evidence that no email was sent.
do $$ declare d text; old_fragment text; begin
  d:=replace(pg_get_functiondef('public.admin_resend_refund_gift_card(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n');
  old_fragment:='(prior.manual_delivery_state=''delivery_unknown''
        or (prior.delivery_state=''unknown'' and prior.manual_delivery_provider_attempted_at is not null)
        or (prior.manual_delivery_state=''claimed'' and prior.manual_delivery_provider_attempted_at is not null))';
  old_fragment:=replace(old_fragment,E'\r\n',E'\n');
  if strpos(d,old_fragment)=0 then raise exception 'Gift resend unknown guard changed'; end if;
  execute replace(d,old_fragment,'private.refund_gift_delivery_unresolved(to_jsonb(prior))');

  d:=pg_get_functiondef('public.get_refund_gift_card_case(uuid)'::regprocedure);
  old_fragment:='''can_resend'',c.gift_card_state=''issued'' and public.refund_official_action_authority(auth.uid(),p_case_id) is not null,';
  if strpos(d,old_fragment)=0 then raise exception 'Gift resend capability changed'; end if;
  execute replace(d,old_fragment,
    '''delivery_recovery_state'',private.refund_gift_delivery_recovery(p_case_id),
    ''can_resend'',private.refund_gift_delivery_recovery(p_case_id) in (''ready'',''queued'')
      and public.refund_official_action_authority(auth.uid(),p_case_id) is not null,');

end $$;
