begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
  ('00000000-0000-0000-0000-000000000000','14250000-0000-4000-8000-000000000001',
    'authenticated','authenticated','ready-one@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','14250000-0000-4000-8000-000000000002',
    'authenticated','authenticated','ready-two@example.invalid','',now(),'{}','{}',now(),now()),
  ('00000000-0000-0000-0000-000000000000','14250000-0000-4000-8000-000000000003',
    'authenticated','authenticated','unrelated-admin@example.invalid','',now(),
    '{"role":"admin"}','{}',now(),now());
insert into public.customer_accounts(id,name,account_type)
values ('14251000-0000-4000-8000-000000000001','Synthetic ready account','customer');
insert into public.reporting_locations(id,account_id,name,timezone)
values ('14252000-0000-4000-8000-000000000001',
  '14251000-0000-4000-8000-000000000001','Synthetic ready location','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,refund_public_display_label)
values ('14253000-0000-4000-8000-000000000001',
  '14251000-0000-4000-8000-000000000001',
  '14252000-0000-4000-8000-000000000001','Private machine','Public sweets machine');
insert into public.reporting_machine_refund_managers
  (id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values ('14254000-0000-4000-8000-000000000001',
  '14253000-0000-4000-8000-000000000001',
  '14250000-0000-4000-8000-000000000001',
  'ready-one@example.invalid','Synthetic manager');

insert into public.refund_cases
  (id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
    zelle_payment_contact,status,automation_state,deterministic_fact_version,created_at)
values
  ('14255000-0000-4000-8000-000000000001','RF-READY-1',
    '14253000-0000-4000-8000-000000000001',
    '14252000-0000-4000-8000-000000000001',
    'private-customer@example.invalid','Private case details','2026-09-23T12:00:00Z',
    'cash',725,'private-zelle-contact','needs_review','under_review',1,'2026-09-23T12:00:00Z'),
  ('14255000-0000-4000-8000-000000000002','RF-UNPREPARED-2',
    '14253000-0000-4000-8000-000000000001',
    '14252000-0000-4000-8000-000000000001',
    'other-customer@example.invalid','Another private case','2026-09-23T12:00:00Z',
    'cash',725,'other-private-contact','needs_review','under_review',1,'2026-09-23T12:00:00Z');

-- The fixture substitutes only the #1429 service adapter to test the notice
-- boundary. Production proof must come from a completed claimed preparation,
-- never from this test-only function.
create or replace function public.refund_manager_preparation_snapshot(
  p_refund_case_id uuid,p_expected_action_version bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare fact_version bigint;
begin
  if p_refund_case_id not in ('14255000-0000-4000-8000-000000000001',
    '14255000-0000-4000-8000-000000000003',
    '14255000-0000-4000-8000-000000000004',
    '14255000-0000-4000-8000-000000000006') then return null; end if;
  select deterministic_fact_version into fact_version from public.refund_cases
  where id=p_refund_case_id and official_action_version=p_expected_action_version;
  if fact_version is null then return null; end if;
  return jsonb_build_object('proofId',p_refund_case_id,
    'preparedAt','2026-09-24T14:59:00Z',
    'evidenceBasis','cash_coverage_unavailable_researched',
    'summary','Cash coverage was unavailable; the saved research is ready for decision.',
    'officialActionVersion',p_expected_action_version,
    'deterministicFactVersion',fact_version,'payloadRedacted',true);
end $$;

select is(public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000001') ->> 'reason','ready_notice_disabled',
  'Immediate decision lane is disabled by default');
select is(public.service_refund_manager_ready_notice_snapshot(
  '14255000-0000-4000-8000-000000000002',
  '14250000-0000-4000-8000-000000000001')::text,null,
  'Destination-only intake has no preparation proof and cannot alert');
select is(public.service_refund_manager_ready_notice_snapshot(
  '14255000-0000-4000-8000-000000000001',
  '14250000-0000-4000-8000-000000000003')::text,null,
  'Unmapped admin cannot receive a ready projection');
select is(public.service_refund_manager_ready_notice_snapshot(
  '14255000-0000-4000-8000-000000000001',
  '14250000-0000-4000-8000-000000000001')->>'evidenceBasis',
  'cash_coverage_unavailable_researched',
  'Legitimate researched coverage-unavailable cash case can be prepared');

update public.refund_manager_ready_notice_settings set delivery_enabled=true where singleton;
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000001')->>'queuedCount','1',
  'Prepared case enters the existing notification action ledger once');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='decision_ready'),'1','One ready action is durable');
create temporary table first_claim as select public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000001') as value;
select is((select value->>'recipient' from first_claim),'ready-one@example.invalid',
  'Only currently mapped manager receives the claim');
