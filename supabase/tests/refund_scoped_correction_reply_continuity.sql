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
declare cid uuid:=pg_temp.cid(n); mid uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid(); cycle jsonb; fields text[]; lookup_receipt jsonb; lookup_result jsonb;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,card_wallet_used,status,correlation_status,intake_source)
  values(cid,'df000000-0000-4000-8000-000000000003','df000000-0000-4000-8000-000000000002','reply-customer@example.invalid','Scoped reply test',
    now()-interval '2 hours'-n*interval '7 hours',to_char((now()-interval '2 hours'-n*interval '7 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles','exact','exact','card',case when n in (27,28,29,38,42) then 'phone_watch_wallet' else 'tap_card' end,case when n in (34,43) then 1090 when n in (27,28,29,30) then 700 else null end,case when n in (8,15,27,28,29,30,34,38,42) then null else '1234' end,case when n in (8,15,27,28,29,30,34,38,42) then null else 'physical_card' end,case when n=26 then 'mastercard' else 'visa' end,n in (27,28,29,38,42),'needs_review','manual_review','form');
  if n in (27,28) then
    -- The earlier provider read precedes the delivered wallet question. A
    -- waiting-on-customer case cannot start an ordinary lookup afterward.
    lookup_receipt:=public.service_begin_refund_nayax_lookup(cid,
      (select deterministic_fact_version from public.refund_cases where id=cid),
      'scheduled',null);
    lookup_result:=public.service_commit_refund_nayax_lookup(cid,
      (lookup_receipt->>'lookupGeneration')::bigint,
      (select deterministic_fact_version from public.refund_cases where id=cid),
      'no_match','no_safe_match','reply-fixture-v1',statement_timestamp(),
      'Earlier read-only check found no safe purchase.',null,0,'scheduled',null);
    if lookup_result->>'applied' is distinct from 'true' then
      raise exception 'Fixture prior lookup rejected: %',lookup_result;
    end if;
  end if;
  if n in (27,28,29,38,42) then
    -- Wallet detail is a scoped correction request, not the ordinary
    -- missing-information cycle, whose production guard rejects wallet work.
    fields:=array['wallet_provider']::text[];
  else
    cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
    if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
    fields:=public.refund_missing_follow_up_fields(cid);
  end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,case when n in (27,28,29,38,42) then 'wallet_correction' else 'more_info' end,'pending','reply-customer@example.invalid','Update your request','[Secure refund correction link included at delivery]',
    'deterministic_template','automatic',case when n in (27,28,29,38,42) then null else 'missing_information' end,
    case when n in (27,28,29,38,42) then 'refund_wallet_correction_v1' else 'refund_follow_up_v2' end,
    (cycle#>>'{cycle,id}')::uuid,fields);
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
savepoint resend_receiver_control;
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(15),pg_temp.gid(15))->>'outcome',
  'request_delivery_unverified',
  'A Resend-backed reply without the public reference cannot bind the request');
update public.refund_gmail_messages set subject=(select public_reference
  from public.refund_cases where id=pg_temp.cid(15)) where id=pg_temp.gid(15);
select is((select delivery_transport='resend' and provider_message_id is not null
    and delivery_state in ('accepted','deferred','delivered')
    from public.refund_case_messages where refund_case_id=pg_temp.cid(15)),true,
  'Fallback uses one guarded accepted Resend request and no Gmail outbound row');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(15),pg_temp.gid(15))->>'outcome',
  'received', 'Verified same-case Resend reply with the public reference creates the exact task');
select is((select reply_message_id from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(15)),pg_temp.gid(15),
  'Resend fallback binds the verified message to the issued correction context');
rollback to savepoint resend_receiver_control;
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
update public.refund_cases set status='waiting_on_customer',automation_state='more_info_needed' where id=pg_temp.cid(9);
update public.refund_gmail_messages set plain_body='I replied above; please review my earlier note.' where id=pg_temp.gid(9);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(9),pg_temp.gid(9))->>'outcome',
  'received','Verified unstructured reply binds the exact delivered request without a fact claim');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(9),pg_temp.gid(9))->>'outcome',
  'already_received','Same-message replay does not create a second review task');
select ok((select status='needs_review' and automation_state='customer_reply_review'
  from public.refund_cases where id=pg_temp.cid(9)),'Verified reply atomically clears customer waiting');
select ok((select reply_review_state='pending' and reply_review_due_at is not null
  and correction_response is null and status='pending'
  from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9)),
  'Original request carries one due internal task without fabricated answers');
select is(public.refund_customer_outreach_contract(pg_temp.cid(9))->>'state','customer_replied',
  'Canonical outreach no longer calls a verified respondent Waiting for customer');
select is(public.refund_customer_outreach_contract(pg_temp.cid(9))->>'owner','System',
  'Unstructured reply belongs to internal System review, not manager decision');
select is(public.refund_customer_outreach_contract(pg_temp.cid(9))->>'nextAction',
  'recheck_customer_reply','Public next action stays inside the strict outreach vocabulary');
select is((select count(*)::integer
  from public.service_list_refund_follow_up_customer_reply_candidates(25) candidate
  where candidate.refund_case_id=pg_temp.cid(9)),0,
  'Generic bounded reply page excludes the exact scoped request before LIMIT');
select is(public.service_claim_refund_follow_up_customer_reply(
    pg_temp.cid(9),(select id from public.refund_follow_up_cycles
      where refund_case_id=pg_temp.cid(9)))->>'reason',
  'scoped_purchase_reply_owned_by_system',
  'Generic claim recheck cannot turn scoped free text into Manager review');
select ok(not (public.refund_customer_outreach_contract(pg_temp.cid(9)) ?| array[
  'replyReviewDueAt','replyReviewState']),
  'Service-only due and claim state do not expand the strict public wire shape');
create temp table scoped_reply_claim as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task;
select is((select count(*)::integer from scoped_reply_claim),1,
  'Scheduled selector claims one exact-request research task');
select is((select reply_review_state from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9)),
  'claimed','Claim persists until an actual research outcome exists');
select is((public.service_claim_refund_scoped_reply_reviews(25)->'tasks')::text,'[]',
  'Concurrent worker cannot re-claim the live research lease');
select is((select task->>'bodySha256' from scoped_reply_claim),
  public.refund_scoped_verified_reply_set((select (task->>'requestId')::uuid
    from scoped_reply_claim))->>'bodySha256',
  'Claim binds the exact verified reply set without returning its content');
select is(public.service_get_refund_scoped_reply_research_input(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim))->>'replyBody',
  'I replied above; please review my earlier note.',
  'Only the exact service claim can read the verified reply for research');
select is(public.service_get_refund_scoped_reply_research_input(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    gen_random_uuid(),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim))->>'outcome',
  'stale_claim','Another worker cannot read the claim-bound reply body');
select ok(not has_function_privilege('authenticated',
    'public.service_get_refund_scoped_reply_research_input(uuid,uuid,uuid,bigint,text)',
    'execute'),
  'Research input containing customer content is service-only');
select ok((select public.service_get_refund_scoped_reply_research_input(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,pg_temp.gid(9),
    (task->>'factVersion')::bigint,task->>'bodySha256'
  )->'researchEvidence' ?& array['recentEvents','currentCardCandidates','lookupStatus']
  from scoped_reply_claim),
  'Claim-bound interpreter receives bounded case history and read-only purchase evidence');
