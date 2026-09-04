begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('df000000-0000-4000-8000-000000000004','authenticated','authenticated','reply-manager@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active) values('df000000-0000-4000-8000-000000000004','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('df000000-0000-4000-8000-000000000001','Scoped reply fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('df000000-0000-4000-8000-000000000002','df000000-0000-4000-8000-000000000001','Reply fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('df000000-0000-4000-8000-000000000003','df000000-0000-4000-8000-000000000001','df000000-0000-4000-8000-000000000002','Reply fixture machine','commercial','active',true,'Reply fixture machine');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('df000000-0000-4000-8000-000000000003','df000000-0000-4000-8000-000000000004','reply-manager@example.invalid','Scoped reply test');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;
create function pg_temp.cid(n integer) returns uuid language sql as $$ select ('df000000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.gid(n integer) returns uuid language sql as $$ select ('df000000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.make_scope(n integer) returns void language plpgsql as $$
declare cid uuid:=pg_temp.cid(n); mid uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid(); cycle jsonb; fields text[];
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,status,correlation_status,intake_source)
  values(cid,'df000000-0000-4000-8000-000000000003','df000000-0000-4000-8000-000000000002','reply-customer@example.invalid','Scoped reply test',
    now()-interval '2 hours',to_char((now()-interval '2 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','card','tap_card',null,case when n in (8,15) then null else '1234' end,case when n in (8,15) then null else 'physical_card' end,'visa','needs_review','manual_review','form');
  cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
  if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
  fields:=public.refund_missing_follow_up_fields(cid);
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,'more_info','pending','reply-customer@example.invalid','Update your request','[Secure refund correction link included at delivery]',
    'deterministic_template','automatic','missing_information','refund_follow_up_v2',(cycle#>>'{cycle,id}')::uuid,fields);
  perform public.service_issue_refund_purchase_correction(mid,lpad(to_hex(n),64,'0'),(select deterministic_fact_version from public.refund_cases where id=cid));
  insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
  values(tid,cid,repeat('f',64),'scoped-reply-thread-'||n,'Scoped reply test',now(),now(),now()+interval '30 days');
  if n=15 then
    perform public.service_mark_refund_transactional_delivery_attempt(mid);
    perform public.service_bind_refund_transactional_delivery(mid,'scoped-resend-request-'||n,statement_timestamp());
  else
  insert into public.refund_gmail_messages(gmail_thread_id,refund_case_id,refund_case_message_id,provider_message_id,provider_message_header,
    direction,message_kind,status,sender_email,recipient_email,subject,plain_body,received_at,sent_at,retention_expires_at)
  values(tid,cid,mid,'scoped-request-'||n,'<scoped-request-'||n||'@example.invalid>','outbound','message','sent',
    'info@bloomjoysweets.com','reply-customer@example.invalid','Update your request','Scoped request',now(),now(),now()+interval '30 days');
  end if;
  update public.refund_case_messages set status='sent',sent_at=now() where id=mid;
  insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,references_header,direction,message_kind,status,
    sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
  values(pg_temp.gid(n),tid,cid,'scoped-reply-'||n,'<scoped-request-'||n||'@example.invalid>','inbound','message','received',
    'reply-customer@example.invalid','info@bloomjoysweets.com','customer','verified','Reply','Amount: 7.00',now()+interval '1 minute',now()+interval '30 days');
end; $$;
create function pg_temp.apply_reply(n integer) returns jsonb language sql as $$
  select public.service_apply_refund_gmail_customer_facts_v1(pg_temp.cid(n),pg_temp.gid(n),
    (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(n)),
    '{"payment_amount_cents":700,"refund_amount_cents":700}',array['amount'],'labeled_routine_facts_v1');
$$;
select pg_temp.make_scope(n) from generate_series(1,16) n;
select is(pg_temp.apply_reply(1)->>'outcome','applied','Current scoped reply uses the original supported fact writer');
select is((select status from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),'submitted','Email settles the same current correction request');
select is(public.service_get_refund_purchase_correction(lpad('1',64,'0'))->>'state','received','Old correction link shows received, not stale or a second task');
select is((select correction_response from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  '{"amount":{"disposition":"changed","value":"7.00"}}'::jsonb,'Only verified applied facts are recorded as answers');
select is((select status from public.refund_follow_up_cycles where refund_case_id=pg_temp.cid(1)),'manual_review','Existing reminder cycle stops');
select is(pg_temp.apply_reply(1)->>'outcome','already_applied','Replay returns original fact application');
select is((select count(*)::integer from public.refund_case_events where refund_case_id=pg_temp.cid(1) and event_type='purchase_correction_email_received'),1,'Replay adds no second response event');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(1)),1,'Replay preserves one immutable fact receipt');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id=pg_temp.cid(1)),1,'No new customer message');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id=pg_temp.cid(1)),0,'No payment action');
select is((select correction_snapshot ? 'amount' from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),false,'Original missing-amount snapshot is preserved');

