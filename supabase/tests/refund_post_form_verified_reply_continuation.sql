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
    'America/Los_Angeles',case when n=60 then 'ambiguous' else 'exact' end,case when n=60 then 'rough' else 'exact' end,case when n=63 then 'cash' else 'card' end,case when n=63 then 'cash' when n in (27,28,29,38,42,45) then 'phone_watch_wallet' else 'tap_card' end,case when n in (34,43,45,48) then 1090 when n in (44,60,63) then 1000 when n in (27,28,29,30) then 700 else null end,case when n=45 then '4932' when n in (8,15,27,28,29,30,34,38,42,43,44,48,63) then null else '1234' end,case when n=45 then 'wallet_device_token' when n in (8,15,27,28,29,30,34,38,42,43,44,48,63) then null else 'physical_card' end,case when n=63 then null when n=26 then 'mastercard' else 'visa' end,n in (27,28,29,38,42,45),'needs_review','manual_review','form');
  update public.refund_cases set
    incident_local_datetime=to_char((now()-interval '10 days') at time zone 'America/Los_Angeles','YYYY-MM-DD')||'T01:00',
    incident_at=(to_char((now()-interval '10 days') at time zone 'America/Los_Angeles','YYYY-MM-DD')||'T01:00')::timestamp at time zone 'America/Los_Angeles'
    where id=cid;
  if n=63 then
    -- The protected payout request is fail closed unless its execution state
    -- is explicitly safe. Do not rely on a nullable fixture default.
    update public.refund_cases
    set nayax_refund_execution_status='not_requested'
    where id=cid;
  end if;
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
  if n=63 then
    fields:=array['zelle_payment_contact']::text[];
  elsif n in (27,28,29,38,42,45,60) then
    -- Wallet detail is a scoped correction request, not the ordinary
    -- missing-information cycle, whose production guard rejects wallet work.
    fields:=case when n=60 then array['incident_time']::text[]
      else array['wallet_provider']::text[] end;
  else
    cycle:=public.service_claim_refund_follow_up_cycle(cid,'missing_information','refund_follow_up_v2',md5(n::text)||md5(n::text),null);
    if not coalesce((cycle->>'claimed')::boolean,false) then raise exception 'Fixture cycle rejected: %',cycle; end if;
    fields:=public.refund_missing_follow_up_fields(cid);
  end if;
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,content_source,delivery_kind,reason_code,template_version,follow_up_cycle_id,requested_fields)
  values(mid,cid,case when n in (27,28,29,38,42,45,60) then 'wallet_correction' else 'more_info' end,'pending','reply-customer@example.invalid','Update your request','[Secure refund correction link included at delivery]',
    case when n=63 then 'manager_authored' else 'deterministic_template' end,
    case when n=63 then 'manual' else 'automatic' end,
    case when n in (27,28,29,38,42,45,60) then null else 'missing_information' end,
    case when n=63 then null when n in (27,28,29,38,42,45,60) then 'refund_wallet_correction_v1' else 'refund_follow_up_v2' end,
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
    'info@bloomjoysweets.com','reply-customer@example.invalid','Update your request','Scoped request',now()-interval '7 days',now()-interval '7 days',now()+interval '30 days');
  end if;
  update public.refund_case_messages set status='sent',sent_at=now()-interval '7 days' where id=mid;
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

-- All customers, addresses, messages and purchases here are synthetic.
create function pg_temp.make_post_form(n integer) returns void language plpgsql as $$
declare response jsonb; answers jsonb;
begin
  perform pg_temp.make_scope(n);
  select jsonb_object_agg(field,case when field='amount' then
      '{"disposition":"changed","value":"7.00"}'::jsonb
      else '{"disposition":"cannot_provide"}'::jsonb end) into answers
    from public.refund_wallet_correction_contexts r,
      unnest(r.correction_requested_fields) field where r.refund_case_id=pg_temp.cid(n);
  response:=public.service_submit_refund_purchase_correction(lpad(to_hex(n),64,'0'),
    (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(n)),
    answers);
  if response->>'state' is distinct from 'received' then
    raise exception 'Synthetic form was not applied: %',response; end if;
  update public.refund_wallet_correction_contexts set issued_at=now()-interval '7 days',
    consumed_at=now()-interval '6 days',expires_at=now()-interval '5 days'
    where refund_case_id=pg_temp.cid(n);
  update public.refund_gmail_messages set received_at=now()-interval '1 day',
    plain_body=E'I paid around 1pm eastern time.\n\nOn Sep 21, 2026, at 1:37 PM, Synthetic Refunds wrote:\nTime: 4:59 pm\n2026-09-21'
    where id=pg_temp.gid(n);