savepoint source_bound_no_fact;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),pg_temp.gid(9),
    'I replied above; please review my earlier note.','no_supported_new_fact')->>'outcome',
  'reviewed_no_fact','Grounded ordinary free text finishes one System reply review');
select ok((select reply_review_state='resolved' and reply_review_result_code='no_supported_new_fact'
    from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9))
  and (select status='needs_review' from public.refund_cases where id=pg_temp.cid(9))
  and (select count(*)=0 from public.refund_case_nayax_refund_attempts
    where refund_case_id=pg_temp.cid(9))
  and (select count(*)=1 from public.refund_case_messages where refund_case_id=pg_temp.cid(9)),
  'No-new-fact research clears Customer wait without a Manager, message or payment action');
select is(public.refund_customer_outreach_contract(pg_temp.cid(9))->>'owner','System',
  'Completed no-fact review remains System-owned rather than a customer re-question');
select is(public.service_get_refund_scoped_reply_research_health()
    ->>'stableEvidenceDependencyCount','1',
  'No-new-fact result is visible as a stable owned evidence dependency');
select is((public.service_claim_refund_scoped_reply_reviews(25)->'tasks')::text,'[]',
  'Unchanged evidence does not requeue the same interpretation on the next sweep');
update public.refund_cases set nayax_lookup_generation=1,
  nayax_lookup_status='no_match',nayax_lookup_finished_at=statement_timestamp()
  where id=pg_temp.cid(9);
select is((select reply_review_state from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(9)),'pending',
  'A completed read-only card research result reopens the same source-bound task');
create temp table changed_evidence_claim on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task;
select is((select count(*)::integer from changed_evidence_claim),1,
  'Second cycle has one real fresh-evidence claim, not a parallel customer request');
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from changed_evidence_claim),
    (select (task->>'claimToken')::uuid from changed_evidence_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from changed_evidence_claim),
    (select task->>'bodySha256' from changed_evidence_claim),pg_temp.gid(9),
    'I replied above; please review my earlier note.','no_supported_new_fact')->>'outcome',
  'reviewed_no_fact','Second evidence cycle records an honest stable dependency');
select is((public.service_claim_refund_scoped_reply_reviews(25)->'tasks')::text,'[]',
  'Two cycles do not create permanent hourly due churn without new evidence');
rollback to savepoint source_bound_no_fact;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    gen_random_uuid(),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),pg_temp.gid(9),
    'I replied above; please review my earlier note.','no_supported_new_fact')->>'outcome',
  'stale_or_unsupported_source','A stolen or expired review claim cannot finish free-text research');
savepoint decided_reply_scope;
update public.refund_cases set status='denied',decision='denied',
  official_action_version=official_action_version+1 where id=pg_temp.cid(9);
select is(public.service_get_refund_scoped_reply_research_input(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim))->>'outcome',
  'stale_claim','An official decision revokes a live semantic research read');
select is(public.service_defer_refund_scoped_reply_review(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),
    'research_result_unresolved')->>'outcome','stale_claim',
  'An obsolete decision-scoped reply cannot be deferred as current work');
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),pg_temp.gid(9),
    'I replied above; please review my earlier note.','no_supported_new_fact')->>'outcome',
  'stale_or_unsupported_source','An old reply cannot finish after a Manager decision');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),
    jsonb_build_array(jsonb_build_object('field','amount','messageId',pg_temp.gid(9),
      'quote','I replied above; please review my earlier note.')),
    '{"payment_amount_cents":700,"refund_amount_cents":700}'::jsonb,array['amount'])
    ->>'outcome','stale_or_unsupported_source',
  'A stale semantic proposal cannot write a fact after the final decision');
select is((public.service_claim_refund_scoped_reply_reviews(25)->'tasks')::text,'[]',
  'Current claim page excludes obsolete decided tasks before bounded selection');
select is((select reply_review_result_code from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(9)),'superseded_by_current_case',
  'Decision transition records an internal supersession instead of an endless due task');
rollback to savepoint decided_reply_scope;
savepoint newer_read_only_evidence;
update public.refund_cases set correlation_status='no_match' where id=pg_temp.cid(9);
select is(public.service_get_refund_scoped_reply_research_input(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim))->>'outcome',
  'stale_claim','Read-only case evidence invalidates the old interpreter claim');
create temp table rebound_evidence_claim on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task;
select is((select count(*)::integer from rebound_evidence_claim),1,
  'An undecided case receives one fresh claim after newer evidence, not abandonment');
select isnt((select task->>'claimToken' from rebound_evidence_claim),
  (select task->>'claimToken' from scoped_reply_claim),
  'Evidence-version rebinding revokes the former live claim token');
rollback to savepoint newer_read_only_evidence;
select is(public.service_defer_refund_scoped_reply_review(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    gen_random_uuid(),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),
    'provider_unavailable')->>'outcome','stale_claim',
  'A different worker cannot defer the live claim');
select is(public.service_defer_refund_scoped_reply_review(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    repeat('0',64),'provider_unavailable')->>'outcome','stale_claim',
  'Changed reply content cannot settle the body-bound claim');
update public.refund_gmail_messages set plain_body='A different body after claim'
where id=pg_temp.gid(9);
select is(public.service_defer_refund_scoped_reply_review(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),
    'provider_unavailable')->>'outcome','stale_claim',
  'A modified verified reply cannot be settled under the old body hash');
update public.refund_gmail_messages set plain_body='I replied above; please review my earlier note.'
where id=pg_temp.gid(9);
select is(public.service_defer_refund_scoped_reply_review(
    (select (task->>'requestId')::uuid from scoped_reply_claim),
    (select (task->>'claimToken')::uuid from scoped_reply_claim),pg_temp.gid(9),
    (select (task->>'factVersion')::bigint from scoped_reply_claim),
    (select task->>'bodySha256' from scoped_reply_claim),
    'provider_configuration_missing')->>'outcome','deferred',
  'Missing model configuration leaves ordinary verified reply durably due for retry');
select ok((select reply_review_state='pending' and reply_review_due_at>statement_timestamp()
    and reply_review_result_code='provider_configuration_missing'
    and reply_review_attempt_count=1
    from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9)),
  'Provider absence is a visible pending task, not a completed research result');
select is(public.service_get_refund_scoped_reply_research_health()
  ->> 'providerConfigurationCount','1',
  'Provider configuration absence appears in redacted reply research health');
select is(public.service_get_refund_scoped_reply_research_health()
  ->> 'status','action_needed',
  'A pending configuration failure cannot look healthy during retry delay');
update public.refund_wallet_correction_contexts set reply_review_due_at=statement_timestamp()
where refund_case_id=pg_temp.cid(9);
select is(jsonb_array_length(public.service_claim_refund_scoped_reply_reviews(25)->'tasks'),1,
  'Scheduled retry reclaims the same request after the bounded delay');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,references_header,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
select pg_temp.gid(17),gmail_thread_id,refund_case_id,'scoped-reply-17',references_header,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,subject,
  'Amount: 7.00',received_at+interval '1 minute',retention_expires_at
  from public.refund_gmail_messages where id=pg_temp.gid(9);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(9),pg_temp.gid(17))->>'outcome',
  'received','A later verified reply refreshes the same request task');