select is((select value#>>'{projection,actionCode}' from first_claim),
  'send_cash_refund_and_confirm','Cash notice asks for payment then confirmation');
select ok(not (select value::text from first_claim) like any(array[
  '%private-customer@example.invalid%','%private-zelle-contact%',
  '%Private case details%','%Private machine%']),
  'Claim carries no customer contact, payout destination, or internal label');
select is(public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000001')->>'claimed','false',
  'Concurrent/replayed claim cannot duplicate a reserved manager notice');

update public.reporting_machine_refund_managers set status='revoked',
  revoked_at=statement_timestamp(),revoke_reason='Synthetic reassignment'
where id='14254000-0000-4000-8000-000000000001';
select is(public.service_mark_refund_manager_ready_notice_provider_started(
  (select (value->>'intentId')::uuid from first_claim),
  (select (value->>'claimToken')::uuid from first_claim),
  (select value->>'routeFingerprint' from first_claim),
  (select value->>'recipient' from first_claim))::text,'false',
  'Revocation before provider start blocks the old manager');
select is((select delivery_state from public.refund_manager_notification_actions
    where id=(select (value->>'intentId')::uuid from first_claim)),
  'known_not_sent','Revoked claim records known-no-send evidence');

insert into public.reporting_machine_refund_managers
  (id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values ('14254000-0000-4000-8000-000000000002',
  '14253000-0000-4000-8000-000000000001',
  '14250000-0000-4000-8000-000000000002',
  'ready-two@example.invalid','Synthetic replacement manager');
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000001')->>'queuedCount','1',
  'Current replacement gets an independent ready action');
create temporary table replacement_claim as select public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000001') as value;
select is((select value->>'recipient' from replacement_claim),'ready-two@example.invalid',
  'Replacement manager gets their own new intent');
select is(public.service_mark_refund_manager_ready_notice_provider_started(
  (select (value->>'intentId')::uuid from replacement_claim),
  (select (value->>'claimToken')::uuid from replacement_claim),
  (select value->>'routeFingerprint' from replacement_claim),
  (select value->>'recipient' from replacement_claim))::text,'true',
  'Current scope and preparation pass the provider boundary');
select is(public.service_complete_refund_manager_ready_notice(
  (select (value->>'intentId')::uuid from replacement_claim),
  (select (value->>'claimToken')::uuid from replacement_claim),
  'delivery_unknown')::text,'true','Unknown provider outcome stays held');
select is(public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000001')->>'claimed','false',
  'Unknown provider outcome is never blindly resent');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='decision_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000001'),'2',
  'Different current managers have separate action rows on one decision');

insert into public.refund_cases
  (id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
    zelle_payment_contact,status,automation_state,deterministic_fact_version,created_at)
values ('14255000-0000-4000-8000-000000000003','RF-LEGACY-READY-3',
  '14253000-0000-4000-8000-000000000001',
  '14252000-0000-4000-8000-000000000001',
  'legacy-customer@example.invalid','Private case details',
  '2026-09-23T12:00:00Z','cash',825,'legacy-zelle-contact',
  'needs_review','under_review',1,'2026-09-23T12:00:00Z');
create temporary table old_wallet_claim as select
  public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000003','wallet_match_ready',
    'legacy-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid']) as value;
select is((select value->>'claimed' from old_wallet_claim),'true',
  'Legacy wallet sender still claims through its original action path');
select is(public.service_mark_refund_manager_notification_provider_started(
  (select (value->>'actionId')::uuid from old_wallet_claim),
  (select (value->>'claimToken')::uuid from old_wallet_claim))::text,'true',
  'Legacy provider-start evidence remains on the shared ledger');
select is(public.service_complete_refund_manager_notification(
  (select (value->>'actionId')::uuid from old_wallet_claim),
  (select (value->>'claimToken')::uuid from old_wallet_claim),
  'sent','legacy-wallet-provider-id')::text,'true',
  'Legacy sent outcome remains durable');
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000003')->>'legacyReviewCount','1',
  'Ambiguous same-attention, same-recipient legacy notice enters owned reconciliation');
select is((select delivery_state from public.refund_manager_notification_actions
    where notice_reason='decision_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000003'),
  'ready_legacy_review','Ready path never blindly duplicates the old wallet email');
select is(public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000003')->>'claimed','false',
  'Unresolved legacy overlap blocks provider access');
select is((select delivery_state from public.refund_manager_notification_actions
    where id=(select (value->>'actionId')::uuid from old_wallet_claim)),
  'sent','The old accepted outcome is preserved, not overwritten');
update public.refund_cases set zelle_payment_contact='new-material-destination',
  deterministic_fact_version=deterministic_fact_version+1
where id='14255000-0000-4000-8000-000000000003';
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000003')->>'queuedCount','1',
  'A later materially different decision can create a new versioned action');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='decision_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000003'),
  '2','Old review and new material decision remain distinct records');

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,
  email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('00000000-0000-0000-0000-000000000000',
  '14250000-0000-4000-8000-000000000004','authenticated','authenticated',
  'ready-co-manager@example.invalid','',now(),'{}','{}',now(),now());