end; $$;
select pg_temp.make_post_form(n) from generate_series(1,11) n;
create temp table original_form on commit drop as
  select r.id,r.correction_response,r.consumed_at,r.expires_at,r.correction_resulting_fact_version,
    left(c.incident_local_datetime,10) purchase_date,c.deterministic_fact_version
  from public.refund_wallet_correction_contexts r join public.refund_cases c on c.id=r.refund_case_id
  where r.refund_case_id=pg_temp.cid(1);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(1),pg_temp.gid(1))->>'outcome',
  'received','A verified post-form reply continues the same delivered conversation after capability expiry');
select is((select status from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  'submitted','Receiving a later reply never reopens the form capability');
select is(public.refund_customer_outreach_contract(pg_temp.cid(1))->>'state','customer_replied',
  'The later useful reply is internal review, never waiting for another customer response');
create temp table post_form_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(1)::text;
select is((select count(*)::integer from post_form_task),1,'Existing request-row worker claims one post-form task');
select is((select (task->>'factVersion')::bigint from post_form_task),
  (select deterministic_fact_version from original_form),'Claim uses the submitted current fact version, not issuance facts');
select is((select public.service_get_refund_scoped_reply_research_input(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,(task->>'sourceMessageId')::uuid,
    (task->>'factVersion')::bigint,task->>'bodySha256')->>'outcome' from post_form_task),
  'ready','The existing research input accepts only the exact post-form claim');
select is((select public.service_apply_refund_scoped_reply_incident_time(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,(task->>'sourceMessageId')::uuid,
    (task->>'factVersion')::bigint,task->>'bodySha256',pg_temp.gid(1),'Time: 4:59 pm')->>'outcome'
    from post_form_task),'stale_or_unsupported_source','A quoted mail-history time cannot become purchase evidence');
create temp table post_form_result on commit drop as
  select public.service_apply_refund_scoped_reply_incident_time(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,(task->>'sourceMessageId')::uuid,
    (task->>'factVersion')::bigint,task->>'bodySha256',pg_temp.gid(1),'around 1pm eastern time') result
    from post_form_task;
select is((select result->>'outcome' from post_form_result),'applied',
  'Source-bound approximate Eastern time uses the existing atomic fact writer');
select is((select incident_local_datetime from public.refund_cases where id=pg_temp.cid(1)),
  (select purchase_date||'T13:00' from original_form),'The original saved purchase date is preserved');
select is((select incident_timezone from public.refund_cases where id=pg_temp.cid(1)),
  'America/New_York','Explicit Eastern source replaces the old clock basis, including date-specific DST');
select is((select incident_at from public.refund_cases where id=pg_temp.cid(1)),
  (select (purchase_date||'T13:00')::timestamp at time zone 'America/New_York' from original_form),
  'UTC instant is derived in the database from the saved date and explicit source zone');
select is((select incident_time_confidence from public.refund_cases where id=pg_temp.cid(1)),
  'rough','Around remains approximate rather than becoming exact customer confidence');
select is((select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(1)),
  (select deterministic_fact_version+1 from original_form),'Time and approximation make one atomic fact version');
select is((select count(*)::integer from public.refund_customer_fact_applications where refund_case_id=pg_temp.cid(1)),
  1,'One immutable Gmail fact receipt owns the source-bound change');
select is((select correction_response from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  (select correction_response from original_form),'Submitted form answers remain unchanged');
select is((select correction_resulting_fact_version from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  (select correction_resulting_fact_version from original_form),'Original form resulting version remains history');
select is((select consumed_at from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  (select consumed_at from original_form),'Original form submission time is not rewritten');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(1),pg_temp.gid(1))->>'outcome',
  'already_received','Replay cannot reopen the resolved reply review');
select is((select reply_review_state from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(1)),
  'resolved','Applying the time settles the existing review task');
select is((select count(*)::integer from public.refund_case_messages where refund_case_id=pg_temp.cid(1)),
  1,'No new question or message was created');
select is((select count(*)::integer from public.refund_case_nayax_refund_attempts where refund_case_id=pg_temp.cid(1)),
  0,'No provider refund attempt was created');
update public.refund_gmail_messages set received_at=now()-interval '7 days' where id=pg_temp.gid(2);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(2),pg_temp.gid(2))->>'outcome',
  'request_not_current','A reply predating the submitted form is rejected');