select is((select count(*)::integer from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(9) and reply_review_state='pending'),1,
  'The later reply invalidates the old claim without making a parallel task');
savepoint source_bound_semantic_fact;
create temp table semantic_reply_claim on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(9)::text;
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from semantic_reply_claim),
    (select (task->>'claimToken')::uuid from semantic_reply_claim),pg_temp.gid(17),
    (select (task->>'factVersion')::bigint from semantic_reply_claim),
    (select task->>'bodySha256' from semantic_reply_claim),
    jsonb_build_array(jsonb_build_object('field','amount','messageId',pg_temp.gid(17),
      'quote','Amount: 7.00')),
    '{"payment_amount_cents":700,"refund_amount_cents":700}'::jsonb,
    array['amount'])->>'outcome','applied',
  'Source-bound semantic interpretation uses the existing immutable fact writer');
select ok((select extraction_policy='verified_reply_semantic_v1'
    from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(9))
  and (select reply_review_state='resolved' from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(9)),
  'The semantic fact carries an explicit receipt policy and closes the exact review');
rollback to savepoint source_bound_semantic_fact;
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(9),pg_temp.gid(9))->>'outcome',
  'already_received','Replay of an earlier message does not replace the latest task input');
select is(public.service_apply_refund_gmail_customer_facts_v1(pg_temp.cid(9),pg_temp.gid(17),
  (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(9)),
  '{"payment_amount_cents":700,"refund_amount_cents":700}',array['amount'],'labeled_customer_correction_v3')->>'outcome',
  'applied','Later parseable answer still uses the original fact writer and request');
select is((select reply_review_state from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(9)),
  'resolved','A later safe fact application closes the earlier internal review task');
select is(public.service_get_refund_scoped_reply_research_health()
  ->> 'pendingCount','0',
  'A genuine applied fact receipt clears the pending reply research obligation');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(9)),1,
  'Two verified replies produce one fact application');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(2),pg_temp.gid(2))->>'outcome',
  'unverified','Unverified sender cannot create a reply task');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(7),pg_temp.gid(7))->>'outcome',
  'request_thread_mismatch','Wrong exact outbound header cannot create a reply task');
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
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id=any(array[pg_temp.cid(2),pg_temp.cid(3),pg_temp.cid(4),pg_temp.cid(5),pg_temp.cid(6),pg_temp.cid(7),pg_temp.cid(10),pg_temp.cid(12),pg_temp.cid(13)])),0,'Rejected replies produce no fact application');
-- Stored replies may predate the new Gmail ingestion call. The scheduled
-- reconciler must seed the exact existing request once, even without an
-- active follow-up cycle, and never reinterpret a foreign or stale reply.
select pg_temp.make_scope(n) from generate_series(18,20) n;
select pg_temp.make_scope(n) from generate_series(22,24) n;
update public.refund_cases set status='waiting_on_customer',automation_state='more_info_needed'
where id in (pg_temp.cid(18),pg_temp.cid(19),pg_temp.cid(20));
update public.refund_follow_up_cycles set status='manual_review'
where refund_case_id=pg_temp.cid(18);
update public.refund_gmail_messages set plain_body='I answered in my own words above.'
where id=pg_temp.gid(18);
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,references_header,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
select pg_temp.gid(21),gmail_thread_id,refund_case_id,'scoped-reply-21',references_header,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,subject,
  'My second answer gives more detail.',received_at+interval '1 minute',retention_expires_at
from public.refund_gmail_messages where id=pg_temp.gid(18);
update public.refund_gmail_messages set references_header='<unrelated-request@example.invalid>'
where id=pg_temp.gid(19);
update public.refund_cases set card_network='mastercard' where id=pg_temp.cid(20);
update public.refund_gmail_messages set participant_trust='unverified' where id=pg_temp.gid(22);
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now()
where refund_case_id=pg_temp.cid(23);
update public.refund_cases set status='closed' where id=pg_temp.cid(24);
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '30 minutes'
where refund_case_id=pg_temp.cid(19);
select is(public.service_reconcile_stored_refund_scoped_email_replies(1)->>'examinedCount','1',
  'Default dry run identifies only a current exact-request historical reply without exposing IDs');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(18)),
  'Read-only historical audit does not mutate the waiting request');
select is(public.service_reconcile_stored_refund_scoped_email_replies(1,false)->>'receivedCount','1',
  'Older unclaimable rows cannot starve the latest exact historical reply behind the sync cursor');
select ok((select status='needs_review' and automation_state='customer_reply_review'
  from public.refund_cases where id=pg_temp.cid(18)),
  'Historical reply clears Customer waiting without an active follow-up cycle');
select is((select reply_message_id from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(18)),pg_temp.gid(21),
  'Historical recovery binds the latest verified message to the existing request');
select is((select reply_body_sha256 from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(18)),
  public.refund_scoped_verified_reply_set((select id
    from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(18)))->>'bodySha256',
  'Claim identity preserves all verified historical reply bodies');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id=pg_temp.cid(18)
    and event_type='purchase_correction_verified_email_received'),1,
  'Historical recovery emits one request-bound receipt event');
select is(public.service_reconcile_stored_refund_scoped_email_replies(25,false)->>'receivedCount','0',
  'Second historical reply and repeated sweep cannot duplicate the request task');
select is((select count(*)::integer from public.refund_case_events
  where refund_case_id=pg_temp.cid(18)
    and event_type='purchase_correction_verified_email_received'),1,
  'Repeated historical recovery adds no duplicate receipt');
create temp table historical_reply_claim as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(18)::text;
select is((select jsonb_array_length(public.service_get_refund_scoped_reply_research_input(
    (h.task->>'requestId')::uuid,(h.task->>'claimToken')::uuid,
    (h.task->>'sourceMessageId')::uuid,(h.task->>'factVersion')::bigint,
    h.task->>'bodySha256')->'replyMessages') from historical_reply_claim h),2,
  'Research input retains both verified historical free-text replies');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,
  provider_message_id,references_header,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,
  plain_body,received_at,retention_expires_at)
select pg_temp.gid(25),gmail_thread_id,refund_case_id,'scoped-reply-25',
  references_header,direction,message_kind,status,sender_email,recipient_email,
  participant_role,participant_trust,subject,
  'I also remember the purchase was in the afternoon.',
  received_at+interval '1 minute',retention_expires_at
from public.refund_gmail_messages where id=pg_temp.gid(21);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(18),pg_temp.gid(25))->>'outcome',
  'received', 'A later verified free-text reply refreshes the same request task');
select is((select reply_message_id from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(18)),pg_temp.gid(25),
  'The task points at the latest reply without discarding earlier messages');
select is((select reply_review_state from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(18)),'pending',
  'Later content invalidates the prior claim and remains due for research');
select is((select public.service_get_refund_scoped_reply_research_input(
    (h.task->>'requestId')::uuid,(h.task->>'claimToken')::uuid,
    (h.task->>'sourceMessageId')::uuid,(h.task->>'factVersion')::bigint,
    h.task->>'bodySha256')->>'outcome' from historical_reply_claim h),
  'stale_claim','Prior worker cannot research or settle an obsolete reply set');
