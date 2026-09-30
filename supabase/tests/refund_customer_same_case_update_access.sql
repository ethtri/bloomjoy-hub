begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('dc100000-0000-4000-8000-000000000004','authenticated','authenticated','correction-manager@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type) values('dc100000-0000-4000-8000-000000000001','Scoped correction fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status) values('dc100000-0000-4000-8000-000000000002','dc100000-0000-4000-8000-000000000001','Correction fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('dc100000-0000-4000-8000-000000000003','dc100000-0000-4000-8000-000000000001','dc100000-0000-4000-8000-000000000002','Scoped fixture machine','commercial','active',true,'Correction fixture machine');
insert into public.admin_roles(user_id,role,active) values('dc100000-0000-4000-8000-000000000004','super_admin',true);
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason) values('dc100000-0000-4000-8000-000000000003','dc100000-0000-4000-8000-000000000004','correction-manager@example.invalid','Scoped correction fixture');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;
create function pg_temp.make_scope(n integer, deliver boolean default true) returns uuid language plpgsql as $$
declare cid uuid:=('dc100000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid; mid uuid:=gen_random_uuid(); cycle jsonb; c public.refund_cases;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_wallet_used,card_network,status,correlation_status,intake_source)
  values(cid,'dc100000-0000-4000-8000-000000000003','dc100000-0000-4000-8000-000000000002','scope-customer-'||n||'@example.invalid','Scoped correction test',
    statement_timestamp()-interval '2 hours',to_char((statement_timestamp()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','card','tap_card',
    case when n=12 then 700 else null end,case when n=12 then null else '1234' end,
    case when n=12 then null else 'physical_card' end,false,'visa','needs_review','manual_review','form');
  cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
  if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,'more_info','pending','scope-customer-'||n||'@example.invalid','Please review your purchase','[Secure refund correction link included at delivery]','deterministic_template','automatic','missing_information','refund_follow_up_v2',(cycle#>>'{cycle,id}')::uuid,public.refund_missing_follow_up_fields(cid));
  select * into c from public.refund_cases where id=cid;
  perform public.service_issue_refund_purchase_correction(mid,lpad(to_hex(n),64,'0'),c.deterministic_fact_version);
  if deliver and n=6 then
    update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id=mid;
  elsif deliver then
    perform public.service_mark_refund_transactional_delivery_attempt(mid);
    perform public.service_bind_refund_transactional_delivery(mid,'synthetic-renewal-'||n,statement_timestamp());
    update public.refund_case_messages set status='sent',sent_at=statement_timestamp() where id=mid;
  end if;
  if n=8 then
    -- Reproduce a legacy wallet-token assumption after the generic request was
    -- delivered, then rebind only this test capability to the current fact
    -- version. The production claim path correctly keeps wallet outreach on
    -- its dedicated secure flow.
    update public.refund_cases set payment_interaction='phone_watch_wallet',card_wallet_used=true,
      card_last4_provenance='wallet_device_token' where id=cid returning * into c;
    update public.refund_wallet_correction_contexts set correction_fact_version=c.deterministic_fact_version,
      correction_snapshot=public.refund_purchase_correction_values(c) where correction_message_id=mid;
  end if;
  return cid;
end; $$;
create function pg_temp.submit(n integer,answers jsonb) returns jsonb language sql as $$
 select public.service_submit_refund_purchase_correction(lpad(to_hex(n),64,'0'),
  (select correction_fact_version from public.refund_wallet_correction_contexts where token_hash=lpad(to_hex(n),64,'0')),answers);
$$;
select pg_temp.make_scope(n,true) from generate_series(1,6) n;
select pg_temp.make_scope(7,false);
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour'
  where token_hash in (lpad('1',64,'0'),lpad('2',64,'0'),lpad('4',64,'0'),lpad('5',64,'0'),lpad('6',64,'0'),lpad('7',64,'0'));
create temp table before_renewal as select
  (select count(*) from public.refund_cases) cases,
  (select count(*) from public.refund_case_messages) messages,
  (select count(*) from public.refund_follow_up_cycles) cycles,
  (select count(*) from public.refund_case_nayax_refund_attempts) payments,
  (select deterministic_fact_version from public.refund_cases where id='dc100000-0000-4000-8001-000000000001') facts;
select ok(not has_function_privilege('anon','public.service_renew_refund_purchase_correction(text,text)','execute')
  and not has_function_privilege('authenticated','public.service_renew_refund_purchase_correction(text,text)','execute'),'Public roles cannot invoke renewal service directly');
select ok((public.service_get_refund_purchase_correction(lpad('1',64,'0'))->>'canRenew')::boolean,'Known delivered expired link offers same-case update recovery');
select is(public.service_renew_refund_purchase_correction(repeat('f',64),repeat('a',64))->>'state','unavailable','Unknown token cannot recover a case');
select is(public.service_renew_refund_purchase_correction(lpad('7',64,'0'),repeat('a',64))->>'state','unavailable','Unsent request cannot recover access');
select is(public.service_renew_refund_purchase_correction(lpad('1',64,'0'),repeat('a',64))->>'state','ready','Expired link opens fresh targeted same-case capability');
select is(public.service_renew_refund_purchase_correction(lpad('1',64,'0'),repeat('a',64))->>'state','ready','Exact retry returns the same capability');
select is((select count(*)::integer from public.refund_wallet_correction_contexts where correction_renewed_from_id=(select id from public.refund_wallet_correction_contexts where token_hash=lpad('1',64,'0'))),1,'Only one child is created per recovery request');
select is(public.service_renew_refund_purchase_correction(lpad('1',64,'0'),repeat('b',64))->>'state','unavailable','A retry cannot substitute a new capability');
select is(public.service_get_refund_purchase_correction(repeat('a',64))#>>'{values,card_last4}','1234','Fresh form preserves saved card answer');
select is(public.service_get_refund_purchase_correction(repeat('a',64))#>'{requestedFields}','["amount"]'::jsonb,'Fresh form asks only the current needed field');
create function pg_temp.reply_source(n integer) returns uuid language plpgsql as $$
declare cid uuid:=('dc100000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid;
  mid uuid; tid uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid();
begin
  select correction_message_id into mid from public.refund_wallet_correction_contexts where token_hash=lpad(to_hex(n),64,'0');
  insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
    values(tid,cid,repeat('f',64),'renewal-reply-'||n,'Synthetic request',statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '30 days');
  insert into public.refund_gmail_messages(gmail_thread_id,refund_case_id,refund_case_message_id,provider_message_id,provider_message_header,
    direction,message_kind,status,sender_email,recipient_email,subject,plain_body,received_at,sent_at,retention_expires_at)
    values(tid,cid,mid,'renewal-outbound-'||n,'<renewal-outbound-'||n||'@example.invalid>','outbound','message','sent',
      'info@bloomjoysweets.com','scope-customer-'||n||'@example.invalid','Synthetic request','Saved original request',statement_timestamp(),statement_timestamp(),statement_timestamp()+interval '30 days');
  insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,references_header,direction,message_kind,status,
    sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
    values(gid,tid,cid,'renewal-inbound-'||n,'<renewal-outbound-'||n||'@example.invalid>','inbound','message','received',
      'scope-customer-'||n||'@example.invalid','info@bloomjoysweets.com','customer','verified','Synthetic reply','Amount: 8.00',statement_timestamp()+interval '1 minute',statement_timestamp()+interval '30 days');
  return gid;
end;
$$;
select is(public.service_receive_refund_scoped_email_reply('dc100000-0000-4000-8001-000000000003',pg_temp.reply_source(3))->>'outcome','received','Existing ordinary verified reply receiver remains composed and functional');
select is(public.service_receive_refund_scoped_email_reply('dc100000-0000-4000-8001-000000000001',pg_temp.reply_source(1))->>'outcome','no_current_request','Verified original-thread email cannot turn fresh form-only access into a free-text fact task');
select ok((select reply_message_id is null and reply_review_state is null from public.refund_wallet_correction_contexts where token_hash=repeat('a',64)),'Recovery child stays out of legacy email fact claims');
select ok((select count(*) from public.refund_cases)=(select cases from before_renewal)
  and (select count(*) from public.refund_case_messages)=(select messages from before_renewal)
  and (select count(*) from public.refund_follow_up_cycles)=(select cycles from before_renewal)
  and (select count(*) from public.refund_case_nayax_refund_attempts)=(select payments from before_renewal),'Recovery creates no case, outbound message, followup cycle or payment');
select is((select deterministic_fact_version from public.refund_cases where id='dc100000-0000-4000-8001-000000000001'),(select facts from before_renewal),'Recovery itself changes no purchase facts');
select throws_like($$select pg_temp.submit(1,'{"amount":{"disposition":"changed","value":"7.00"}}')$$,'%stale or unavailable%','Old expired capability cannot write after recovery');
select lives_ok($$select public.service_submit_refund_purchase_correction(repeat('a',64),(select facts from before_renewal),' {"amount":{"disposition":"changed","value":"7.00"}}')$$,'Fresh capability uses the existing atomic structured save');
select is((select payment_amount_cents from public.refund_cases where id='dc100000-0000-4000-8001-000000000001'),700,'Structured save updates the same case');
select is(public.service_get_refund_purchase_correction(repeat('a',64))->>'nextAction','recheck','Saved update schedules existing automatic research');
select is(public.service_renew_refund_purchase_correction(lpad('1',64,'0'),repeat('a',64))->>'state','unavailable','Stale ancestor cannot extend access after newer facts');
create temp table original_receipt as select correction_response,correction_snapshot,consumed_at,correction_resulting_fact_version
  from public.refund_wallet_correction_contexts where token_hash=repeat('a',64);
select is(public.service_renew_refund_purchase_correction(repeat('a',64),repeat('c',64))->>'state','ready','Submitted receipt opens fresh current-case update access');
select is(public.service_get_refund_purchase_correction(repeat('a',64))->>'state','received','Original submitted link remains a saved receipt');
select ok((select (correction_response,correction_snapshot,consumed_at,correction_resulting_fact_version) is not distinct from
  (select (correction_response,correction_snapshot,consumed_at,correction_resulting_fact_version) from original_receipt)
  from public.refund_wallet_correction_contexts where token_hash=repeat('a',64)),'Recovery preserves original response, snapshot, timestamp and resulting fact version');
select is(public.service_get_refund_purchase_correction(repeat('c',64))#>'{requestedFields}','[]'::jsonb,'Settled supplied answer is not asked again; saved details remain optional');
create temp table before_confirm as select deterministic_fact_version,status,correlation_status,nayax_recommendation_state,
  matched_nayax_transaction_id,nayax_lookup_generation from public.refund_cases where id='dc100000-0000-4000-8001-000000000001';
select throws_like($$select public.service_submit_refund_purchase_correction(repeat('c',64),(select deterministic_fact_version from before_confirm),'{}')$$,'%Requested answers required%','Empty optional review cannot submit or discard matching evidence');
select lives_ok($$select public.service_submit_refund_purchase_correction(repeat('c',64),(select deterministic_fact_version from before_confirm),'{"amount":{"disposition":"confirmed"}}')$$,'Customer may confirm one optional saved fact without repeating the old question');
select ok((select (deterministic_fact_version,status,correlation_status,nayax_recommendation_state,matched_nayax_transaction_id,nayax_lookup_generation) is not distinct from
  (select (deterministic_fact_version,status,correlation_status,nayax_recommendation_state,matched_nayax_transaction_id,nayax_lookup_generation) from before_confirm)
  from public.refund_cases where id='dc100000-0000-4000-8001-000000000001'),'Unchanged optional confirmation preserves purchase matching and fact version');
-- Open one current child after the confirmed receipt, then expire that child.
select is(public.service_renew_refund_purchase_correction(repeat('c',64),repeat('e',64))->>'state','ready','A later deliberate update reuses existing saved facts without a contact');
select lives_ok($$select public.service_submit_refund_purchase_correction(repeat('e',64),(select deterministic_fact_version from before_confirm),'{"card_last4_source":{"disposition":"cannot_provide"}}')$$,'New uncertainty about a saved card source follows existing atomic semantics');
select ok((select card_last4_source is null and card_last4_provenance is null and nayax_match_execution_eligible=false
  and deterministic_fact_version>(select deterministic_fact_version from before_confirm)
  from public.refund_cases where id='dc100000-0000-4000-8001-000000000001'),'Cannot-provide source clears prior physical-card proof and invalidates the matching version');
select is(public.service_get_refund_purchase_correction(repeat('e',64))->>'nextAction','review','Source uncertainty stays internal review, never a payment or guessed replacement');
select is(public.service_renew_refund_purchase_correction(repeat('e',64),repeat('f',64))->>'state','ready','Fresh access observes the saved uncertainty');
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=repeat('f',64);
select is(public.service_renew_refund_purchase_correction(repeat('e',64),repeat('f',64))->>'state','unavailable','Repeated ancestor request does not extend expired child access');
select is((select expires_at<statement_timestamp() from public.refund_wallet_correction_contexts where token_hash=repeat('f',64)),true,'Child expiry is retained on ancestor retry');
select is((select count(*)::integer from public.refund_wallet_correction_contexts where refund_case_id='dc100000-0000-4000-8001-000000000001' and correction_renewed_from_id is null),1,'Four customer-initiated updates still represent one delivered contact');
update public.refund_cases set payment_amount_cents=800 where id='dc100000-0000-4000-8001-000000000002';
select is(public.service_renew_refund_purchase_correction(lpad('2',64,'0'),repeat('d',64))->>'state','unavailable','Concurrent changed facts cannot be reopened through stale expired link');
update public.refund_wallet_correction_contexts set status='revoked' where token_hash=lpad('4',64,'0');
select is(public.service_renew_refund_purchase_correction(lpad('4',64,'0'),repeat('d',64))->>'state','unavailable','Intentionally revoked access is never resurrected');
update public.refund_cases set customer_email='different-customer@example.invalid' where id='dc100000-0000-4000-8001-000000000005';
select is(public.service_renew_refund_purchase_correction(lpad('5',64,'0'),repeat('d',64))->>'state','unavailable','Recipient change invalidates renewal');
select is(public.service_renew_refund_purchase_correction(lpad('6',64,'0'),repeat('d',64))->>'state','unavailable','Unknown transport outcome cannot grant recovery access');
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '49 hours',expires_at=statement_timestamp()-interval '1 hour' where token_hash=lpad('3',64,'0');
insert into public.refund_wallet_correction_contexts(refund_case_id,token_hash,version,status,expires_at)
  values('dc100000-0000-4000-8001-000000000003',repeat('d',64),2,'expired',statement_timestamp()+interval '48 hours');
select is(public.service_renew_refund_purchase_correction(lpad('3',64,'0'),repeat('b',64))->>'state','unavailable','A newer independent scope supersedes expired old access');
select * from finish();
rollback;
