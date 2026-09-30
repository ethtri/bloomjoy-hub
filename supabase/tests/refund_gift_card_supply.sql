-- Synthetic codes and identities only. Run after issuance and supply migrations.
begin;
do $$
declare p uuid:='70000000-0000-4000-8000-000000000001';
  sibling uuid:='70000000-0000-4000-8000-000000000002';
  claim jsonb; second jsonb; result jsonb; batch jsonb; checked integer;
begin
  insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
    eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
  values(p,'kemore','synthetic-supply-account',1500,array['70000000-0000-4000-8000-000000000003'::uuid],
    array['Synthetic location'],now()+interval '60 days',true,'Synthetic verified instructions'),
    (sibling,'kemore','synthetic-supply-account',2000,array['70000000-0000-4000-8000-000000000003'::uuid],
    array['Synthetic location'],now()+interval '60 days',true,'Synthetic verified instructions');
  insert into public.refund_gift_card_refill_rules(pool_id,min_available,target_available,max_batch_size,provider_config)
    values(p,5,7,3,'{"credential_prefix":"TEST_ONLY","scope_verified":true,"currency_verified":true}'),
      (sibling,5,7,3,'{"credential_prefix":"TEST_ONLY","scope_verified":true,"currency_verified":true}');
  claim:=public.service_claim_refund_gift_card_refill();
  if claim->>'claimed'<>'true' or (claim->>'requestedCount')::integer<>3 then
    raise exception 'Below threshold claims only configured bounded batch'; end if;
  if public.service_claim_refund_gift_card_refill()->>'claimed'<>'false' then
    raise exception 'Concurrent pool/account must not mint a second batch'; end if;
  if not public.service_begin_refund_gift_card_refill((claim->>'attemptId')::uuid,
      (claim->>'claimToken')::uuid,'["synthetic-before"]',clock_timestamp()) then
    raise exception 'Durable pre-request evidence must bind exact claim'; end if;
  result:=public.service_finish_refund_gift_card_refill((claim->>'attemptId')::uuid,
      (claim->>'claimToken')::uuid,'unknown','provider_transport_failure','[]');
  if result->>'outcome'<>'unknown' then raise exception 'Lost response must remain unknown'; end if;
  if public.service_claim_refund_gift_card_refill()->>'claimed'<>'false' then
    raise exception 'Unknown creation prevents blind mint even for sibling pool'; end if;
  update public.refund_gift_card_refill_attempts set claimed_at=now()-interval '6 minutes'
    where id=(claim->>'attemptId')::uuid;
  second:=public.service_claim_refund_gift_card_refill();
  if second->>'attemptId'<>claim->>'attemptId' or second->>'reconcile'<>'true' then
    raise exception 'Unknown recovery must reuse exact creation attempt'; end if;
  batch:=jsonb_build_array(
    jsonb_build_object('provider_code_id','synthetic-1','code','000000123','valid_from',now()-interval '1 minute','expires_at',now()+interval '120 days'),
    jsonb_build_object('provider_code_id','synthetic-2','code','000000124','valid_from',now()-interval '1 minute','expires_at',now()+interval '120 days'),
    jsonb_build_object('provider_code_id','synthetic-3','code','000000125','valid_from',now()-interval '1 minute','expires_at',now()+interval '120 days'));
  result:=public.service_finish_refund_gift_card_refill((second->>'attemptId')::uuid,
    (second->>'claimToken')::uuid,'complete','provider_reconciled',batch);
  if (result->>'importedCount')::integer<>3 then raise exception 'Verified exact batch imports atomically'; end if;
  if not exists(select 1 from public.refund_gift_card_codes where code='000000123'
      and pool_id=(claim#>>'{pool,id}')::uuid) then raise exception 'Leading zero code must survive'; end if;
  update public.refund_gift_card_codes set status='issued' where code='000000123'
    and provider_account_id='synthetic-supply-account';
  result:=public.internal_import_refund_gift_card_codes((claim#>>'{pool,id}')::uuid,batch,'synthetic_replay');
  if (result->>'replayedCount')::integer<>3 or exists(select 1 from public.refund_gift_card_codes
    where code='000000123' and provider_account_id='synthetic-supply-account' and status<>'issued') then
    raise exception 'Replay must preserve issued code and avoid duplicates'; end if;
  begin
    perform public.internal_import_refund_gift_card_codes((claim#>>'{pool,id}')::uuid,
      jsonb_build_array(batch->0,batch->0),'synthetic_duplicate');
    raise exception 'Duplicate input unexpectedly accepted';
  exception when others then if sqlerrm='Duplicate input unexpectedly accepted' then raise; end if; end;
  begin
    perform public.internal_import_refund_gift_card_codes((claim#>>'{pool,id}')::uuid,
      '[{"code":123,"provider_code_id":"synthetic-number","valid_from":"2026-01-01T00:00:00Z","expires_at":"2099-01-01T00:00:00Z"}]','synthetic_number');
    raise exception 'Numeric input unexpectedly accepted';
  exception when others then if sqlerrm='Numeric input unexpectedly accepted' then raise; end if; end;
  if has_function_privilege('anon','public.admin_get_refund_gift_card_supply()','execute')
    or has_function_privilege('authenticated','public.service_claim_refund_gift_card_refill(uuid[])','execute')
    or has_table_privilege('authenticated','public.refund_gift_card_refill_attempts','select') then
    raise exception 'Supply secrets and private worker RPCs must be inaccessible'; end if;
  update public.refund_gift_card_pools set enabled=false where id in (p,sibling);
  update public.refund_gift_card_refill_rules set next_check_at=now() where pool_id in (p,sibling);
  if public.service_claim_refund_gift_card_refill()->>'claimed'<>'false' then
    raise exception 'Disabled pool must never dispatch creation'; end if;
  update public.refund_gift_card_pools set enabled=true,expires_at=now()+interval '1 day' where id=p;
  checked:=public.service_rollover_refund_gift_card_supply();
  if checked<>1 or not exists(select 1 from public.refund_gift_card_pools where id=p
    and expires_at>now()+interval '89 days') then raise exception 'Expiry renews automatically for future offers'; end if;
end $$;
insert into public.customer_accounts(id,name,account_type)
  values('70000000-0000-4000-8000-000000000090','Supply fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
  values('70000000-0000-4000-8000-000000000091','70000000-0000-4000-8000-000000000090','Supply fixture','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
  values('70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000090',
    '70000000-0000-4000-8000-000000000091','Supply fixture','active');
do $$
declare offer jsonb; replay jsonb; quoted_expiry timestamptz;
begin
  select expires_at into quoted_expiry from public.refund_gift_card_pools where id='70000000-0000-4000-8000-000000000001';
  offer:=public.service_materialize_refund_gift_card_offer('70000000-0000-4000-8000-000000000003',2100,
    '70000000-0000-4000-8000-000000000001',quoted_expiry);
  replay:=public.service_materialize_refund_gift_card_offer('70000000-0000-4000-8000-000000000003',2500,
    '70000000-0000-4000-8000-000000000001',quoted_expiry);
  if offer->>'value'<>'2500' or offer->>'pool_id'<>replay->>'pool_id'
    or not exists(select 1 from public.refund_gift_card_refill_rules where pool_id=(offer->>'pool_id')::uuid
      and target_available=7 and max_batch_size=3)
    or exists(select 1 from public.refund_gift_card_codes where pool_id=(offer->>'pool_id')::uuid) then
    raise exception 'Accepted denomination clones configured rules once without minting codes'; end if;
  update public.refund_gift_card_pools set enabled=false where id='70000000-0000-4000-8000-000000000001';
  begin
    perform public.service_materialize_refund_gift_card_offer('70000000-0000-4000-8000-000000000003',3000,
      '70000000-0000-4000-8000-000000000001',quoted_expiry);
    raise exception 'Disabled template unexpectedly accepted';
  exception when others then if sqlerrm='Disabled template unexpectedly accepted' then raise; end if; end;
end $$;
rollback;
