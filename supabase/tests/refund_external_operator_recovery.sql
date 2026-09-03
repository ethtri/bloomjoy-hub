begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('00000000-0000-0000-0000-000000000000','bf000000-0000-4000-8000-000000000001','authenticated','authenticated',
 'recovery-operator@example.invalid','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at)
values('bf010000-0000-4000-8000-000000000001','bf000000-0000-4000-8000-000000000001',now(),now());
insert into public.admin_roles(user_id,role,active) values('bf000000-0000-4000-8000-000000000001','super_admin',true);
insert into public.customer_accounts(id,name,account_type) values('bf100000-0000-4000-8000-000000000001','Recovery fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('bf200000-0000-4000-8000-000000000001','bf100000-0000-4000-8000-000000000001','Recovery fixture','America/New_York');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
select ('bf300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'bf100000-0000-4000-8000-000000000001',
 'bf200000-0000-4000-8000-000000000001','Recovery machine '||n,'RECOVERY-MACHINE-'||n,'RECOVERY-ACCOUNT' from generate_series(1,2) n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
select id,'bf000000-0000-4000-8000-000000000001','recovery-operator@example.invalid','Recovery fixture'
 from public.reporting_machines where nayax_account_key='RECOVERY-ACCOUNT';
insert into public.refund_nayax_machine_inventory(id,account_key,nayax_machine_id,machine_number,provider_is_active,
 refund_category,reporting_machine_id,reconciliation_state)
values('bf600000-0000-4000-8000-000000000002','RECOVERY-ACCOUNT','RECOVERY-MACHINE-2','50002AutoFwp$r',true,
 'snapcase','bf300000-0000-4000-8000-000000000002','published');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,customer_email,issue_summary,
 incident_at,incident_local_datetime,incident_timezone,incident_time_resolution,incident_time_confidence,payment_method,
 payment_amount_cents,refund_amount_cents,card_last4,card_wallet_used,status,correlation_status,intake_selection_kind,intake_selection_key,
 intake_selection_machine_ids,intake_meta,created_at)
select ('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-RECOVERY-'||n,
 'bf300000-0000-4000-8000-000000000001','bf200000-0000-4000-8000-000000000001','recovery-customer@example.invalid',
 'Synthetic already-issued refund',date_trunc('second',now()-interval '2 days')+interval '25 minutes',
 (date_trunc('second',now()-interval '2 days')+interval '25 minutes') at time zone 'America/New_York',
 'America/New_York','exact','within_1_hour','card',3200,3200,'4242',false,'needs_review','no_match','exact_machine',
 'synthetic-original-selection',array['bf300000-0000-4000-8000-000000000001'::uuid],'{"sentinel":"original intake"}',now()-interval '3 days'
 from generate_series(1,3) n;
select set_config('request.jwt.claim.sub','bf000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"sub":"bf000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"bf010000-0000-4000-8000-000000000001","is_anonymous":false}',true);
create function pg_temp.recovery_evidence(n integer) returns jsonb language plpgsql as $$
declare c public.refund_cases%rowtype; v jsonb;
begin
 select * into c from public.refund_cases where id=('bf400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 v:=public.admin_get_refund_external_recovery_options(c.id);
 return jsonb_build_object('expectedCaseVersion',c.official_action_version,'oldMachineId',c.reporting_machine_id,
 'reviewBinding',v->>'reviewBinding','targetMachineId','bf300000-0000-4000-8000-000000000002',
 'inventoryId','bf600000-0000-4000-8000-000000000002','inventoryDigest',v->'targets'->0->>'inventoryDigest',
 'accountScope','RECOVERY-ACCOUNT','providerMachineId','RECOVERY-MACHINE-2','machineNumber','50002AutoFwp$r',
 'originalTransactionId',(90000000+n)::text,'siteId',4,
 'machineAuthorizationTime',to_char(date_trunc('second',now()-interval '2 days') at time zone 'America/New_York','YYYY-MM-DD"T"HH24:MI:SS'),
 'originalAmountCents',3210,'refundedAmountCents',3210,'currencyCode','USD','providerStatus',62,
 'evidenceReference','DTM:NAYAX-'||(90000000+n)::text,'cardLast4','4242','reviewedRefund',true,'reviewedMatch',true,'reviewedSentNotice',true,
 'notice',jsonb_build_object('senderEmail','info@bloomjoysweets.com','replyToEmail','info@bloomjoysweets.com',
 'recipientEmail',c.customer_email,'ccEmails',jsonb_build_array('recovery-operator@example.invalid'),
 'providerMessageId','a10000000000000'||n,'providerThreadId','a20000000000000'||n,'rfcMessageId','<recovery'||n||'@example.invalid>',
 'sentAt',now()-interval '1 day','subject','Refund confirmed','plainBody','Your full $32.10 refund for '||c.public_reference||' is confirmed. Please allow a few business days.'));
end; $$;
create temporary table recovery_input as select pg_temp.recovery_evidence(1) evidence;
grant select on recovery_input to authenticated;
select ok(not has_table_privilege('authenticated','public.refund_external_operator_recoveries','select')
 and not has_function_privilege('service_role','public.admin_reconcile_external_refund_and_notice(uuid,jsonb)','execute'),
 'Private evidence and authenticated-only recovery prevent service/session substitution');
set local role authenticated;
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence||'{"providerStatus":63}' from recovery_input))$$,'P4667',null,'Requested is not Refunded');
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence||'{"refundedAmountCents":3200}' from recovery_input))$$,'P4667',null,'Partial refund cannot masquerade as full refund');
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence||'{"expectedCaseVersion":0}' from recovery_input))$$,'P4667',null,'Stale case review is rejected');
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence||'{"cardLast4":"9999"}' from recovery_input))$$,'P4667',null,'Wrong card is rejected');
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select jsonb_set(evidence,'{notice,ccEmails}','[]') from recovery_input))$$,'P4667',null,'Missing manager CC is rejected');
select lives_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence from recovery_input))$$,'Corrected machine, full refund and existing sent notice commit together');
reset role;
set constraints all immediate;
select ok((select reporting_machine_id='bf300000-0000-4000-8000-000000000002'::uuid and status='needs_review' and decision is null
 and matched_nayax_amount_cents=3210 and refund_amount_cents=3210 and payment_amount_cents=3200
 and intake_selection_machine_ids=array['bf300000-0000-4000-8000-000000000001'::uuid] and intake_selection_kind='exact_machine'
 and intake_meta='{"sentinel":"original intake"}'::jsonb and nayax_match_execution_eligible is false
 and nayax_refund_execution_status='not_requested' and refund_completed_at is null
 from public.refund_cases where id='bf400000-0000-4000-8000-000000000001'),'Original report and actual provider total remain separate; no invented approval or execution');