create temp table refreshed_reply_claim as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(18)::text;
select is((select jsonb_array_length(public.service_get_refund_scoped_reply_research_input(
    (h.task->>'requestId')::uuid,(h.task->>'claimToken')::uuid,
    (h.task->>'sourceMessageId')::uuid,(h.task->>'factVersion')::bigint,
    h.task->>'bodySha256')->'replyMessages') from refreshed_reply_claim h),3,
  'Fresh claim reads all three verified replies for the same current request');
select is(public.service_reconcile_stored_refund_scoped_email_replies(25,false)->>'receivedCount','0',
  'Replay of the enlarged verified reply set creates no duplicate task');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(19)) and
  (select status='waiting_on_customer' from public.refund_cases where id=pg_temp.cid(19)),
  'Unrelated later thread cannot seed a task or clear the exact customer wait');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(20)) and
  (select status='waiting_on_customer' from public.refund_cases where id=pg_temp.cid(20)),
  'Stale fact version cannot seed a historical reply task');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(22)),
  'Unverified participant cannot seed a historical reply task');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(23)),
  'Superseded request cannot be reopened by an old reply');
select ok((select reply_message_id is null from public.refund_wallet_correction_contexts
  where refund_case_id=pg_temp.cid(24)),
  'Closed case cannot be reopened by an old reply');
select ok(not has_function_privilege('authenticated',
  'public.service_reconcile_stored_refund_scoped_email_replies(integer,boolean)','execute'),
  'Historical reply reconciliation remains service-only');
select ok(not has_function_privilege('anon','public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute')
 and not has_function_privilege('authenticated','public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)','execute'),'Existing service-only boundary remains');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_scoped_reply_research_health()','execute'),
  'Customer-content research health is visible only to the service worker');
savepoint ordinary_network_semantic_fact;
select pg_temp.make_scope(26);
update public.refund_gmail_messages set plain_body='My card is Visa.'
  where id=pg_temp.gid(26);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(26),pg_temp.gid(26))->>'outcome',
  'received','Ordinary card-network prose creates one current verified task');
create temp table network_reply_claim on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(26)::text;
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from network_reply_claim),
    (select (task->>'claimToken')::uuid from network_reply_claim),pg_temp.gid(26),
    (select (task->>'factVersion')::bigint from network_reply_claim),
    (select task->>'bodySha256' from network_reply_claim),
    jsonb_build_array(jsonb_build_object('field','card_network','messageId',pg_temp.gid(26),
      'quote','My card is Visa')),
    '{"card_network":"visa"}'::jsonb,array['card_network'])
    ->>'outcome','applied','Existing fact receipt accepts source-bound ordinary card network');
select ok((select card_network='visa' from public.refund_cases where id=pg_temp.cid(26))
  and (select extraction_policy='verified_reply_semantic_v1'
    from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(26)),
  'Card-network research advances real facts without Manager approval or payment');
rollback to savepoint ordinary_network_semantic_fact;
savepoint wallet_token_semantic_fact;
select pg_temp.make_scope(29);
update public.refund_gmail_messages set plain_body=
  'The 4932 digits are an Apple Pay device token, not my physical card number.'
  where id=pg_temp.gid(29);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(29),pg_temp.gid(29))
  ->>'outcome','received','Wallet provenance reply creates one exact current task');
create temp table wallet_fact_claim on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(29)::text;
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from wallet_fact_claim),
    (select (task->>'claimToken')::uuid from wallet_fact_claim),pg_temp.gid(29),
    (select (task->>'factVersion')::bigint from wallet_fact_claim),
    (select task->>'bodySha256' from wallet_fact_claim),
    jsonb_build_array(jsonb_build_object('field','wallet_token_last4',
      'messageId',pg_temp.gid(29),
      'quote','The 4932 digits are an Apple Pay device token')),
    '{"card_last4":"4932","card_last4_provenance":"wallet_device_token", "card_wallet_used":true,"payment_interaction":"phone_watch_wallet"}'::jsonb,
    array['card_last4'])->>'outcome','applied',
  'Source-bound wallet token applies through the original immutable fact writer');
select ok((select card_last4='4932' and card_last4_provenance='wallet_device_token'
    and card_wallet_used and payment_interaction='phone_watch_wallet'
    from public.refund_cases where id=pg_temp.cid(29))
  and (select extraction_policy='verified_reply_semantic_v1'
    from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(29)),
  'Wallet device token never masquerades as a physical-card identifier');
rollback to savepoint wallet_token_semantic_fact;
savepoint directional_reply_lookup;
update public.reporting_machines set nayax_machine_id='REPLY-TEST-27',
  nayax_account_key='REPLY_ACCOUNT',nayax_manual_portal_enabled=false
  where id='df000000-0000-4000-8000-000000000003';
select pg_temp.make_scope(27);
select ok((select nayax_lookup_status='no_match' and nayax_lookup_finished_at is not null
    from public.refund_cases where id=pg_temp.cid(27)),
  'A completed prior automatic no-match is real research evidence');
update public.refund_gmail_messages set plain_body=
  'I used Apple Pay; the device token ends in 6789, not my plastic card.'
  where id=pg_temp.gid(27);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(27),pg_temp.gid(27))
  ->>'outcome','received','Verified wallet-token reply is bound to the current request');
create temp table directional_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(27)::text;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from directional_reply_task),
    (select (task->>'claimToken')::uuid from directional_reply_task),
    pg_temp.gid(27),(select (task->>'factVersion')::bigint from directional_reply_task),
    (select task->>'bodySha256' from directional_reply_task),pg_temp.gid(27),
    'device token ends in 6789','wallet_token_requires_research')
    ->>'outcome','reviewed_no_fact',
  'Wallet token is retained as directional evidence without inventing physical card digits');
select diag('Synthetic reply lookup eligibility: ' || (
  select jsonb_build_object(
    'contextStatus',r.status,'reviewState',r.reply_review_state,
    'resultCode',r.reply_review_result_code,
    'lookupMarkerAbsent',r.reply_lookup_generation is null,
    'actionVersionCurrent',r.reply_review_action_version=c.official_action_version,
    'factVersionCurrent',r.correction_fact_version=c.deterministic_fact_version,
    'replyDigestCurrent',r.reply_body_sha256=public.refund_scoped_verified_reply_set(r.id)->>'bodySha256',
    'replyTimeCurrent',m.received_at=r.reply_received_at,
    'replyIdentityCurrent',m.refund_case_id=c.id and m.direction='inbound'
      and m.status='received' and m.participant_role='customer'
      and m.participant_trust='verified' and m.content_deleted_at is null
      and m.sensitive_data_redacted is false,
    'caseStatus',c.status,'correctionEligible',public.refund_purchase_correction_eligible(c),
    'lookupStatus',c.nayax_lookup_status,
    'lookupBeforeReply',c.nayax_lookup_started_at<=r.reply_received_at,
    'lookupDigestValid',c.nayax_lookup_correlation_digest ~ '^[a-f0-9]{64}$',
    'policyPresent',nullif(c.nayax_recommendation_policy_version,'') is not null,
    'methodCard',c.payment_method='card','decisionAbsent',c.decision is null,
    'locationPresent',c.reporting_location_id is not null,
    'incidentPresent',c.incident_at is not null,
    'timeResolutionPresent',c.incident_time_resolution is not null,
    'amountPositive',c.payment_amount_cents>0,
    'matchedPurchaseAbsent',c.matched_nayax_transaction_id is null,
    'refundNotRequested',c.nayax_refund_execution_status='not_requested',
    'completionAbsent',c.refund_completed_at is null,
    'adjustmentAbsent',c.reporting_adjustment_id is null,
    'manualRefundAbsent',c.manual_refund_reference is null,
    'duplicateAbsent',c.duplicate_of_refund_case_id is null,
    'reconciliationAbsent',not public.refund_case_has_unresolved_reconciliation(c.id),
    'receiptAbsent',not exists(select 1 from public.refund_authoritative_receipts a
      where a.refund_case_id=c.id),
    'attemptAbsent',not exists(select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=c.id),
    'policyAutomatic',c.nayax_recommendation_policy_version<>'manual-nayax-portal-v1',
    'lookupFinished',c.nayax_lookup_finished_at is not null,
    'machineReady',machine.status='active' and machine.nayax_manual_portal_enabled is not true
      and nullif(btrim(machine.nayax_machine_id),'') is not null
      and nullif(btrim(machine.nayax_account_key),'') is not null
  )::text from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_gmail_messages m on m.id=r.reply_message_id
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
  where c.id=pg_temp.cid(27)));