insert into public.reporting_machine_refund_managers
  (id,reporting_machine_id,manager_user_id,manager_email,grant_reason)
values ('14254000-0000-4000-8000-000000000004',
  '14253000-0000-4000-8000-000000000001',
  '14250000-0000-4000-8000-000000000004',
  'ready-co-manager@example.invalid','Synthetic simultaneous co-manager');
insert into public.refund_cases
  (id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
    zelle_payment_contact,status,automation_state,deterministic_fact_version,created_at)
values ('14255000-0000-4000-8000-000000000004','RF-CO-MANAGER-READY-4',
  '14253000-0000-4000-8000-000000000001',
  '14252000-0000-4000-8000-000000000001',
  'co-manager-customer@example.invalid','Private case details',
  '2026-09-23T12:00:00Z','cash',925,'co-manager-zelle-contact',
  'needs_review','under_review',1,'2026-09-23T12:00:00Z');
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000004')->>'queuedCount','2',
  'One prepared decision enqueues a distinct row for each current co-manager');
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000004')->>'queuedCount','0',
  'Replay does not record another enqueue for unchanged co-managers');
create temporary table co_manager_claims as
select public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000004') as value;
insert into co_manager_claims
select public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000004');
select is((select count(distinct value->>'recipient')::text from co_manager_claims),
  '2','Both co-managers claim independently without shared-address fanout');
select is(public.service_claim_next_refund_manager_ready_notice(
  '14255000-0000-4000-8000-000000000004')->>'claimed','false',
  'A third worker cannot claim either manager again');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='decision_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000004'),
  '2','Partial ready unique key admits exactly two manager rows');

-- Disabling the new lane must not let the old wallet path resend an accepted
-- or unknown outcome for the same material decision and current recipient.
update public.refund_manager_ready_notice_settings set delivery_enabled=false
where singleton;
create temporary table unknown_ready_wallet_attempt as select
  public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000001','wallet_match_ready',
    'private-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid']) as value;
select is((select value->>'reason' from unknown_ready_wallet_attempt),
  'ready_decision_already_notified',
  'Unknown ready outcome suppresses the legacy wallet reservation after rollback');
select is((select value->>'deliveryState' from unknown_ready_wallet_attempt),
  'delivery_unknown','Unknown provider outcome remains explicitly unresolved');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='wallet_match_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000001'),
  '0','Unknown ready outcome cannot create a second wallet action');

create temporary table sent_ready_claim as select value from co_manager_claims
  order by value->>'recipient' limit 1;
select is(public.service_mark_refund_manager_ready_notice_provider_started(
  (select (value->>'intentId')::uuid from sent_ready_claim),
  (select (value->>'claimToken')::uuid from sent_ready_claim),
  (select value->>'routeFingerprint' from sent_ready_claim),
  (select value->>'recipient' from sent_ready_claim))::text,'true',
  'A current co-manager can start the prepared ready notice');
select is(public.service_complete_refund_manager_ready_notice(
  (select (value->>'intentId')::uuid from sent_ready_claim),
  (select (value->>'claimToken')::uuid from sent_ready_claim),
  'sent','synthetic-ready-provider-id')::text,'true',
  'Accepted ready outcome is recorded on the shared ledger');
create temporary table sent_ready_wallet_attempt as select
  public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000004','wallet_match_ready',
    'co-manager-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid']) as value;
select is((select value->>'reason' from sent_ready_wallet_attempt),
  'ready_decision_already_notified',
  'Sent ready outcome suppresses legacy wallet reservation after rollback');
select is((select count(*)::text from public.refund_manager_notification_actions
    where notice_reason='wallet_match_ready' and refund_case_id=
      '14255000-0000-4000-8000-000000000004'),
  '0','Sent ready outcome cannot create a second wallet action');

create temporary table material_before as select
  public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000004',
    'send_cash_refund_and_confirm') as fingerprint;
update public.refund_cases set customer_name='Updated customer name',
  official_action_version=official_action_version+1
where id='14255000-0000-4000-8000-000000000004';
select is(public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000004',
    'send_cash_refund_and_confirm'),
  (select fingerprint from material_before),
  'Contact metadata and official-action version alone are not a new payout decision');
select is(public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000004','wallet_match_ready',
    'co-manager-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid'])->>'reason',
  'ready_decision_already_notified',
  'Nonmaterial version change does not reopen the old wallet send lane');
update public.refund_cases set zelle_payment_contact='changed-payout-destination'
where id='14255000-0000-4000-8000-000000000004';
select isnt(public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000004',
    'send_cash_refund_and_confirm'),
  (select fingerprint from material_before),
  'Changed payout destination creates a distinct material decision');
