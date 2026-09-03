begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
\ir fixtures/refund_external_operator_recovery.inc
create temporary table recovery_input as select pg_temp.recovery_evidence(1) evidence,intake_meta original_meta
 from public.refund_cases where id='bf400000-0000-4000-8000-000000000001';
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
 and intake_meta-array['manager_assignment_rule','manager_assignment_status','manager_assignment_active_mapping_count']
   =(select original_meta-array['manager_assignment_rule','manager_assignment_status','manager_assignment_active_mapping_count'] from recovery_input)
 and nayax_match_execution_eligible is false
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
-- Four current managers are a supported route, and every one must appear in CC.
insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',('bf000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 'authenticated','authenticated','recovery-manager-'||n||'@example.invalid','',now(),'{}','{}',now(),now() from generate_series(2,4) n;
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
select 'bf300000-0000-4000-8000-000000000002',id,email,'Supported four-manager fixture' from auth.users
 where id in ('bf000000-0000-4000-8000-000000000002','bf000000-0000-4000-8000-000000000003','bf000000-0000-4000-8000-000000000004');
create temporary table recovery_four_input as select jsonb_set(pg_temp.recovery_evidence(2),'{notice,ccEmails}',
 '["recovery-operator@example.invalid","recovery-manager-2@example.invalid","recovery-manager-3@example.invalid","recovery-manager-4@example.invalid"]') evidence;
grant select on recovery_four_input to authenticated;
set constraints all deferred;
set local role authenticated;
select lives_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000002',
 (select evidence from recovery_four_input))$$,'A supported four-manager route accepts verified CCs for all four');
reset role;
set constraints all immediate;
update auth.sessions set not_after=now()-interval '1 minute' where id='bf010000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.admin_reconcile_external_refund_and_notice('bf400000-0000-4000-8000-000000000001',
 (select evidence from recovery_input))$$,'42501',null,'Expired sessions cannot replay evidence');
reset role;
select * from finish();
rollback;