create temp table directional_lookup_claim on commit drop as
  select claim from jsonb_array_elements(
    public.service_claim_due_refund_reply_nayax_lookups(2)) claim
  where claim->>'caseId'=pg_temp.cid(27)::text;
select ok((select claim->>'source'='verified_reply_research' from directional_lookup_claim)
  and (select nayax_lookup_status='checking' from public.refund_cases
    where id=pg_temp.cid(27)),
  'Scheduled existing Nayax claimant starts one new read-only generation for the reply');
select is((select claim#>>'{directionalEvidence,walletTokenLast4}'
    from directional_lookup_claim),'6789',
  'Read-only worker receives only the source-bound device token as soft wallet evidence');
select is(jsonb_array_length(public.service_claim_due_refund_reply_nayax_lookups(2)),0,
  'A second sweep cannot claim another read for the same verified reply');
select is(public.service_commit_refund_nayax_lookup(pg_temp.cid(27),
    (select (claim->>'lookupGeneration')::bigint from directional_lookup_claim),
    (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(27)),
    'no_match','no_safe_match','reply-fixture-v1',statement_timestamp(),
    'Current read-only search found no safe purchase.',null,0,'scheduled',null)
    ->>'applied','true','Existing result writer completes the reply-triggered read');
select is((select reply_review_state from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(27)),'pending',
  'Completed provider read reopens the same reply task for current evidence interpretation');
create temp table directional_second_review on commit drop as
  select task from jsonb_array_elements(
    public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(27)::text;
select is((select count(*)::integer from directional_second_review),1,
  'The second cycle claims the same request after the existing result writer commits');
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from directional_second_review),
    (select (task->>'claimToken')::uuid from directional_second_review),
    pg_temp.gid(27),
    (select (task->>'factVersion')::bigint from directional_second_review),
    (select task->>'bodySha256' from directional_second_review),pg_temp.gid(27),
    'device token ends in 6789','wallet_token_requires_research')
    ->>'outcome','reviewed_no_fact',
  'Exhausted second review settles to a specific internal dependency');
select is(jsonb_array_length(public.service_claim_due_refund_reply_nayax_lookups(2)),0,
  'Research result does not retrigger the provider for unchanged reply evidence');
select is((select reply_lookup_generation from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(27)),
  (select (claim->>'lookupGeneration')::bigint from directional_lookup_claim),
  'One source-bound reply retains its durable consumed lookup generation');
select ok(not has_function_privilege('authenticated',
    'public.service_claim_due_refund_reply_nayax_lookups(integer)','execute')
  and not has_function_privilege('anon',
    'public.service_claim_due_refund_reply_nayax_lookups(integer)','execute'),
  'Only the scheduled service worker can claim reply-triggered provider reads');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id=pg_temp.cid(27)),0,
  'Directional reply research creates no payment attempt');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,
  provider_message_id,references_header,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,
  plain_body,received_at,retention_expires_at)
select pg_temp.gid(30),gmail_thread_id,refund_case_id,'scoped-reply-30',
  references_header,direction,message_kind,status,sender_email,recipient_email,
  participant_role,participant_trust,subject,
  'I found a more precise purchase detail.',received_at+interval '1 minute',
  retention_expires_at from public.refund_gmail_messages where id=pg_temp.gid(27);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(27),pg_temp.gid(30))
  ->>'outcome','received','A genuinely later verified reply starts a new research identity');
select ok((select reply_lookup_generation is null and reply_review_state='pending'
    from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(27)),
  'New reply clears only the prior read marker without repeating the old one');
rollback to savepoint directional_reply_lookup;
savepoint inexact_time_lookup;
update public.reporting_machines set nayax_machine_id='REPLY-TEST-28',
  nayax_account_key='REPLY_ACCOUNT',nayax_manual_portal_enabled=false
  where id='df000000-0000-4000-8000-000000000003';
select pg_temp.make_scope(28);
select ok((select nayax_lookup_status='no_match' and nayax_lookup_finished_at is not null
    from public.refund_cases where id=pg_temp.cid(28)),
  'Inexact-time fixture has a prior completed automatic read');
update public.refund_gmail_messages set plain_body=
  'I remember buying around the afternoon, but I do not have an exact time.'
  where id=pg_temp.gid(28);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(28),pg_temp.gid(28))
  ->>'outcome','received','Verified inexact time clears the exact customer wait');
create temp table time_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(28)::text;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from time_reply_task),
    (select (task->>'claimToken')::uuid from time_reply_task),
    pg_temp.gid(28),(select (task->>'factVersion')::bigint from time_reply_task),
    (select task->>'bodySha256' from time_reply_task),pg_temp.gid(28),
    'remember buying around the afternoon',
    'inexact_purchase_time_requires_research')->>'outcome','reviewed_no_fact',
  'Inexact time stays source-bound without manufacturing an exact timestamp');
create temp table time_lookup_claim on commit drop as
  select claim from jsonb_array_elements(
    public.service_claim_due_refund_reply_nayax_lookups(2)) claim
  where claim->>'caseId'=pg_temp.cid(28)::text;
select is((select claim#>>'{directionalEvidence,timeConfidence}'
    from time_lookup_claim),'rough',
  'Scheduled provider read uses the customer rough-time signal, not a hard exclusion');
select ok((select nayax_lookup_status='checking' from public.refund_cases
    where id=pg_temp.cid(28))
  and (select count(*)=0 from public.refund_case_nayax_refund_attempts
    where refund_case_id=pg_temp.cid(28)),
  'Time research advances one real read-only generation with no payment attempt');
rollback to savepoint inexact_time_lookup;
savepoint cannot_provide_card_read;
update public.reporting_machines set nayax_machine_id='REPLY-TEST-30',
  nayax_account_key='REPLY_ACCOUNT',nayax_manual_portal_enabled=false
  where id='df000000-0000-4000-8000-000000000003';