update public.refund_gmail_messages set participant_trust='unverified' where id=pg_temp.gid(3);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(3),pg_temp.gid(3))->>'outcome',
  'unverified','Unverified participants cannot create post-form work');
update public.refund_gmail_messages set references_header='<another-request@example.invalid>' where id=pg_temp.gid(4);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(4),pg_temp.gid(4))->>'outcome',
  'request_thread_mismatch','A different delivered request cannot authorize the reply');
update public.refund_cases set card_network='mastercard' where id=pg_temp.cid(5);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(5),pg_temp.gid(5))->>'outcome',
  'request_not_current','Newer case facts reject the old submitted version');
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(6),pg_temp.gid(6))->>'outcome',
  'received','A second synthetic case receives its own exact request');
create temp table stale_task on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId'=pg_temp.cid(6)::text;
update public.refund_cases set card_network='mastercard' where id=pg_temp.cid(6);
select is((select public.service_apply_refund_scoped_reply_incident_time(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,(task->>'sourceMessageId')::uuid,
    (task->>'factVersion')::bigint,task->>'bodySha256',pg_temp.gid(6),'around 1pm eastern time')->>'outcome'
    from stale_task),'stale_or_unsupported_source','A claimed reply cannot overwrite later case facts');
select pg_temp.make_scope(14);
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=now()
  where refund_case_id=pg_temp.cid(14);
select is(public.service_receive_refund_scoped_email_reply(pg_temp.cid(14),pg_temp.gid(14))->>'outcome',
  'no_current_request','A revoked delivered context cannot create post-form work');
update public.refund_gmail_messages set plain_body=case id
  when pg_temp.gid(8) then 'I did not pay around 1pm eastern time.'
  when pg_temp.gid(9) then 'I paid around 1pm eastern time or 2pm.'
  when pg_temp.gid(10) then 'I paid around 1pm eastern time on September 16.'
  else 'I paid around 1pm eastern time or Pacific time.' end
  where id in (pg_temp.gid(8),pg_temp.gid(9),pg_temp.gid(10),pg_temp.gid(11));
select public.service_receive_refund_scoped_email_reply(pg_temp.cid(n),pg_temp.gid(n)) from generate_series(8,11) n;
create temp table ambiguous_tasks on commit drop as
  select task from jsonb_array_elements(public.service_claim_refund_scoped_reply_reviews(25)->'tasks') task
  where task->>'refundCaseId' in (pg_temp.cid(8)::text,pg_temp.cid(9)::text,pg_temp.cid(10)::text,pg_temp.cid(11)::text);
select is((select count(*)::integer from ambiguous_tasks),4,'Ambiguous replies are existing internal tasks, never guesses');
select is((select count(*)::integer from ambiguous_tasks where public.service_apply_refund_scoped_reply_incident_time(
    (task->>'requestId')::uuid,(task->>'claimToken')::uuid,(task->>'sourceMessageId')::uuid,
    (task->>'factVersion')::bigint,task->>'bodySha256',(task->>'sourceMessageId')::uuid,
    'around 1pm eastern time')->>'outcome'='time_requires_research'),4,
  'Negated, competing, date-changing and conflicting-zone evidence cannot be applied');
select is((select count(*)::integer from public.refund_customer_fact_applications
  where refund_case_id in (pg_temp.cid(8),pg_temp.cid(9),pg_temp.cid(10),pg_temp.cid(11))),0,
  'Rejected ambiguity creates no fact receipt');
select ok(not has_function_privilege('authenticated',
  'public.service_apply_refund_scoped_reply_incident_time(uuid,uuid,uuid,bigint,text,uuid,text)','execute')
  and not has_function_privilege('anon',
  'public.service_receive_refund_scoped_email_reply(uuid,uuid)','execute'),
  'Browser and anonymous callers gain no reply-writing capability');
select * from finish();
rollback;