update public.refund_gmail_messages set participant_trust='unverified' where id=pg_temp.gid(2);
select is(pg_temp.apply_reply(2)->>'outcome','conflict','Unverified reply cannot change facts or settle request');
update public.refund_gmail_messages set participant_role='assigned_manager' where id=pg_temp.gid(3);
select is(pg_temp.apply_reply(3)->>'outcome','conflict','Same-thread manager reply cannot settle customer request');
update public.refund_gmail_messages set sender_email='someone-else@example.invalid' where id=pg_temp.gid(4);
select is(pg_temp.apply_reply(4)->>'outcome','conflict','Reassigned customer identity cannot settle request');
update public.refund_gmail_messages set received_at=now()-interval '1 minute' where id=pg_temp.gid(5);
select is(pg_temp.apply_reply(5)->>'outcome','conflict','Reply preceding request cannot answer current scope');
update public.refund_cases set card_network='mastercard' where id=pg_temp.cid(6);
select is(pg_temp.apply_reply(6)->>'outcome','conflict','Stale scope cannot overwrite newer case facts');
update public.refund_gmail_messages set references_header='<old-request@example.invalid>' where id=pg_temp.gid(7);
select is(pg_temp.apply_reply(7)->>'outcome','conflict','Wrong exact request in the same Gmail thread is rejected');
select is(pg_temp.apply_reply(8)->>'outcome','applied','Supported partial reply is accepted once');
select ok((select correction_response ? 'amount' and not correction_response ? 'card_last4' and correction_next_action='review'
  from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(8)),'Partial response does not claim unanswered card digits were supplied');
select ok('card_last4'=any(public.refund_purchase_correction_request_fields(pg_temp.cid(8)))
  and not 'amount'=any(public.refund_purchase_correction_request_fields(pg_temp.cid(8))),'Only unanswered fields remain; answered amount is not asked again');
select is((select status from public.refund_follow_up_cycles where refund_case_id=pg_temp.cid(8)),'manual_review','Partial response stops obsolete reminders and leaves internal review');
select throws_like($$select public.service_apply_refund_gmail_customer_facts_v1(pg_temp.cid(9),pg_temp.gid(9),1,'{}','{}','labeled_routine_facts_v1')$$,
  '%At least one approved applied field%','Unparsed reply cannot fabricate an applied response');
select is((select status from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9)),'pending','Unparsed reply does not mark fields answered');
update public.refund_gmail_messages set gmail_thread_id=(select gmail_thread_id from public.refund_gmail_messages where id=pg_temp.gid(1)) where id=pg_temp.gid(10);
select is(pg_temp.apply_reply(10)->>'outcome','conflict','Foreign thread cannot settle current request');
update public.refund_gmail_messages set received_at=now() where id=pg_temp.gid(11);
select public.service_submit_refund_purchase_correction(lpad('b',64,'0'),1,'{"amount":{"disposition":"changed","value":"9.00"}}');
select is(pg_temp.apply_reply(11)->>'outcome','conflict','Email older than accepted form cannot overwrite its facts');
select is((select payment_amount_cents from public.refund_cases where id=pg_temp.cid(11)),900,'Form response is not rewound');

