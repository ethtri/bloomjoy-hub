begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('d5170000-0000-4000-8000-000000000004','authenticated','authenticated','reply-manager@example.invalid','{}','{}');
insert into public.admin_roles(user_id,role,active) values('d5170000-0000-4000-8000-000000000004','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('d5170000-0000-4000-8000-000000000001','Scoped reply fixture','customer');
insert into public.reporting_locations(id,account_id,name,timezone,status)
values('d5170000-0000-4000-8000-000000000002','d5170000-0000-4000-8000-000000000001','Reply fixture location','America/Los_Angeles','active');
insert into public.reporting_machines(id,account_id,location_id,machine_label,machine_type,status,refund_intake_enabled,refund_public_display_label)
values('d5170000-0000-4000-8000-000000000003','d5170000-0000-4000-8000-000000000001','d5170000-0000-4000-8000-000000000002','Reply fixture machine','commercial','active',true,'Reply fixture machine');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
values('d5170000-0000-4000-8000-000000000003','d5170000-0000-4000-8000-000000000004','reply-manager@example.invalid','Scoped reply test');
update public.refund_customer_contact_settings set automatic_customer_contact_enabled=true,correction_links_enabled=true where singleton;
create function pg_temp.cid(n integer) returns uuid language sql as $$ select ('d5170000-0000-4000-8001-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.gid(n integer) returns uuid language sql as $$ select ('d5170000-0000-4000-8002-'||lpad(n::text,12,'0'))::uuid $$;
create function pg_temp.make_scope(n integer) returns void language plpgsql as $$
declare cid uuid:=pg_temp.cid(n); mid uuid:=gen_random_uuid(); tid uuid:=gen_random_uuid(); cycle jsonb; fields text[]; lookup_receipt jsonb; lookup_result jsonb;
begin
  insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,customer_email,issue_summary,incident_at,incident_local_datetime,
    incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,payment_interaction,payment_amount_cents,card_last4,card_last4_provenance,card_network,card_wallet_used,status,correlation_status,intake_source)
  values(cid,'d5170000-0000-4000-8000-000000000003','d5170000-0000-4000-8000-000000000002','reply-customer@example.invalid','Scoped reply test',
    now()-interval '2 hours'-n*interval '7 hours',to_char((now()-interval '2 hours'-n*interval '7 hours') at time zone 'America/Los_Angeles','YYYY-MM-DD"T"HH24:MI'),
    'America/Los_Angeles',case when n=60 then 'ambiguous' else 'exact' end,case when n=60 then 'rough' else 'exact' end,case when n=63 then 'cash' else 'card' end,case when n=63 then 'cash' when n in (27,28,29,38,42,45) then 'phone_watch_wallet' else 'tap_card' end,case when n in (34,43,45,48) then 1090 when n in (44,60,63) then 1000 when n in (27,28,29,30) then 700 else null end,case when n=45 then '4932' when n in (8,15,27,28,29,30,34,38,42,43,44,48,63) then null else '1234' end,case when n=45 then 'wallet_device_token' when n in (8,15,27,28,29,30,34,38,42,43,44,48,63) then null else 'physical_card' end,case when n=63 then null when n=26 then 'mastercard' else 'visa' end,n in (27,28,29,38,42,45),'needs_review','manual_review','form');
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

select pg_temp.make_scope(63);
update public.refund_gmail_messages set plain_body='I do not use Zelle. I use Venmo or you can mail me a physical check for $11.' where id=pg_temp.gid(63);
select is(public.service_apply_refund_gmail_customer_facts_v1(pg_temp.cid(63),pg_temp.gid(63),
 (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(63)),
 '{"payment_amount_cents":1100,"refund_amount_cents":1100}',array['amount'],'labeled_routine_facts_v1')->>'outcome','applied','Existing verified source applies the supplied amount once');
-- Reproduce a later delivered form after the useful mixed reply was processed.
-- No production contact is issued by this fixture or this migration.
update public.refund_gmail_messages set received_at=statement_timestamp()-interval '1 minute' where id=pg_temp.gid(63);
update public.refund_wallet_correction_contexts set correction_fact_version=(select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(63)),
 correction_snapshot=public.refund_purchase_correction_values((select c from public.refund_cases c where id=pg_temp.cid(63))) where refund_case_id=pg_temp.cid(63);
select is(public.service_apply_refund_gmail_customer_facts_v1(pg_temp.cid(63),pg_temp.gid(63),
 (select deterministic_fact_version from public.refund_cases where id=pg_temp.cid(63)),
 '{"payment_amount_cents":1100,"refund_amount_cents":1100}',array['amount'],'labeled_routine_facts_v1')->>'outcome','already_applied','Processed fact receipt cannot be replayed to answer the newer request');
select is((select status from public.refund_wallet_correction_contexts where refund_case_id=pg_temp.cid(63)),'pending','Reproduction: already-supplied limitation remains an unanswered customer task');
create temp table assisted_binding as select ctx.id request_id,c.deterministic_fact_version fact_version,c.official_action_version action_version,
 encode(extensions.digest(convert_to(g.plain_body,'UTF8'),'sha256'),'hex') body_sha
 from public.refund_cases c join public.refund_wallet_correction_contexts ctx on ctx.refund_case_id=c.id
 join public.refund_gmail_messages g on g.id=pg_temp.gid(63) where c.id=pg_temp.cid(63);
create function pg_temp.assist() returns jsonb language sql as $$
 select public.service_submit_refund_assisted_payout_limitation(request_id,pg_temp.gid(63),
 'd5170000-0000-4000-8000-000000000004',fact_version,action_version,body_sha,'I do not use Zelle.') from assisted_binding;
$$;
create temp table before_assistance as select to_jsonb(c)-array['status','automation_state','automation_follow_up_due_at','official_action_version','updated_at','lifecycle_revision'] business,
 c.lifecycle_revision,
 (select jsonb_agg(to_jsonb(a)) from public.refund_customer_fact_applications a where refund_case_id=c.id) fact_receipts,
 (select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m where refund_case_id=c.id) messages,
 (select jsonb_agg(to_jsonb(g) order by id) from public.refund_gmail_messages g where refund_case_id=c.id) gmail,
 (select count(*) from public.refund_case_nayax_refund_attempts) payments,
 (select count(*) from public.refund_cases) cases
 from public.refund_cases c where id=pg_temp.cid(63);
select ok(not has_function_privilege('anon','public.service_submit_refund_assisted_payout_limitation(uuid,uuid,uuid,bigint,bigint,text,text)','execute')
 and not has_function_privilege('authenticated','public.service_submit_refund_assisted_payout_limitation(uuid,uuid,uuid,bigint,bigint,text,text)','execute'),'Customer/browser roles cannot invoke assisted handling');
savepoint bad_source;
update public.refund_gmail_messages set participant_trust='unverified' where id=pg_temp.gid(63);
select throws_ok('select pg_temp.assist()','P4672',null,'Unverified source fails closed');
rollback to bad_source;
savepoint bad_source;
update public.refund_gmail_messages set sender_email='other@example.invalid' where id=pg_temp.gid(63);
select throws_ok('select pg_temp.assist()','P4672',null,'Wrong customer cannot complete a request');
rollback to bad_source;
savepoint bad_source;
update assisted_binding set body_sha=repeat('f',64);
select throws_ok('select pg_temp.assist()','P4672',null,'Changed source body digest fails closed');
rollback to bad_source;
savepoint bad_source;
update assisted_binding set action_version=action_version+1;
select throws_ok('select pg_temp.assist()','P4672',null,'Stale action binding cannot save');
rollback to bad_source;
savepoint bad_source;
update assisted_binding set fact_version=fact_version+1;
select throws_ok('select pg_temp.assist()','P4672',null,'Stale matching facts cannot save');
rollback to bad_source;
savepoint bad_source;
update public.refund_wallet_correction_contexts set status='revoked',revoked_at=statement_timestamp() where id=(select request_id from assisted_binding);
select throws_ok('select pg_temp.assist()','P4672',null,'Revoked capability cannot be resurrected');
rollback to bad_source;
savepoint bad_source;
update public.refund_wallet_correction_contexts set issued_at=statement_timestamp()-interval '48 hours',expires_at=statement_timestamp()-interval '1 minute' where id=(select request_id from assisted_binding);
select throws_ok('select pg_temp.assist()','P4672',null,'Expired capability is not renewed by assistance');
rollback to bad_source;
savepoint bad_source;
update public.refund_wallet_correction_contexts set correction_requested_fields=array['incident_time'] where id=(select request_id from assisted_binding);
select throws_ok('select pg_temp.assist()','P4672',null,'Location/time or other facts are not inferred by this exception');
rollback to bad_source;
savepoint bad_source;
update public.refund_gmail_messages set gmail_thread_id=(select id from public.refund_gmail_threads where refund_case_id=pg_temp.cid(63)) where id=pg_temp.gid(63);
update public.refund_gmail_messages set refund_case_message_id=null where direction='outbound' and refund_case_id=pg_temp.cid(63);
select throws_ok('select pg_temp.assist()','P4672',null,'Missing exact request conversation cannot fall back to another thread');
rollback to bad_source;
savepoint bad_source;
update public.refund_gmail_messages set plain_body='I do not use Zelle. I can use Zelle.' where id=pg_temp.gid(63);
update assisted_binding set body_sha=(select encode(extensions.digest(convert_to(plain_body,'UTF8'),'sha256'),'hex') from public.refund_gmail_messages where id=pg_temp.gid(63));
select throws_ok('select pg_temp.assist()','P4672',null,'Contradictory limitation remains internal review');
rollback to bad_source;
savepoint bad_source;
update public.refund_gmail_messages set plain_body=E'On Monday, Bloomjoy wrote:\n> I do not use Zelle.' where id=pg_temp.gid(63);
update assisted_binding set body_sha=(select encode(extensions.digest(convert_to(plain_body,'UTF8'),'sha256'),'hex') from public.refund_gmail_messages where id=pg_temp.gid(63));
select throws_ok('select pg_temp.assist()','P4672',null,'Quoted history is not a current customer answer');
rollback to bad_source;
savepoint bad_source;
update public.refund_gmail_messages set plain_body='I do not use Zelle. The amount should be $12.' where id=pg_temp.gid(63);
update assisted_binding set body_sha=(select encode(extensions.digest(convert_to(plain_body,'UTF8'),'sha256'),'hex') from public.refund_gmail_messages where id=pg_temp.gid(63));
select throws_ok('select pg_temp.assist()','P4672',null,'Unresolved supplied amount cannot be discarded');
rollback to bad_source;
savepoint bad_source;
update public.admin_roles set active=false where user_id='d5170000-0000-4000-8000-000000000004';
update public.reporting_machine_refund_managers set revoked_at=statement_timestamp(),revoke_reason='Synthetic authority revocation'
 where manager_user_id='d5170000-0000-4000-8000-000000000004';
select throws_ok('select pg_temp.assist()','42501',null,'Revoked current actor cannot perform assisted handling');
rollback to bad_source;
savepoint bad_source;
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,direction,message_kind,status,
 sender_email,recipient_email,participant_role,participant_trust,subject,plain_body,received_at,retention_expires_at)