select pg_temp.make_scope(30);
update public.refund_gmail_messages set plain_body=
  'I no longer have that physical card and cannot provide its last four digits.'
  where id=pg_temp.gid(30);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(30),pg_temp.gid(30))
  ->>'outcome','received','Cannot-provide reply clears the customer wait');
create temp table no_card_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(30)::text;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from no_card_reply_task),
    (select (task->>'claimToken')::uuid from no_card_reply_task),
    pg_temp.gid(30),(select (task->>'factVersion')::bigint from no_card_reply_task),
    (select task->>'bodySha256' from no_card_reply_task),pg_temp.gid(30),
    'cannot provide its last four digits','customer_cannot_provide')
    ->>'outcome','reviewed_no_fact',
  'System records the genuine customer limitation without asking again');
create temp table no_card_lookup_claim on commit drop as
  select claim from jsonb_array_elements(
    public.service_claim_due_refund_reply_nayax_lookups(2)) claim
  where claim->>'caseId'=pg_temp.cid(30)::text;
select ok((select claim->>'source'='verified_reply_research'
    from no_card_lookup_claim)
  and (select nayax_lookup_status='checking' from public.refund_cases
    where id=pg_temp.cid(30))
  and (select card_last4 is null from public.refund_cases where id=pg_temp.cid(30)),
  'The scheduled worker starts a read-only machine/amount/time search without card digits');
select is(jsonb_array_length(public.service_claim_due_refund_reply_nayax_lookups(2)),0,
  'Cannot-provide reply cannot create duplicate provider reads');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts
    where refund_case_id=pg_temp.cid(30)),0,
  'Read-only missing-card search does not create payment authority or an attempt');
rollback to savepoint cannot_provide_card_read;
savepoint semantic_disposition_guards;
select pg_temp.make_scope(31);
update public.refund_gmail_messages set plain_body=
  'I paid $10.90 with my physical card.' where id=pg_temp.gid(31);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(31),pg_temp.gid(31))
  ->>'outcome','received','Affirmative ordinary prose becomes a source-bound task');
create temp table affirmative_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(31)::text;
select is((select count(*)::integer from affirmative_reply_task),1,
  'Affirmative quote negative control owns one current scoped claim');
select throws_like($$select public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from affirmative_reply_task),
    (select (task->>'claimToken')::uuid from affirmative_reply_task),pg_temp.gid(31),
    (select (task->>'factVersion')::bigint from affirmative_reply_task),
    (select task->>'bodySha256' from affirmative_reply_task),pg_temp.gid(31),
    'I paid $10.90 with my physical card.','no_supported_new_fact')$$,
  '%supported reply fact%','A generic no-fact reason cannot discard an affirmative amount');
select throws_like($$select public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from affirmative_reply_task),
    (select (task->>'claimToken')::uuid from affirmative_reply_task),pg_temp.gid(31),
    (select task->>'factVersion' from affirmative_reply_task)::bigint,
    (select task->>'bodySha256' from affirmative_reply_task),pg_temp.gid(31),
    'I paid $10.90 with my physical card.','customer_cannot_provide')$$,
  '%supported reply fact%','Cannot-provide cannot discard an affirmative amount');
select is((select reply_review_state from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(31)),'claimed',
  'Rejected semantic dispositions leave the verified task claim open');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from affirmative_reply_task),
    (select (task->>'claimToken')::uuid from affirmative_reply_task),pg_temp.gid(31),
    (select (task->>'factVersion')::bigint from affirmative_reply_task),
    (select task->>'bodySha256' from affirmative_reply_task),
    jsonb_build_array(
      jsonb_build_object('field','amount','messageId',pg_temp.gid(31),
        'quote','I paid $10.90 with my physical card.'),
      jsonb_build_object('field','payment_method','messageId',pg_temp.gid(31),
        'quote','I paid $10.90 with my physical card.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090,"payment_method":"card"}'::jsonb,
    array['amount','payment_method'])->>'outcome','applied',
  'One protected receipt applies both supported fields from the same reply');
select is((select count(*)::integer from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(31) and applied_fields @> array['amount','payment_method']),1,
  'Multi-field reply has one immutable source-bound fact application');
select pg_temp.make_scope(32);
update public.refund_gmail_messages set plain_body='I was not charged $10.90.'
  where id=pg_temp.gid(32);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(32),pg_temp.gid(32))
  ->>'outcome','received','A negated amount is still a verified reply for research');
create temp table negated_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(32)::text;
select is((select count(*)::integer from negated_reply_task),1,
  'Negated quote negative control owns one current scoped claim');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from negated_reply_task),
    (select (task->>'claimToken')::uuid from negated_reply_task),pg_temp.gid(32),
    (select (task->>'factVersion')::bigint from negated_reply_task),
    (select task->>'bodySha256' from negated_reply_task),
    jsonb_build_array(jsonb_build_object('field','amount','messageId',pg_temp.gid(32),
      'quote','I was not charged $10.90.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,array['amount'])
    ->>'outcome','stale_or_unsupported_source',
  'The protected writer rejects a negated amount as an affirmative fact');
select is((select count(*)::integer from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(32)),0,
  'Negated prose creates no immutable positive fact receipt');
select ok(public.refund_verified_reply_quote_negated('None of this was charged as $10.90')
  and public.refund_verified_reply_quote_negated('Neither of my cards were Visa'),
  'Neither and none remain negative evidence, not affirmative amount or network facts');
update public.reporting_machines set nayax_machine_id='REPLY-TEST-37',
  nayax_account_key='REPLY_ACCOUNT',nayax_manual_portal_enabled=false
  where id='df000000-0000-4000-8000-000000000003';
select pg_temp.make_scope(37);
update public.refund_gmail_messages set plain_body='I paid $10.90 around 4 PM.'
  where id=pg_temp.gid(37);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(37),pg_temp.gid(37))
  ->>'outcome','received','Time and amount reply starts one exact task');
create temp table mixed_time_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(37)::text;
select throws_like($$select public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from mixed_time_task),
    (select (task->>'claimToken')::uuid from mixed_time_task),pg_temp.gid(37),
    (select (task->>'factVersion')::bigint from mixed_time_task),
    (select task->>'bodySha256' from mixed_time_task),pg_temp.gid(37),
    'I paid $10.90 around 4 PM.','inexact_purchase_time_requires_research')$$,
  '%supported reply fact%','Directional time research cannot discard the new amount');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from mixed_time_task),
    (select (task->>'claimToken')::uuid from mixed_time_task),pg_temp.gid(37),
    (select (task->>'factVersion')::bigint from mixed_time_task),
    (select task->>'bodySha256' from mixed_time_task),
    jsonb_build_array(jsonb_build_object('field','amount',
      'messageId',pg_temp.gid(37),'quote','I paid $10.90 around 4 PM.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'])->>'outcome','applied',
  'Mixed rough-time reply applies its grounded amount first');
select ok((select status='submitted' and reply_review_state='resolved'
    and reply_review_result_code='inexact_purchase_time_requires_research'
    and reply_directional_evidence->>'timeConfidence'='rough'
    and correction_fact_version=(select deterministic_fact_version
      from public.refund_cases where id=pg_temp.cid(37))
    from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(37)),
  'The same answered request retains due rough-time research at the new fact version');