do $$ declare queued jsonb; mid uuid; claimed record; begin
  update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now() where refund_case_id=pg_temp.cid(12);
  queued:=public.service_enqueue_refund_manual_message_intent(pg_temp.cid(12),(select official_action_version from public.refund_cases where id=pg_temp.cid(12)),
    gen_random_uuid(),'df000000-0000-4000-8000-000000000004','more_info','reply-customer@example.invalid','Updated request','[Secure refund correction link included at delivery]',
    'refund_more_info_editable_v1','manager_authored','missing_information',array['amount'],null,false,null);
  mid:=(queued->>'messageId')::uuid;
  perform public.service_issue_refund_purchase_correction(mid,repeat('c',64),1);
  select * into claimed from public.service_claim_refund_manual_message_deliveries(mid,1);
  perform public.service_mark_refund_manual_message_provider_attempt(mid,claimed.claim_token);
  insert into public.refund_gmail_messages(gmail_thread_id,refund_case_id,refund_case_message_id,provider_message_id,provider_message_header,
    direction,message_kind,status,sender_email,recipient_email,subject,plain_body,received_at,sent_at,retention_expires_at)
  select gmail_thread_id,refund_case_id,mid,'replacement-request','<replacement-request@example.invalid>','outbound','message','sent',
    'info@bloomjoysweets.com','reply-customer@example.invalid','Updated request','Updated request',now(),now(),now()+interval '30 days'
    from public.refund_gmail_messages where id=pg_temp.gid(12);
  perform public.service_finish_refund_manual_message_delivery(mid,claimed.claim_token,'sent','gmail_thread',null,1,'mapped_manager');
end; $$;
select is(pg_temp.apply_reply(12)->>'outcome','conflict','Reply to explicitly revoked old scope cannot settle replacement even with unchanged fact version');
select is((select status from public.refund_wallet_correction_contexts where token_hash=repeat('c',64)),'pending','Replacement remains unanswered');
update public.refund_gmail_messages set references_header=null where id=pg_temp.gid(13);
select is(pg_temp.apply_reply(13)->>'outcome','conflict','Missing request headers do not invent exact binding');
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now() where refund_case_id=pg_temp.cid(14);
select is(pg_temp.apply_reply(14)->>'reason','scoped_reply_superseded','Revoked request reply cannot slip into legacy facts before replacement capability is issued');
select is((select payment_amount_cents from public.refund_cases where id=pg_temp.cid(14)),null::integer,'Superseded queued-replacement gap preserves original facts');
-- Reproduce the cross-transport replacement gap through real outbox enqueue.
-- The manager revision migration runs later; its atomic revoke/enqueue state
-- must be safe even before a new capability exists, without a Gmail send row.
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now() where refund_case_id=pg_temp.cid(15);
select public.service_enqueue_refund_manual_message_intent(pg_temp.cid(15),(select official_action_version from public.refund_cases where id=pg_temp.cid(15)),
  gen_random_uuid(),'df000000-0000-4000-8000-000000000004','more_info','reply-customer@example.invalid','Revised amount request',
  '[Secure refund correction link included at delivery]','refund_more_info_editable_v1','manager_authored','missing_information',array['amount'],null,false,null);
update public.refund_gmail_messages set references_header=null,
  subject=(select public_reference from public.refund_cases where id=pg_temp.cid(15)) where id=pg_temp.gid(15);
select is((select count(*)::integer from public.refund_gmail_messages where refund_case_id=pg_temp.cid(15) and direction='outbound'),0,'Resend fixture has no Gmail outbound header to bind');
select is(pg_temp.apply_reply(15)->>'reason','scoped_reply_superseded','Headerless old Resend reply cannot enter legacy facts while replacement is queued');
select ok((select payment_amount_cents is null from public.refund_cases where id=pg_temp.cid(15))
 and (select count(*)=0 from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(15)),'Revoked Resend gap preserves facts and application ledger');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id=pg_temp.cid(15) and status='pending'),1,'Existing replacement intent remains the single queued message');
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now() where refund_case_id=pg_temp.cid(16);
update public.refund_gmail_messages set sent_at=null where refund_case_id=pg_temp.cid(16) and direction='outbound';
select is(pg_temp.apply_reply(16)->>'reason','scoped_reply_superseded','Historical sent Gmail record retains received-at fallback and cannot reopen revoked scope');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id=any(array[pg_temp.cid(2),pg_temp.cid(3),pg_temp.cid(4),pg_temp.cid(5),pg_temp.cid(6),pg_temp.cid(7),pg_temp.cid(9),pg_temp.cid(10),pg_temp.cid(12),pg_temp.cid(13)])),0,'Rejected replies produce no fact application');
select ok(not has_function_privilege('anon','public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute')
 and not has_function_privilege('authenticated','public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute'),'Existing service-only boundary remains');
select * from finish();
rollback;