select is(public.refund_lifecycle_contract('bf400000-0000-4000-8000-000000000001')->>'stage','customer_notified','Receipt and notice drive truthful lifecycle');
select ok(not exists(select 1 from public.refund_case_nayax_refund_attempts where refund_case_id='bf400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.refund_case_official_action_authorizations where refund_case_id='bf400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.refund_case_messages where refund_case_id='bf400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.refund_gmail_messages where refund_case_id='bf400000-0000-4000-8000-000000000001')
 and not exists(select 1 from public.sales_adjustment_facts where refund_case_id='bf400000-0000-4000-8000-000000000001'),
 'Recovery creates zero payment attempts, authorizations, messages, fake Gmail imports or accounting adjustments');
set local role authenticated;
select is(public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence from recovery_input))->>'status','already_recorded','Exact replay is idempotent');
select is(public.admin_get_refund_authoritative_receipt_overview('bf400000-0000-4000-8000-000000000001')->'receipt'->>'noticeVerification',
 'operator_observed','Operator mailbox proof is not presented as support ingestion or delivery');
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select jsonb_set(evidence,'{notice,subject}','"changed"') from recovery_input))$$,'P4667',null,'Conflicting replay is rejected');
reset role;
select throws_ok($$update public.refund_cases set correlation_status='manual_review'
 where id='bf400000-0000-4000-8000-000000000001'$$,'P4667',null,'Stale in-flight sweep cannot hide the confirmed receipt');
select throws_ok($$update public.refund_cases set incident_time_confidence='rough'
 where id='bf400000-0000-4000-8000-000000000001'$$,'P4667',null,'Original time confidence is immutable after recovery');
select throws_ok($$update public.refund_cases set customer_name='Changed'
 where id='bf400000-0000-4000-8000-000000000001'$$,'P4667',null,'Original customer facts are immutable after recovery');
select throws_ok($$update public.refund_external_operator_recoveries set cc_emails='{}'$$,'P4660',null,'Saved observed recipients are immutable');
select is((select count(*)::integer from public.refund_completion_notice_adoptions where refund_case_id='bf400000-0000-4000-8000-000000000001'),1,'Only one notice adoption exists');
update auth.sessions set not_after=now()-interval '1 minute' where id='bf010000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence from recovery_input))$$,'42501',null,'Expired sessions cannot replay evidence');
reset role;
select * from finish();
rollback;