create temp table mixed_time_lookup on commit drop as
  select claim from jsonb_array_elements(
    public.service_claim_due_refund_reply_nayax_lookups(4)) claim
  where claim->>'caseId'=pg_temp.cid(37)::text;
select is((select claim#>>'{directionalEvidence,timeConfidence}'
    from mixed_time_lookup),'rough',
  'The existing scheduled provider read receives source-bound rough-time context');
select pg_temp.make_scope(38);
update public.refund_gmail_messages set plain_body=
  'I paid $10.90 with my Apple Pay device token ending in 4932.'
  where id=pg_temp.gid(38);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(38),pg_temp.gid(38))
  ->>'outcome','received','Wallet and amount reply starts one exact task');
create temp table mixed_wallet_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(38)::text;
select throws_like($$select public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from mixed_wallet_task),
    (select (task->>'claimToken')::uuid from mixed_wallet_task),pg_temp.gid(38),
    (select (task->>'factVersion')::bigint from mixed_wallet_task),
    (select task->>'bodySha256' from mixed_wallet_task),pg_temp.gid(38),
    'I paid $10.90 with my Apple Pay device token ending in 4932.',
    'wallet_token_requires_research')$$,
  '%supported reply fact%','Directional wallet research cannot discard the new amount');
select throws_like($$select public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from mixed_wallet_task),
    (select (task->>'claimToken')::uuid from mixed_wallet_task),pg_temp.gid(38),
    (select (task->>'factVersion')::bigint from mixed_wallet_task),
    (select task->>'bodySha256' from mixed_wallet_task),
    jsonb_build_array(jsonb_build_object('field','amount',
      'messageId',pg_temp.gid(38),
      'quote','I paid $10.90 with my Apple Pay device token ending in 4932.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'])$$,
  '%All supported reply facts%','Amount-only settlement cannot discard the verified wallet token');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from mixed_wallet_task),
    (select (task->>'claimToken')::uuid from mixed_wallet_task),pg_temp.gid(38),
    (select (task->>'factVersion')::bigint from mixed_wallet_task),
    (select task->>'bodySha256' from mixed_wallet_task),
    jsonb_build_array(
      jsonb_build_object('field','amount','messageId',pg_temp.gid(38),
        'quote','I paid $10.90 with my Apple Pay device token ending in 4932.'),
      jsonb_build_object('field','wallet_token_last4','messageId',pg_temp.gid(38),
        'quote','I paid $10.90 with my Apple Pay device token ending in 4932.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090,"card_last4":"4932","card_last4_provenance":"wallet_device_token","card_wallet_used":true,"payment_interaction":"phone_watch_wallet"}'::jsonb,
    array['amount','card_last4'])->>'outcome','applied',
  'Mixed wallet reply atomically applies amount and device-token provenance');
select ok((select payment_amount_cents=1090 and card_last4='4932'
    and card_last4_provenance='wallet_device_token'
    from public.refund_cases where id=pg_temp.cid(38)),
  'Grounded wallet detail and amount both survive one immutable receipt');
select pg_temp.make_scope(41);
update public.refund_gmail_messages set plain_body=
  'I paid $10.90. I think it was 4 PM.' where id=pg_temp.gid(41);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(41),pg_temp.gid(41))
  ->>'outcome','received','Uncertain time and amount bind to one verified request');
create temp table uncertain_time_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(41)::text;
select throws_like($$select public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from uncertain_time_task),
    (select (task->>'claimToken')::uuid from uncertain_time_task),pg_temp.gid(41),
    (select (task->>'factVersion')::bigint from uncertain_time_task),
    (select task->>'bodySha256' from uncertain_time_task),pg_temp.gid(41),
    'I paid $10.90. I think it was 4 PM.',
    'inexact_purchase_time_requires_research')$$,
  '%supported reply fact%','Uncertain time disposition cannot discard the amount');
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from uncertain_time_task),
    (select (task->>'claimToken')::uuid from uncertain_time_task),pg_temp.gid(41),
    (select (task->>'factVersion')::bigint from uncertain_time_task),
    (select task->>'bodySha256' from uncertain_time_task),
    jsonb_build_array(jsonb_build_object('field','amount',
      'messageId',pg_temp.gid(41),'quote','I paid $10.90. I think it was 4 PM.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'])->>'outcome','applied',
  'Uncertain-time reply applies grounded amount through the existing writer');
select ok((select reply_review_result_code='inexact_purchase_time_requires_research'
    and reply_directional_evidence->>'timeConfidence'='rough'
    from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(41)),
  'An uncertain time remains directional research after amount application');
select pg_temp.make_scope(42);
update public.refund_gmail_messages set plain_body=
  'I paid $10.90; the 4932 digits are an Apple Pay device token.'
  where id=pg_temp.gid(42);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(42),pg_temp.gid(42))
  ->>'outcome','received','Digits-before-wallet phrase binds to the exact request');
create temp table reversed_wallet_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(42)::text;
select throws_like($$select public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from reversed_wallet_task),
    (select (task->>'claimToken')::uuid from reversed_wallet_task),pg_temp.gid(42),
    (select (task->>'factVersion')::bigint from reversed_wallet_task),
    (select task->>'bodySha256' from reversed_wallet_task),
    jsonb_build_array(jsonb_build_object('field','amount',
      'messageId',pg_temp.gid(42),
      'quote','I paid $10.90; the 4932 digits are an Apple Pay device token.')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'])$$,
  '%All supported reply facts%',
  'Amount-only settlement cannot discard digits-before-wallet evidence');
select pg_temp.make_scope(43);
update public.refund_gmail_messages set plain_body='I paid $10.90, maybe 4 PM.'
  where id=pg_temp.gid(43);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(43),pg_temp.gid(43))
  ->>'outcome','received','Known amount with a new rough-time clue binds the same request');
create temp table known_amount_time_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(43)::text;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from known_amount_time_task),
    (select (task->>'claimToken')::uuid from known_amount_time_task),pg_temp.gid(43),
    (select (task->>'factVersion')::bigint from known_amount_time_task),
    (select task->>'bodySha256' from known_amount_time_task),pg_temp.gid(43),
    'maybe 4 PM','inexact_purchase_time_requires_research')
    ->>'outcome','reviewed_no_fact',
  'An unchanged amount coexists with a newly source-backed time research task');
select ok((select reply_directional_evidence->>'timeConfidence'='rough'
    from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(43))
  and (select count(*)=0 from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(43)),
  'Known amount is not rewritten, while uncertain time stays durable');
select ok((select claim#>>'{directionalEvidence,timeConfidence}'='rough'
    from jsonb_array_elements(public.service_claim_due_refund_reply_nayax_lookups(4)) claim
    where claim->>'caseId'=pg_temp.cid(43)::text),
  'One scheduled read-only lookup consumes the new rough-time clue');
select pg_temp.make_scope(33);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(33),pg_temp.gid(33))
  ->>'outcome','received','Original verified response starts the exact scoped task');
insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,
  provider_thread_id,thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('df000000-0000-4000-8003-000000000033',pg_temp.cid(33),repeat('f',64),
  'unrelated-reply-thread-33','Unrelated labeled reply',now(),now(),now()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,
  provider_message_id,references_header,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,
  plain_body,received_at,retention_expires_at)
