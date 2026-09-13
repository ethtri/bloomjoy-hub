begin;

create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(41);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin execute statement; return null;
exception when others then return sqlstate||':'||sqlerrm; end;
$$;

insert into auth.users(instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000001',
 'authenticated','authenticated','system-manager@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000002',
 'authenticated','authenticated','system-admin@example.test','',now(),'{}','{}',now(),now()),
('00000000-0000-0000-0000-000000000000','d1000000-0000-4000-8000-000000000003',
 'authenticated','authenticated','system-triage@example.test','',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values
('d1100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001',now(),now()),
('d1100000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002',now(),now()),
('d1100000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-000000000003',now(),now());
insert into public.admin_roles(id,user_id,role,active)
values('d1200000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000002','super_admin',true);
insert into public.customer_accounts(id,name,account_type)
values('d1300000-0000-4000-8000-000000000001','System saved approval','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('d1400000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001','System saved approval','America/Chicago');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status,
  nayax_machine_id,nayax_account_key,nayax_refunds_enabled,nayax_refund_max_amount_cents)
values('d1500000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001','System saved approval','active',
  'SYSTEM-SAVED-MACHINE','SYSTEM_SAVED_ACCOUNT',true,2500);
insert into public.reporting_machine_refund_managers(id,reporting_machine_id,
  manager_user_id,manager_email,grant_reason)
values('d1600000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001','system-manager@example.test',
  'System saved approval test');
insert into public.refund_nayax_provider_callers(caller_id,assertion_digest,status)
values('nayax-card-refund',encode(extensions.digest(
  convert_to('system-saved-executor','UTF8'),'sha256'),'hex'),'active')
on conflict(caller_id) do update set assertion_digest=excluded.assertion_digest,status='active';

insert into public.refund_cases(id,public_reference,reporting_machine_id,
  reporting_location_id,customer_email,issue_summary,incident_at,payment_method,
  payment_amount_cents,refund_amount_cents,card_last4,status,correlation_status,
  correlation_source,correlation_confidence,automation_state,
  matched_nayax_transaction_id,matched_nayax_amount_cents,matched_nayax_card_last4,
  matched_nayax_currency_code,matched_nayax_machine_auth_time,matched_nayax_site_id,
  nayax_recommendation_state,nayax_recommendation_policy_version,
  nayax_match_execution_eligible,nayax_refund_execution_status,intake_source)
select ('d1700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  'RF-SYSTEM-SAVED-'||n,'d1500000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001','system-'||n||'@example.test',
  'Exact approved refund for System continuation',
  '2026-09-01T18:17:09.810Z'::timestamptz-(n||' hours')::interval,
  'card',800,800,'4242',case when n=1 then 'correlated' else 'needs_review' end,
  'matched','nayax',1,'approved',
  'SYSTEM-SAVED-TX-'||n,800,'4242','USD',
  '2026-09-01T18:17:09.810Z'::timestamptz-(n||' hours')::interval,901,
  'high_confidence','2026-09-05.v11',true,'not_requested','form'
from generate_series(1,10) n;

insert into public.refund_gmail_threads(
  id,refund_case_id,mailbox_hash,provider_thread_id,thread_subject,
  first_message_at,latest_message_at,retention_expires_at)
values
  ('d1750000-0000-4000-8000-000000000003',
    'd1700000-0000-4000-8000-000000000003',repeat('b',64),
    'system-saved-original-thread','Original customer refund request',
    statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
    statement_timestamp()+interval '180 days'),
  ('d1750000-0000-4000-8000-000000000006',
    'd1700000-0000-4000-8000-000000000006',repeat('c',64),
    'system-saved-evidence-thread','Original customer refund request',
    statement_timestamp()-interval '2 days',statement_timestamp()-interval '2 days',
    statement_timestamp()+interval '180 days');

create function pg_temp.system_candidate_evidence(p_case_id uuid)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'selection_allowed',true,'is_recommended',true,'one_click_eligible',true,
    'recommendation_state','high_confidence','confidence_class','high_confidence',
    'policy_version','2026-09-05.v11',
    'identifier_policy_version','2026-09-05.identifier.v2',
    'customer_fact_version',c.deterministic_fact_version,
    'customer_credential_class','customer_card_last4',
    'provider_identifier_class','provider_card_last4',
    'card_last4_comparison','exact_support','card_network_comparison','missing',
    'payment_interaction_comparison','unknown','same_identifier_equivalence_proven',true,
    'identifier_review_state','exact_support','customer_correction_fields','[]'::jsonb,
    'hard_exclusions','[]'::jsonb,'reason_codes','[]'::jsonb,
    'lookup_account_scope','SYSTEM_SAVED_ACCOUNT',
    'lookup_provider_machine_id','SYSTEM-SAVED-MACHINE',
    'provider_machine_id','SYSTEM-SAVED-MACHINE',
    'machine_authorization_time_raw',to_char(c.matched_nayax_machine_auth_time
      at time zone 'America/Chicago','YYYY-MM-DD"T"HH24:MI:SS.MS'),
    'machine_authorization_at',c.matched_nayax_machine_auth_time,
    'machine_authorization_time_source','MachineAuthorizationTime',
    'machine_time_resolution','exact','provider_time_resolution','exact',
    'provider_time_source','authorization_gmt','authorized_at',c.matched_nayax_machine_auth_time,
    'customer_request_received_at','null'::jsonb,
    'customer_request_received_source','null'::jsonb,
    'request_time_boundary','within_window','transaction_occurrence_comparable',true,
    'transaction_occurrence_semantics','authorization_time',
    'transaction_occurrence_proof_source','provider',
    'transaction_occurrence_timestamp_source','MachineAuthorizationTime',
    'transaction_occurrence_timezone_basis','America/Chicago',
    'transaction_occurrence_lower_bound_at',c.matched_nayax_machine_auth_time,
    'transaction_occurrence_upper_bound_at',c.matched_nayax_machine_auth_time,
    'request_receipt_lower_bound_at',c.matched_nayax_machine_auth_time,
    'request_receipt_upper_bound_at',c.matched_nayax_machine_auth_time,
    'amount_delta_cents',0,'time_delta_minutes',0,
    'provider_processing_time_delta_minutes',0,'payment_status','approved',
    'payment_status_evidence','last_sales_contract','provider_refund_state','clear',
    'duplicate_provider_record',false,'card_last4','4242','currency_code','USD',
    'amount_cents',800,'provider_payload_redacted',true)
  from public.refund_cases c where c.id=p_case_id;
$$;

insert into public.refund_case_events(
  refund_case_id,actor_user_id,event_type,message,metadata)
select c.id,case when c.id='d1700000-0000-4000-8000-000000000001'::uuid
    then 'd1000000-0000-4000-8000-000000000003'::uuid
  when c.id='d1700000-0000-4000-8000-000000000002'::uuid
    then 'd1000000-0000-4000-8000-000000000002'::uuid
    else 'd1000000-0000-4000-8000-000000000001'::uuid end,
  'nayax_match_selected','Exact selected purchase',jsonb_build_object(
    'payload_redacted',true,'execution_eligible',true,
    'policy_version','2026-09-05.v11')
from public.refund_cases c where c.id::text like 'd1700000-%';
insert into public.refund_nayax_lookup_candidates(
  token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at,created_at)
select ('d1800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,c.id,
  c.nayax_lookup_generation,
  case when n=1 then 'd1000000-0000-4000-8000-000000000003'::uuid
    when n=2 then 'd1000000-0000-4000-8000-000000000002'::uuid
    else 'd1000000-0000-4000-8000-000000000001'::uuid end,
  c.reporting_machine_id,c.matched_nayax_transaction_id,c.matched_nayax_site_id,
  c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,
  c.matched_nayax_card_last4,c.matched_nayax_currency_code,
  pg_temp.system_candidate_evidence(c.id),case when n=1
    then now()-interval '1 hour' else now()+interval '1 hour' end,
  statement_timestamp()-interval '1 minute'
from generate_series(1,10) n
join public.refund_cases c
  on c.id=('d1700000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;

create temp table saved_approval_ids(case_id uuid primary key,authorization_id uuid);
grant select,insert on saved_approval_ids to authenticated,service_role;

select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d1100000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
reset role;
update public.refund_cases set matched_nayax_transaction_id='SYSTEM-SAVED-TX-1'
where id='d1700000-0000-4000-8000-000000000010';
set local role authenticated;
select ok(pg_temp.capture_error($sql$select
  public.admin_approve_selected_nayax_refund_for_system_v1(
    'd1700000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id='d1700000-0000-4000-8000-000000000001'))$sql$) like '23505:%'
  and not exists(select 1
    from public.refund_case_official_action_authorizations
    where refund_case_id='d1700000-0000-4000-8000-000000000001'),
  'A duplicate selected transaction rolls back before any manager approval is saved');
reset role;
update public.refund_cases set matched_nayax_transaction_id='SYSTEM-SAVED-TX-10'
where id='d1700000-0000-4000-8000-000000000010';
set local role authenticated;
insert into saved_approval_ids
select 'd1700000-0000-4000-8000-000000000001',
  (public.admin_approve_selected_nayax_refund_for_system_v1(
    'd1700000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id='d1700000-0000-4000-8000-000000000001'))
    ->>'authorizationId')::uuid;
insert into saved_approval_ids
select c.id,(public.admin_authorize_refund_official_action(c.id,'approve',
  c.official_action_version,'card_refund_pending','approved',null,'customer_owed',
  null,800,null,null,false,k.token,null)->>'authorizationId')::uuid
from public.refund_cases c join public.refund_nayax_lookup_candidates k
  on k.refund_case_id=c.id where c.id in (
    'd1700000-0000-4000-8000-000000000003',
    'd1700000-0000-4000-8000-000000000004',
    'd1700000-0000-4000-8000-000000000005',
    'd1700000-0000-4000-8000-000000000006',
    'd1700000-0000-4000-8000-000000000007',
    'd1700000-0000-4000-8000-000000000008',
    'd1700000-0000-4000-8000-000000000009',
    'd1700000-0000-4000-8000-000000000010');
reset role;

select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"d1100000-0000-4000-8000-000000000002","is_anonymous":false}',true);
set local role authenticated;
insert into saved_approval_ids
select c.id,(public.admin_authorize_refund_official_action(c.id,'approve',
  c.official_action_version,'card_refund_pending','approved',null,'customer_owed',
  null,800,null,null,false,k.token,null)->>'authorizationId')::uuid
from public.refund_cases c join public.refund_nayax_lookup_candidates k
  on k.refund_case_id=c.id
where c.id='d1700000-0000-4000-8000-000000000002';
reset role;

select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
set local role service_role;
select public.service_apply_refund_nayax_selection_approval(
  s.authorization_id,s.case_id,null,'customer_owed',null,800,k.token,null)
from saved_approval_ids s join public.refund_nayax_lookup_candidates k
  on k.refund_case_id=s.case_id
where s.case_id<>'d1700000-0000-4000-8000-000000000001';
reset role;

select ok((select count(*)=10 from public.refund_cases
  where id::text like 'd1700000-%' and status='card_refund_pending'
    and decision='approved' and nayax_refund_execution_status='not_requested')
  and exists(select 1
    from public.refund_case_official_action_authorizations approval
    join public.refund_nayax_lookup_candidates candidate
      on candidate.token=approval.selected_nayax_candidate_token
    where approval.refund_case_id='d1700000-0000-4000-8000-000000000001'
      and approval.actor_user_id='d1000000-0000-4000-8000-000000000001'
      and candidate.actor_user_id='d1000000-0000-4000-8000-000000000003'
      and approval.status='consumed'
      and approval.expected_case_version+1=(select official_action_version
        from public.refund_cases
        where id='d1700000-0000-4000-8000-000000000001')),
  'Agent A can save the exact sale and Manager B can later approve an aged correlated case once for System work');

update public.reporting_machine_refund_managers set status='revoked',
  revoked_at=statement_timestamp(),revoke_reason='Post-approval test change'
where id='d1600000-0000-4000-8000-000000000001';
update public.admin_roles set active=false
where id='d1200000-0000-4000-8000-000000000002';

select ok(pg_temp.capture_error(format(
  'select public.service_reserve_nayax_refund_manager_action_v5(%L,%L,%L,%s,%L,%s,%s,%s,%L,%L,%L,%L,%L,%L)',
  'system-saved-executor','d1000000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000003',0,
  'nayax-refund-'||repeat('f',64),800,0,0,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  repeat('0',64),'exact_source','empty_string')) like '42501:%'
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='d1700000-0000-4000-8000-000000000003')
  and not exists(select 1 from public.refund_nayax_system_saved_approval_receipts
    where refund_case_id='d1700000-0000-4000-8000-000000000003'),
  'A fresh manager key cannot race a saved human approval before System claims it');

create temp table system_claims(n integer primary key,result jsonb);
insert into system_claims values
(1,public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1)),
(2,public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1));

select ok(pg_temp.capture_error(format(
  'select public.service_reserve_nayax_refund_manager_action_v5(%L,%L,%L,%s,%L,%s,%s,%s,%L,%L,%L,%L,%L,%L)',
  'system-saved-executor','d1000000-0000-4000-8000-000000000001',
  result#>>'{claims,0,systemSavedApproval,caseId}',0,
  result#>>'{claims,0,providerWireContext,idempotencyKey}',800,0,0,'USD',
  'nayax-production-account-contract-v2','nayax-provider-journal-v3',
  repeat('0',64),'exact_source','empty_string')) like '42501:%'
  and (select count(*)=2 from public.refund_case_nayax_refund_attempts
    where system_saved_approval_receipt_id is not null),
  'Exact System idempotency cannot re-enter the manager or browser reservation lane')
from system_claims where n=1;

select ok((select count(*)=2 from public.refund_nayax_system_saved_approval_receipts
  where status='consumed') and (select count(*)=2
  from public.refund_case_nayax_refund_attempts
  where system_saved_approval_receipt_id is not null and actor_user_id is null),
  'System claims two approvals atomically after live access is removed');
select ok(exists(select 1 from public.refund_nayax_system_saved_approval_receipts
  where original_authority_kind='machine_manager') and exists(select 1
  from public.refund_nayax_system_saved_approval_receipts
  where original_authority_kind='super_admin'),
  'System preserves Manager and Super-admin authority snapshots');
select ok(not exists(select 1 from public.refund_case_events
  where event_type='nayax_system_saved_approval_reserved' and actor_user_id is not null),
  'System events use no human actor and retain the approver only in metadata');
select ok(not exists(select 1 from system_claims
  where result::text ilike '%SYSTEM_SAVED_ACCOUNT%'
    or result::text~*'accountKey|nayax_account_key'),
  'System claim payloads contain no account credential');
select ok(not exists(select 1 from system_claims
  where jsonb_array_length(result->'claims')<>1),
  'Each worker call claims exactly one approved case');
select ok(not exists(select 1 from public.refund_nayax_system_saved_approval_receipts receipt
  join public.refund_case_nayax_refund_attempts attempt
    on attempt.id=receipt.nayax_refund_attempt_id
  where not public.refund_nayax_system_saved_approval_attempt_valid_v1(
    receipt.id,attempt.id,receipt.refund_case_id)),
  'Changing current manager access does not invalidate immutable System authority');
select ok(not exists(select 1 from public.refund_cases c
  where c.id in (select refund_case_id from public.refund_nayax_system_saved_approval_receipts)
    and (public.refund_case_nayax_manager_readiness(
      'd1000000-0000-4000-8000-000000000001',c.id)->>'canIssueCardRefund')::boolean)
  and public.can_view_refund_system_finishing_status_v1(
    'd1000000-0000-4000-8000-000000000001',
    'd1700000-0000-4000-8000-000000000001')
  and not public.can_view_refund_system_finishing_status_v1(
    'd1000000-0000-4000-8000-000000000099',
    'd1700000-0000-4000-8000-000000000001'),
  'The original approver sees read-only System status after deactivation while an unrelated user is denied');

set local session_replication_role=replica;
update public.refund_case_nayax_refund_attempts
set created_at=statement_timestamp()-interval '10 minutes'
where system_saved_approval_receipt_id is not null;
set local session_replication_role=origin;
select ok((public.service_recover_stale_nayax_refund_attempts(
    'system-saved-executor')->>'releasedNoCallCount')::integer=0
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where system_saved_approval_receipt_id is not null and status<>'in_progress')
  and not exists(select 1 from public.refund_nayax_system_saved_approval_receipts
    where status<>'consumed'),
  'The legacy stale-attempt sweeper makes zero writes to System work');

-- Reclaim the same attempt after a simulated lost response. Test-only trigger
-- bypass changes only the clock so the service function exercises its real lock,
-- journal, token rotation, and typed payload path.
create temp table first_claim as
select result->'claims'->0 as payload from system_claims where n=1;
set local session_replication_role=replica;
update public.refund_case_nayax_refund_attempts set
  provider_claim_expires_at=statement_timestamp()-interval '1 second'
where id=(select (payload#>>'{attempt,attemptId}')::uuid from first_claim);
set local session_replication_role=origin;
create temp table reclaimed as select
  public.service_reclaim_nayax_system_saved_approval_no_call_v1(
    'system-saved-executor','SYSTEM_SAVED_ACCOUNT') as result;
select ok((select result->'claim'->'attempt'->>'id' from reclaimed)=
    (select payload#>>'{attempt,attemptId}' from first_claim)
  and (select result->'claim'->'systemSavedApproval'->>'systemSavedApprovalReceiptId'
    from reclaimed)=(select payload#>>'{systemSavedApproval,systemSavedApprovalReceiptId}'
    from first_claim),
  'A journal-proved no-call loss reclaims only the same receipt and attempt');
select ok((select public.refund_nayax_system_saved_approval_reservation_payload_v1(
    (payload#>>'{systemSavedApproval,systemSavedApprovalReceiptId}')::uuid,
    payload->>'providerClaimToken') is null from first_claim),
  'The old provider token is invalid immediately after safe reclaim');
select ok((select public.refund_nayax_system_saved_approval_reservation_payload_v1(
    (result#>>'{claim,systemSavedApproval,systemSavedApprovalReceiptId}')::uuid,
    result#>>'{claim,providerClaimToken}') is not null from reclaimed),
  'The rotated attempt lease remains valid without mutating approval authority');

-- Model a pre-migration human receipt by clearing only the two columns that did
-- not exist then. The exact unique candidate is reconstructed; ambiguity is not.
set local session_replication_role=replica;
update public.refund_case_official_action_authorizations set
  selected_nayax_candidate_token=null,selected_nayax_candidate_evidence_hash=null
where refund_case_id in ('d1700000-0000-4000-8000-000000000003',
  'd1700000-0000-4000-8000-000000000004');
insert into public.refund_nayax_lookup_candidates(
  token,refund_case_id,lookup_generation,actor_user_id,reporting_machine_id,
  provider_transaction_id,site_id,machine_authorization_time,amount_cents,
  card_last4,currency_code,evidence_summary,expires_at)
select 'd1800000-0000-4000-8000-000000000099',c.id,c.nayax_lookup_generation,
  'd1000000-0000-4000-8000-000000000001',c.reporting_machine_id,
  c.matched_nayax_transaction_id,c.matched_nayax_site_id,
  c.matched_nayax_machine_auth_time,c.matched_nayax_amount_cents,
  c.matched_nayax_card_last4,c.matched_nayax_currency_code,
  pg_temp.system_candidate_evidence(c.id),now()+interval '1 hour'
from public.refund_cases c where c.id='d1700000-0000-4000-8000-000000000004';
set local session_replication_role=origin;
select is(public.refund_backfill_unambiguous_legacy_saved_approvals_v1(),1,
  'Legacy backfill reconstructs only one unique exact candidate');
select ok((select selected_nayax_candidate_token is not null
  from public.refund_case_official_action_authorizations
  where refund_case_id='d1700000-0000-4000-8000-000000000003'),
  'A safe pre-migration approval becomes eligible for System claim');
select ok((select selected_nayax_candidate_token is null
  from public.refund_case_official_action_authorizations
  where refund_case_id='d1700000-0000-4000-8000-000000000004'),
  'Ambiguous legacy evidence remains unbound instead of guessing');
create temp table outcome_claims(case_kind text primary key,result jsonb);
insert into outcome_claims values('legacy_success',
  public.service_claim_due_nayax_system_saved_approvals_v1(
    'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1));
select ok((select jsonb_array_length(result->'claims')=1
    from outcome_claims where case_kind='legacy_success'),
  'The safely reconstructed legacy approval receives one System attempt');
select ok(jsonb_array_length((public.service_claim_due_nayax_system_saved_approvals_v1(
    'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1))->'claims')=0
  and exists(select 1 from public.refund_case_events
    where refund_case_id='d1700000-0000-4000-8000-000000000004'
      and event_type='nayax_system_saved_approval_held')
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='d1700000-0000-4000-8000-000000000004'),
  'Ambiguous legacy evidence is held with zero provider attempt');

set local session_replication_role=replica;
update public.refund_cases set matched_nayax_amount_cents=801
where id='d1700000-0000-4000-8000-000000000005';
set local session_replication_role=origin;
select ok(jsonb_array_length((public.service_claim_due_nayax_system_saved_approvals_v1(
    'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1))->'claims')=0
  and exists(select 1 from public.refund_case_events
    where refund_case_id='d1700000-0000-4000-8000-000000000005'
      and event_type='nayax_system_saved_approval_held')
  and not exists(select 1 from public.refund_case_nayax_refund_attempts
    where refund_case_id='d1700000-0000-4000-8000-000000000005'),
  'Evidence drift is held before any System receipt, attempt, or provider call');
insert into outcome_claims values
('unproved_rejection',public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1)),
('timeout',public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1)),
('unknown',public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1)),
('deferred_receipt',public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1)),
('late_collision',public.service_claim_due_nayax_system_saved_approvals_v1(
  'system-saved-executor','SYSTEM_SAVED_ACCOUNT','exact_source','empty_string',1));

create function pg_temp.record_system_stage(
  payload jsonb,stage_name text,event_name text,outcome_name text,
  contract_ok boolean,stage_failure text default null
)
returns jsonb language sql as $$
  select public.service_record_nayax_refund_provider_stage_v3(
    'system-saved-executor',(payload#>>'{attempt,attemptId}')::uuid,
    payload->>'providerClaimToken',stage_name,event_name,
    case when event_name='result' then 200 end,
    case when event_name='result' then outcome_name end,
    case when event_name='result' then contract_ok end,
    case when event_name='result' then stage_failure end,
    encode(extensions.digest(convert_to(payload#>>'{attempt,attemptId}'||'|'||
      stage_name||'|'||event_name,'UTF8'),'sha256'),'hex'),
    'nayax-production-account-contract-v2','nayax-provider-journal-v3',
    case when event_name='result' then true end,
    case when event_name='result' then 'application_json' end,
    case when event_name='result' then 'json_object' end,
    case when event_name='result' then '1_256' end,
    case when event_name='result' then true end,
    case when event_name='result' then true end,
    case when event_name='result' then true end,
    case when event_name='result' then true end,
    case when event_name='result' then true end,
    case when event_name='result' then 'string' end,
    case when event_name='result' then 'string' end,
    case when event_name='result' then true end);
$$;

create function pg_temp.settle_system(
  payload jsonb,outcome_name text,provider_status_value text,error_value text default null
)
returns jsonb language sql as $$
  select public.service_settle_nayax_system_saved_approval_v1(
    'system-saved-executor',(payload#>>'{attempt,attemptId}')::uuid,
    (payload#>>'{systemSavedApproval,systemSavedApprovalReceiptId}')::uuid,
    (payload#>>'{systemSavedApproval,caseId}')::uuid,
    payload#>>'{providerWireContext,idempotencyKey}',
    (payload#>>'{providerWireContext,originalAmountCents}')::integer,
    payload#>>'{providerWireContext,currencyCode}',payload->>'providerClaimToken',
    outcome_name,case when outcome_name='success' then
      'system-provider-reference-123' end,provider_status_value,error_value);
$$;

select pg_temp.record_system_stage(result->'claim','request','started',null,null)
from reclaimed;
set local session_replication_role=replica;
update public.refund_case_nayax_refund_attempts set
  provider_claim_expires_at=statement_timestamp()-interval '1 second'
where id=(select (result#>>'{claim,attempt,attemptId}')::uuid from reclaimed);
set local session_replication_role=origin;
create temp table started_reclaim as select
  public.service_reclaim_nayax_system_saved_approval_no_call_v1(
    'system-saved-executor','SYSTEM_SAVED_ACCOUNT') as result;
select ok((select result->'claim'='null'::jsonb and (result->>'held')::boolean
    from started_reclaim)
  and exists(select 1 from public.refund_nayax_system_saved_approval_receipts
    where id=(select (result#>>'{claim,systemSavedApproval,systemSavedApprovalReceiptId}')::uuid
      from reclaimed) and status='held'
      and hold_reason='provider_transport_may_have_started')
  and (select count(*)=1 from public.refund_case_nayax_refund_attempts
    where refund_case_id=(select (result#>>'{claim,systemSavedApproval,caseId}')::uuid
      from reclaimed)),
  'A request-stage journal makes reclaim hold the same attempt with no retry');

-- The safely reconstructed legacy approval proves the complete success path.
select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='legacy_success';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','accepted',true)
from outcome_claims where case_kind='legacy_success';
select pg_temp.record_system_stage(result->'claims'->0,'approve','started',null,null)
from outcome_claims where case_kind='legacy_success';
select pg_temp.record_system_stage(result->'claims'->0,'approve','result','succeeded',true)
from outcome_claims where case_kind='legacy_success';
create temp table settlement_results(case_kind text primary key,result jsonb);
insert into settlement_results
select 'success',pg_temp.settle_system(result->'claims'->0,'success',
  'approve_succeeded_contract_match') from outcome_claims where case_kind='legacy_success';
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_authoritative_receipts r on r.nayax_refund_attempt_id=a.id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000003'
      and c.status='completed' and c.reporting_adjustment_id=a.reporting_adjustment_id
      and a.status='succeeded' and a.provider_outcome='success'
      and allocation.allocation_state='refunded')
  and exists(select 1 from public.refund_case_events e
    where e.refund_case_id='d1700000-0000-4000-8000-000000000003'
      and e.event_type='authoritative_refund_receipt_recorded'
      and e.actor_user_id is null
      and e.metadata->>'original_approver_user_id'=
        'd1000000-0000-4000-8000-000000000001'),
  'System success records one case, adjustment, terminal receipt, and refunded allocation');
select ok((select not (pg_temp.settle_system(result->'claims'->0,'success',
    'approve_succeeded_contract_match')->>'updateApplied')::boolean
  from outcome_claims where case_kind='legacy_success')
  and (select count(*)=1 from public.refund_authoritative_receipts
    where refund_case_id='d1700000-0000-4000-8000-000000000003')
  and (select count(*)=1 from public.sales_adjustment_facts
    where refund_case_id='d1700000-0000-4000-8000-000000000003')
  and (select not (public.service_reconcile_proved_nayax_api_terminal(
      'd1700000-0000-4000-8000-000000000003',
      (result#>>'{claims,0,attempt,attemptId}')::uuid)->>'providerCallMade')::boolean
    from outcome_claims where case_kind='legacy_success'),
  'Exact System settlement and terminal-receipt replay make no provider call or duplicate');

create temp table system_completion as
select public.service_claim_nayax_refund_completion(
  'system-saved-executor',(result#>>'{claims,0,attempt,attemptId}')::uuid) result,
  (result#>>'{claims,0,attempt,attemptId}')::uuid attempt_id
from outcome_claims where case_kind='legacy_success';
select ok((select (result->>'claimed')::boolean and result->>'status'='pending'
    from system_completion)
  and (select count(*)=1 from public.refund_case_messages
    where nayax_refund_attempt_id=(select attempt_id from system_completion)),
  'System success is eligible for one exact customer-completion claim');
select ok((select public.service_finish_nayax_refund_completion(
      'system-saved-executor',attempt_id,'failed')->>'status'='failed'
    from system_completion)
  and exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    where a.id=(select attempt_id from system_completion)
      and c.status='completed' and a.status='succeeded'
      and a.provider_outcome='success'),
  'A completion-delivery failure never changes settled payment truth');

-- A fully matched v3 request rejection is the only release path.
select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from system_claims where n=2;
select pg_temp.record_system_stage(result->'claims'->0,'request','result','rejected',true)
from system_claims where n=2;
insert into settlement_results
select 'definitive_rejection',pg_temp.settle_system(result->'claims'->0,
  'rejected','request_rejected_contract_match','provider_rejected')
from system_claims where n=2;
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000002'
      and c.status='needs_review' and c.decision is null
      and c.nayax_refund_execution_status='not_requested'
      and a.safe_transport_stage='released_no_refund'
      and allocation.allocation_state='released'
      and allocation.release_reason='definitive_no_refund'),
  'Proved v3 rejection releases the allocation under a new decision generation');

-- A syntactically received but unproved rejection remains durable and held.
select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='unproved_rejection';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','rejected',
  false,'provider_semantic_mismatch')
from outcome_claims where case_kind='unproved_rejection';
insert into settlement_results
select 'unproved_rejection',pg_temp.settle_system(result->'claims'->0,
  'rejected','request_rejected_unproved','provider_semantic_mismatch')
from outcome_claims where case_kind='unproved_rejection';
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_system_saved_approval_receipts receipt
      on receipt.id=a.system_saved_approval_receipt_id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000006'
      and c.nayax_refund_execution_status='ambiguous'
      and a.status='ambiguous' and a.provider_outcome='rejected'
      and a.reconciliation_required and receipt.status='held'
      and allocation.allocation_state='reserved'),
  'Unproved rejection is retained as a reconciliation hold with no retry');

select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='timeout';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','unknown',
  false,'provider_network') from outcome_claims where case_kind='timeout';
insert into settlement_results
select 'timeout',pg_temp.settle_system(result->'claims'->0,
  'timeout','request_timeout','provider_timeout')
from outcome_claims where case_kind='timeout';
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_system_saved_approval_receipts receipt
      on receipt.id=a.system_saved_approval_receipt_id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000007'
      and c.nayax_refund_execution_status='ambiguous'
      and a.status='ambiguous' and a.provider_outcome='timeout'
      and a.reconciliation_required and receipt.status='held'
      and allocation.allocation_state='reserved'),
  'Timeout is terminally held for reconciliation with the allocation reserved');

select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='unknown';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','unknown',
  false,'provider_response_unknown') from outcome_claims where case_kind='unknown';
insert into settlement_results
select 'unknown',pg_temp.settle_system(result->'claims'->0,
  'unknown','request_response_unknown','provider_outcome_unknown')
from outcome_claims where case_kind='unknown';
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_system_saved_approval_receipts receipt
      on receipt.id=a.system_saved_approval_receipt_id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000008'
      and c.nayax_refund_execution_status='ambiguous'
      and a.status='ambiguous' and a.provider_outcome='unknown'
      and a.reconciliation_required and receipt.status='held'
      and allocation.allocation_state='reserved'),
  'Unknown outcome is terminally held with no retry and its allocation reserved');

select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='deferred_receipt';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','accepted',true)
from outcome_claims where case_kind='deferred_receipt';
select pg_temp.record_system_stage(result->'claims'->0,'approve','started',null,null)
from outcome_claims where case_kind='deferred_receipt';
select pg_temp.record_system_stage(result->'claims'->0,'approve','result','succeeded',true)
from outcome_claims where case_kind='deferred_receipt';
create function public.test_fail_system_terminal_receipt()
returns trigger language plpgsql as $$ begin
  if new.refund_case_id='d1700000-0000-4000-8000-000000000009'::uuid then
    raise exception 'synthetic terminal receipt failure';
  end if;
  return new;
end; $$;
create trigger test_fail_system_terminal_receipt
before insert on public.refund_authoritative_receipts for each row
execute function public.test_fail_system_terminal_receipt();
insert into settlement_results
select 'deferred_receipt',pg_temp.settle_system(result->'claims'->0,
  'success','approve_succeeded_contract_match')
from outcome_claims where case_kind='deferred_receipt';
drop trigger test_fail_system_terminal_receipt on public.refund_authoritative_receipts;
drop function public.test_fail_system_terminal_receipt();
select ok(exists(select 1 from public.refund_cases c
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=c.id
    where c.id='d1700000-0000-4000-8000-000000000009'
      and c.status='completed' and a.status='succeeded'
      and a.provider_outcome='success' and allocation.allocation_state='refunded')
  and not exists(select 1 from public.refund_authoritative_receipts
    where refund_case_id='d1700000-0000-4000-8000-000000000009')
  and exists(select 1 from public.refund_case_events
    where refund_case_id='d1700000-0000-4000-8000-000000000009'
      and event_type='terminal_refund_receipt_recording_deferred'
      and actor_user_id is null),
  'Terminal-receipt failure is deferred without rolling back confirmed payment truth');

create temp table system_form_completion as
select public.service_claim_nayax_refund_completion(
    'system-saved-executor',attempt_id) result,attempt_id
from (
  select (claim#>>'{attempt,attemptId}')::uuid attempt_id
  from (select result->'claims'->0 claim from outcome_claims
    where case_kind='deferred_receipt') source_claim
  cross join lateral public.service_reconcile_proved_nayax_api_terminal(
    'd1700000-0000-4000-8000-000000000009',
    (claim#>>'{attempt,attemptId}')::uuid) reconciled
) recovered;
select ok((select result->>'transport'='transactional_email'
      and result->>'status'='queued' and (result->>'claimed')::boolean
    from system_form_completion)
  and exists(select 1 from public.refund_case_messages message
    join public.refund_case_events event
      on event.refund_case_id=message.refund_case_id
      and event.metadata->>'message_id'=message.id::text
    where message.nayax_refund_attempt_id is null
      and message.refund_case_id='d1700000-0000-4000-8000-000000000009'
      and message.delivery_kind='automatic'
      and event.event_type='customer_message_queued'
      and event.actor_user_id is null
      and event.metadata->>'system_saved_approval_receipt_id' is not null),
  'A form-origin System success queues its customer notice without inventing a human executor');

set local session_replication_role=replica;
update public.refund_cases target set refund_business_fingerprint=source.refund_business_fingerprint
from public.refund_cases source
where target.id='d1700000-0000-4000-8000-000000000010'
  and source.id='d1700000-0000-4000-8000-000000000003';
set local session_replication_role=origin;
select pg_temp.record_system_stage(result->'claims'->0,'request','started',null,null)
from outcome_claims where case_kind='late_collision';
select pg_temp.record_system_stage(result->'claims'->0,'request','result','accepted',true)
from outcome_claims where case_kind='late_collision';
select pg_temp.record_system_stage(result->'claims'->0,'approve','started',null,null)
from outcome_claims where case_kind='late_collision';
select pg_temp.record_system_stage(result->'claims'->0,'approve','result','succeeded',true)
from outcome_claims where case_kind='late_collision';
insert into settlement_results
select 'late_collision',pg_temp.settle_system(result->'claims'->0,
  'success','approve_succeeded_contract_match')
from outcome_claims where case_kind='late_collision';
select ok(exists(select 1 from public.refund_accounting_exceptions exception
    join public.refund_case_nayax_refund_attempts a
      on a.id=exception.nayax_refund_attempt_id
    join public.refund_authoritative_receipts receipt
      on receipt.nayax_refund_attempt_id=a.id
    join public.refund_nayax_transaction_allocations allocation
      on allocation.refund_case_id=a.refund_case_id
    where a.refund_case_id='d1700000-0000-4000-8000-000000000010'
      and exception.status='open' and a.provider_outcome='success'
      and allocation.allocation_state='refunded')
  and not exists(select 1 from public.sales_adjustment_facts
    where refund_case_id='d1700000-0000-4000-8000-000000000010')
  and exists(select 1 from public.refund_case_events
    where refund_case_id='d1700000-0000-4000-8000-000000000010'
      and event_type='nayax_paid_accounting_exception_recorded'
      and actor_user_id is null and metadata->>'provider_call_made'='false'),
  'Late accounting collision stays paid, creates one review exception, and makes no provider call');

create temp table legacy_resolution_guard_state as
select a.id as attempt_id,a.refund_case_id,a.system_saved_approval_receipt_id,
  to_jsonb(a) as attempt_before,to_jsonb(c) as case_before,to_jsonb(r) as receipt_before
from public.refund_case_nayax_refund_attempts a
join public.refund_cases c on c.id=a.refund_case_id
join public.refund_nayax_system_saved_approval_receipts r
  on r.id=a.system_saved_approval_receipt_id
where a.refund_case_id='d1700000-0000-4000-8000-000000000006';
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select ok(pg_temp.capture_error(format(
  'select public.admin_prepare_refund_nayax_resolution_intent(%L,%L,%L,%L,%L,now(),%L,%s)',
  refund_case_id,attempt_id,'remain_on_hold','provider_reference','safe-reference-123',
  'provider_outcome_unknown',1)) like '42501:%'
  and (select to_jsonb(a)=s.attempt_before from public.refund_case_nayax_refund_attempts a
    where a.id=s.attempt_id)
  and (select to_jsonb(c)=s.case_before from public.refund_cases c
    where c.id=s.refund_case_id)
  and (select to_jsonb(r)=s.receipt_before
    from public.refund_nayax_system_saved_approval_receipts r
    where r.id=s.system_saved_approval_receipt_id),
  'Legacy resolution preparation rejects System work before any write')
from legacy_resolution_guard_state s;
select ok(pg_temp.capture_error(format(
  'select public.admin_consume_refund_nayax_resolution_intent(%L,%L,%L,%L,%L,%L,now(),%L,%L)',
  gen_random_uuid(),refund_case_id,attempt_id,'remain_on_hold','provider_reference',
  'safe-reference-123','provider_outcome_unknown','unused-proof')) like '42501:%'
  and (select to_jsonb(a)=s.attempt_before from public.refund_case_nayax_refund_attempts a
    where a.id=s.attempt_id)
  and (select to_jsonb(c)=s.case_before from public.refund_cases c
    where c.id=s.refund_case_id)
  and (select to_jsonb(r)=s.receipt_before
    from public.refund_nayax_system_saved_approval_receipts r
    where r.id=s.system_saved_approval_receipt_id),
  'Legacy resolution consumption rejects System work before any write')
from legacy_resolution_guard_state s;
reset role;
update public.admin_roles set active=true
where id='d1200000-0000-4000-8000-000000000002';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"d1100000-0000-4000-8000-000000000002","is_anonymous":false}',true);
set local role authenticated;
select ok((public.admin_get_refund_nayax_resolution_readiness(
    refund_case_id)->>'available')::boolean is false
  and public.admin_get_refund_nayax_resolution_readiness(refund_case_id)
    ->>'blockReason'='system_provider_hold_no_retry',
  'System outcome readiness gives visible exact-transaction, no-retry guidance without advertising the retired resolver')
from legacy_resolution_guard_state;
select ok(pg_temp.capture_error(format(
  'select public.admin_resolve_refund_nayax_outcome_manager_session(%L,%L,%L,%L,%L,now(),%L,%s)',
  refund_case_id,attempt_id,'remain_on_hold','nayax_support_ticket',
  'safe-reference-123','evidence_incomplete',1)) like '42501:%'
  and (select to_jsonb(a)=s.attempt_before from public.refund_case_nayax_refund_attempts a
    where a.id=s.attempt_id)
  and (select to_jsonb(c)=s.case_before from public.refund_cases c
    where c.id=s.refund_case_id)
  and (select to_jsonb(r)=s.receipt_before
    from public.refund_nayax_system_saved_approval_receipts r
    where r.id=s.system_saved_approval_receipt_id),
  'The Edge-called generic resolver rejects System work before any write or provider action')
from legacy_resolution_guard_state s;
reset role;
update public.reporting_machine_refund_managers
set status='active',revoked_at=null,revoke_reason=null
where id='d1600000-0000-4000-8000-000000000001';
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims',
  '{"sub":"d1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"d1100000-0000-4000-8000-000000000001","is_anonymous":false}',true);
set local role authenticated;
select ok(
  (result->>'caseCompleted')::boolean
  and result->>'systemSavedApprovalEvidence'='true'
  and result->>'providerCallMade'='false'
  and result->>'providerRetryMade'='false'
  and exists(select 1 from public.refund_case_nayax_refund_attempts attempt
    where attempt.id=(result->>'attemptId')::uuid
      and attempt.status='succeeded' and attempt.provider_outcome='success'
      and attempt.support_resolution_id is not null)
  and exists(select 1 from public.refund_cases refund_case
    where refund_case.id='d1700000-0000-4000-8000-000000000006'
      and refund_case.status='completed' and refund_case.refund_completed_at is not null)
  and exists(select 1 from public.refund_case_messages message
    where message.refund_case_id='d1700000-0000-4000-8000-000000000006'
      and message.message_type='completed'
      and message.nayax_refund_attempt_id=(result->>'attemptId')::uuid)
  and exists(select 1 from public.refund_case_events event
    where event.refund_case_id='d1700000-0000-4000-8000-000000000006'
      and event.event_type='nayax_system_outcome_evidence_recorded'
      and event.metadata->>'provider_call_made'='false'
      and event.metadata->>'provider_retry_made'='false'),
  'Assigned Manager can record verified System outcome evidence and complete the case without a provider call or retry')
from lateral (select public.admin_record_nayax_system_outcome_evidence_v1(
  'd1700000-0000-4000-8000-000000000006',attempt_id,
  'provider_confirmed_success','nayax_support_ticket',
  'SUPPORT:NAYAX-CS1500666',statement_timestamp(),
  'nayax_support_confirmed_success',
  (select official_action_version from public.refund_cases
    where id='d1700000-0000-4000-8000-000000000006')) result
  from legacy_resolution_guard_state) recorded;
reset role;
select set_config('request.jwt.claim.role','service_role',true);
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select ok(not has_function_privilege('authenticated',
  'public.service_claim_due_nayax_system_saved_approvals_v1(text,text,text,text,integer)',
  'execute') and has_function_privilege('service_role',
  'public.service_claim_due_nayax_system_saved_approvals_v1(text,text,text,text,integer)',
  'execute'),
  'Only the trusted service worker can create a System reservation');
select set_config('bloomjoy.system_saved_approval_writer','service_creator_v1',true);
set local role service_role;
select ok(pg_temp.capture_error($sql$insert into
    public.refund_nayax_system_saved_approval_receipts default values$sql$)
    like '42501:%',
  'The internal transition marker grants no direct System receipt write authority');
reset role;
select set_config('bloomjoy.system_saved_approval_writer','',true);
select ok(pg_temp.capture_error($sql$update public.refund_nayax_system_saved_approval_receipts
  set original_actor_user_id='d1000000-0000-4000-8000-000000000002'
  where status='consumed'$sql$) like '%evidence is immutable%',
  'System authority evidence cannot be rewritten');

select * from finish();
rollback;