create temporary table changed_wallet_attempt as select
  public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000004','wallet_match_ready',
    'co-manager-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid']) as value;
select is((select value->>'claimed' from changed_wallet_attempt),'true',
  'A truly changed payout can enter the legacy lane after rollback');
select is(public.service_mark_refund_manager_notification_provider_started(
  (select (value->>'actionId')::uuid from changed_wallet_attempt),
  (select (value->>'claimToken')::uuid from changed_wallet_attempt))::text,'true',
  'Legacy provider boundary permits the genuinely changed payout');

create temporary table amount_before as select
  public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000004',
    'send_cash_refund_and_confirm') as fingerprint;
update public.refund_cases set payment_amount_cents=payment_amount_cents+100
where id='14255000-0000-4000-8000-000000000004';
select isnt(public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000004',
    'send_cash_refund_and_confirm'),
  (select fingerprint from amount_before),
  'Changed payout amount is materially different');

insert into public.refund_cases
  (id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
    status,automation_state,deterministic_fact_version,created_at)
values ('14255000-0000-4000-8000-000000000005','RF-CARD-MATERIAL-5',
  '14253000-0000-4000-8000-000000000001',
  '14252000-0000-4000-8000-000000000001',
  'card-customer@example.invalid','Private case details',
  '2026-09-23T12:00:00Z','card',1025,
  'needs_review','under_review',1,'2026-09-23T12:00:00Z');
create temporary table purchase_before as select
  public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000005',
    'approve_or_deny_request') as fingerprint;
update public.refund_cases set matched_nayax_transaction_id='synthetic-purchase-1'
where id='14255000-0000-4000-8000-000000000005';
select isnt(public.refund_manager_decision_material_fingerprint(
    '14255000-0000-4000-8000-000000000005',
    'approve_or_deny_request'),
  (select fingerprint from purchase_before),
  'Changed selected purchase creates a distinct material decision');

-- A legacy sender may reserve first and pause before provider access. The
-- ready lane may then send; the old provider-start marker must recheck.
insert into public.refund_cases
  (id,public_reference,reporting_machine_id,reporting_location_id,
    customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,
    zelle_payment_contact,status,automation_state,deterministic_fact_version,created_at)
values ('14255000-0000-4000-8000-000000000006','RF-RACE-6',
  '14253000-0000-4000-8000-000000000001',
  '14252000-0000-4000-8000-000000000001',
  'race-customer@example.invalid','Private case details',
  '2026-09-23T12:00:00Z','cash',1125,'race-zelle-contact',
  'needs_review','under_review',1,'2026-09-23T12:00:00Z');
create temporary table race_old_reservation as select
  public.service_begin_refund_manager_notification(
    '14255000-0000-4000-8000-000000000006','wallet_match_ready',
    'race-customer@example.invalid',array['mailbox@example.invalid'],
    array['ops@example.invalid']) as value;
select is((select value->>'claimed' from race_old_reservation),'true',
  'Legacy wallet action can reserve before a ready notice starts');
update public.refund_manager_ready_notice_settings set delivery_enabled=true
where singleton;
select is(public.service_enqueue_refund_manager_ready_notices(
  '14255000-0000-4000-8000-000000000006')->>'queuedCount','2',
  'Unstarted legacy reservation does not permanently block current managers');
create temporary table race_ready_claim as select
  public.service_claim_next_refund_manager_ready_notice(
    '14255000-0000-4000-8000-000000000006') as value;
select is(public.service_mark_refund_manager_ready_notice_provider_started(
  (select (value->>'intentId')::uuid from race_ready_claim),
  (select (value->>'claimToken')::uuid from race_ready_claim),
  (select value->>'routeFingerprint' from race_ready_claim),
  (select value->>'recipient' from race_ready_claim))::text,'true',
  'Ready lane can start when legacy sender has not contacted provider');
select is(public.service_complete_refund_manager_ready_notice(
  (select (value->>'intentId')::uuid from race_ready_claim),
  (select (value->>'claimToken')::uuid from race_ready_claim),
  'sent','synthetic-race-ready-provider-id')::text,'true',
  'Ready lane has accepted the same payout before legacy resumes');
select is(public.service_mark_refund_manager_notification_provider_started(
  (select (value->>'actionId')::uuid from race_old_reservation),
  (select (value->>'claimToken')::uuid from race_old_reservation))::text,'false',
  'Legacy provider boundary rejects a ready notice that won the race');
select is(public.service_complete_refund_manager_notification(
  (select (value->>'actionId')::uuid from race_old_reservation),
  (select (value->>'claimToken')::uuid from race_old_reservation),
  'known_not_sent')::text,'true',
  'Rejected old reservation settles as known not sent');

select * from finish();
rollback;