values(pg_temp.gid(35),'df000000-0000-4000-8003-000000000033',pg_temp.cid(33),
  'unrelated-labeled-reply-33','<unrelated@example.invalid>',
  'inbound','message','received','reply-customer@example.invalid',
  'info@bloomjoysweets.com','customer','verified','Unrelated reply',
  'Amount: 10.90',now()+interval '2 minutes',now()+interval '30 days');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(33),pg_temp.gid(35))
  ->>'outcome','request_thread_mismatch',
  'A later customer fact from another thread cannot bind this exact request');
select is(public.service_apply_refund_gmail_customer_facts_v1(
    pg_temp.cid(33),pg_temp.gid(35),
    (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(33)),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'],'labeled_routine_facts_v1')->>'outcome','conflict',
  'Generic labeled facts retain their existing guarded wrong-thread result');
select is(public.service_apply_refund_gmail_customer_facts_v1(
    pg_temp.cid(33),pg_temp.gid(35),
    (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(33)),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090}'::jsonb,
    array['amount'],'labeled_routine_facts_v1')->>'outcome','conflict',
  'Wrong-thread fact replay also cannot settle the exact-request task');
select is((select reply_review_state from public.refund_wallet_correction_contexts
    where refund_case_id=pg_temp.cid(33)),'pending',
  'Wrong-thread labeled content cannot settle the live scoped System task');
select pg_temp.make_scope(34);
update public.refund_gmail_messages set plain_body='I paid $10.90.'
  where id=pg_temp.gid(34);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(34),pg_temp.gid(34))
  ->>'outcome','received','A repeated already-known amount still clears Customer wait');
create temp table known_reply_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(34)::text;
select is(public.service_complete_refund_scoped_reply_no_fact(
    (select (task->>'requestId')::uuid from known_reply_task),
    (select (task->>'claimToken')::uuid from known_reply_task),pg_temp.gid(34),
    (select (task->>'factVersion')::bigint from known_reply_task),
    (select task->>'bodySha256' from known_reply_task),pg_temp.gid(34),
    'I paid $10.90.','no_supported_new_fact')->>'outcome','reviewed_no_fact',
  'The current same amount can finish reply interpretation without a false fact write');
select is((select count(*)::integer from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(34)),0,
  'Already-known amount does not manufacture a new immutable fact receipt');
select pg_temp.make_scope(39);
update public.refund_gmail_messages set plain_body='Amount: 10.90'
  where id=pg_temp.gid(39);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(39),pg_temp.gid(39))
  ->>'outcome','received','First verified reply supplies the amount');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,
  provider_message_id,references_header,direction,message_kind,status,
  sender_email,recipient_email,participant_role,participant_trust,subject,
  plain_body,received_at,retention_expires_at)
select pg_temp.gid(40),gmail_thread_id,refund_case_id,'scoped-reply-40',
  '<scoped-request-39@example.invalid>','inbound','message','received',
  'reply-customer@example.invalid','info@bloomjoysweets.com',
  'customer','verified','Reply','My card is Visa',
  now()+interval '2 minutes',now()+interval '30 days'
from public.refund_gmail_messages where id=pg_temp.gid(39);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(39),pg_temp.gid(40))
  ->>'outcome','received','Later verified reply joins the same exact request');
create temp table two_message_fact_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(39)::text;
select is(public.service_apply_refund_scoped_reply_semantic_fact(
    (select (task->>'requestId')::uuid from two_message_fact_task),
    (select (task->>'claimToken')::uuid from two_message_fact_task),pg_temp.gid(40),
    (select (task->>'factVersion')::bigint from two_message_fact_task),
    (select task->>'bodySha256' from two_message_fact_task),
    jsonb_build_array(
      jsonb_build_object('field','amount','messageId',pg_temp.gid(39),
        'quote','Amount: 10.90'),
      jsonb_build_object('field','card_network','messageId',pg_temp.gid(40),
        'quote','My card is Visa')),
    '{"payment_amount_cents":1090,"refund_amount_cents":1090,"card_network":"visa"}'::jsonb,
    array['amount','card_network'])->>'outcome','applied',
  'One guarded fact receipt combines two separately verified source spans');
select is((select count(*)::integer from public.refund_customer_fact_applications
    where refund_case_id=pg_temp.cid(39) and gmail_message_id=pg_temp.gid(40)
      and applied_fields @> array['amount','card_network']),1,
  'Two-message interpretation commits atomically under the latest reply receipt');
rollback to savepoint semantic_disposition_guards;
select is(public.service_start_refund_reply_subscription_run(date_trunc('hour',statement_timestamp()))->>'outcome',
  'disabled','Subscription-backed hourly worker is default-off');
update public.refund_reply_subscription_settings set enabled=true,
  activated_at=statement_timestamp()-interval '1 hour' where singleton;
create temp table subscription_run on commit drop as
  select public.service_start_refund_reply_subscription_run(
    date_trunc('hour',statement_timestamp())) receipt;
select is((select receipt->>'outcome' from subscription_run),'started',
  'An enabled hourly opportunity records one durable run receipt');
select is(public.service_start_refund_reply_subscription_run(
  date_trunc('hour',statement_timestamp()))->>'outcome','already_recorded',
  'Scheduler replay cannot open a second receipt for the same hour');
select is(public.service_finish_refund_reply_subscription_run(
    (select (receipt->>'runId')::uuid from subscription_run),0,0,0,null)->>'status',
  'succeeded','A no-task hourly run can finish with an explicit zero-work receipt');
select is(public.service_get_refund_reply_subscription_health()->>'enabled','true',
  'Service health exposes effective activation without customer content');
create temp table failed_subscription_run on commit drop as
  select public.service_start_refund_reply_subscription_run(
    date_trunc('hour',statement_timestamp())-interval '1 hour') receipt;
select is((select receipt->>'outcome' from failed_subscription_run),'started',
  'A separate due hour records a distinct scheduled opportunity');
select is(public.service_finish_refund_reply_subscription_run(
    (select (receipt->>'runId')::uuid from failed_subscription_run),0,0,0,
    'research_failed')->>'status','failed',
  'A failed run retains a bounded redacted failure category');
select ok((select health->>'latestRunStatus'='succeeded'
    and (health->>'failedRuns24h')::integer=1
    and health->>'latestFailureCode'='research_failed'
    and health->>'latestFailedAt' is not null
    and (health->>'missedHours24h')::integer>=0
    from (select public.service_get_refund_reply_subscription_health() health) h),
  'Health exposes failed-run count/category separately from missed hours and latest status');
select ok(not has_function_privilege('authenticated',
  'public.service_apply_refund_scoped_reply_semantic_fact(uuid,uuid,uuid,bigint,text,jsonb,jsonb,text[])','execute')
  and not has_function_privilege('authenticated',
  'public.service_complete_refund_scoped_reply_no_fact(uuid,uuid,uuid,bigint,text,uuid,text,text)','execute')
  and not has_function_privilege('anon',
  'public.service_start_refund_reply_subscription_run(timestamptz)','execute'),
  'No browser or anonymous role can interpret or finish a scoped reply');
select * from finish();
rollback;