select gen_random_uuid(),gmail_thread_id,refund_case_id,'newer-assisted-answer','inbound','message','received',sender_email,
 recipient_email,'customer','verified','New answer','I can use Zelle now.',statement_timestamp(),retention_expires_at
 from public.refund_gmail_messages where id=pg_temp.gid(63);
select throws_ok('select pg_temp.assist()','P4672',null,'Newer customer evidence prevents consuming an old limitation');
rollback to bad_source;
savepoint bad_source;
select public.service_submit_refund_purchase_correction(
 (select token_hash from public.refund_wallet_correction_contexts where id=(select request_id from assisted_binding)),
 (select fact_version from assisted_binding),'{"zelle_payment_contact":{"disposition":"cannot_provide"}}');
select throws_ok('select pg_temp.assist()','P4672',null,'A submitted customer receipt cannot be relabelled as assisted');
rollback to bad_source;
select is(pg_temp.assist()->>'state','received','Reviewed limitation saves through the unchanged same-case structured writer');
select is((select correction_response from public.refund_wallet_correction_contexts where id=(select request_id from assisted_binding)),
 '{"zelle_payment_contact":{"disposition":"cannot_provide"}}'::jsonb,'Only the supplied targeted limitation is recorded');
select is((select correction_next_action from public.refund_wallet_correction_contexts where id=(select request_id from assisted_binding)),'review','No-Zelle answer returns to internal review, not another customer question');
select is((select to_jsonb(c)-array['status','automation_state','automation_follow_up_due_at','official_action_version','updated_at','lifecycle_revision'] from public.refund_cases c where id=pg_temp.cid(63)),
 (select business from before_assistance),'Purchase, venue, clock, financial and decision facts are all preserved');
select is((select lifecycle_revision from public.refund_cases where id=pg_temp.cid(63)),
 (select lifecycle_revision+1 from before_assistance),'Existing form receipt advances lifecycle metadata exactly once');
select is((select jsonb_agg(to_jsonb(a)) from public.refund_customer_fact_applications a where refund_case_id=pg_temp.cid(63)),(select fact_receipts from before_assistance),'Existing processed Gmail fact receipt is immutable');
select is((select jsonb_agg(to_jsonb(m) order by id) from public.refund_case_messages m where refund_case_id=pg_temp.cid(63)),(select messages from before_assistance),'No message queued, claimed or sent');
select is((select jsonb_agg(to_jsonb(g) order by id) from public.refund_gmail_messages g where refund_case_id=pg_temp.cid(63)),(select gmail from before_assistance),'Original customer thread and provider receipt are unchanged');
select is((select count(*) from public.refund_case_nayax_refund_attempts),(select payments from before_assistance),'No payment attempt');
select is((select count(*) from public.refund_cases),(select cases from before_assistance),'Same case only');
select is(pg_temp.assist()->>'state','received','Exact assisted retry returns the original receipt');
select is((select count(*)::integer from public.refund_case_events where refund_case_id=pg_temp.cid(63) and event_type='purchase_correction_assisted_received'),1,'Retry creates no duplicate assisted receipt');
select ok((select metadata->>'body_sha256'=(select body_sha from assisted_binding)
 and metadata->>'quote_sha256' ~ '^[a-f0-9]{64}$' and not metadata ? 'quote'
 from public.refund_case_events where refund_case_id=pg_temp.cid(63) and event_type='purchase_correction_assisted_received'),'Assisted provenance stores exact source/digest without copying customer content');
select is((select count(*)::integer from public.refund_case_events where refund_case_id=pg_temp.cid(63) and event_type='purchase_correction_received'),1,'Existing form save occurred exactly once');
select * from finish();
rollback;
