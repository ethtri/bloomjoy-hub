begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email) values
 ('fc810000-0000-4000-8000-000000000001','gift-review-manager@example.invalid'),
 ('fc810000-0000-4000-8000-000000000002','gift-review-unassigned@example.invalid');
insert into public.customer_accounts(id,name,account_type)
 values('fc820000-0000-4000-8000-000000000001','Gift review fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
 values('fc830000-0000-4000-8000-000000000001','fc820000-0000-4000-8000-000000000001','Gift review location','UTC');
insert into public.reporting_machines(id,account_id,location_id,machine_label,status)
 values('fc840000-0000-4000-8000-000000000001','fc820000-0000-4000-8000-000000000001',
 'fc830000-0000-4000-8000-000000000001','Gift review machine','active');
insert into public.reporting_machine_refund_managers(reporting_machine_id,manager_user_id,manager_email,grant_reason)
 values('fc840000-0000-4000-8000-000000000001','fc810000-0000-4000-8000-000000000001','gift-review-manager@example.invalid','Synthetic gift review');
insert into public.refund_gift_card_pools(id,provider,provider_account_id,face_value_cents,
 eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
 values('fc850000-0000-4000-8000-000000000001','kemore','gift-review-fixture',1000,
 array['fc840000-0000-4000-8000-000000000001']::uuid[],array['Gift review location'],
 now()+interval '30 days',true,'Synthetic redemption terms');
insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,provider_code_id,code,valid_from,expires_at)
 values('fc850000-0000-4000-8000-000000000001','kemore','gift-review-fixture','synthetic-stock','PRIVATE-CODE-1728',
 now()-interval '1 day',now()+interval '30 days');
-- Actual gift insert path: partial delivery requires Manager review before any
-- allocator effect. No preparation adapter or canonical lifecycle is mocked.
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
 customer_email,issue_summary,issue_category,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
 affected_amount_cents,resolution_method,gift_card_pool_id,gift_card_value_cents,gift_card_expires_at,gift_card_state,
 customer_request_received_at,customer_request_received_source)
 select ('fc860000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'RF-GIFT-REVIEW-'||n,
 'fc840000-0000-4000-8000-000000000001','fc830000-0000-4000-8000-000000000001',
 'private-gift-customer-'||n||'@example.invalid','Synthetic partial delivery','partial_items',now(),
 case when n=1 then 'cash' else 'card' end,1100,900,900,
 'gift_card','fc850000-0000-4000-8000-000000000001',1000,now()+interval '29 days','pending_inventory',
 now(),'hosted_refund_intake' from generate_series(1,2) n;

create function pg_temp.gift_snapshot(p_case integer default 1)
returns jsonb language sql volatile as $$
 select public.service_refund_manager_ready_notice_snapshot(
 ('fc860000-0000-4000-8000-'||lpad(p_case::text,12,'0'))::uuid,
 'fc810000-0000-4000-8000-000000000001',statement_timestamp());
$$;
select is((select count(*)::int from public.refund_cases where gift_card_state='manager_review'),2,
 'Actual cash and card gift producers establish Manager review');
select is((select count(*)::int from public.refund_gift_card_issuances),0,'Review creates no issuance');
select is(pg_temp.gift_snapshot()->>'schemaVersion','refund_manager_ready_notice_v2','Gift uses the canonical ready contract');
select is(pg_temp.gift_snapshot()->>'evidenceBasis','gift_card_manager_review','Gift has a distinct presentation basis');
select is(pg_temp.gift_snapshot(2)->>'evidenceBasis','gift_card_manager_review','Original card tender remains a gift decision');
select is(pg_temp.gift_snapshot()->>'amountCents','1000','Amount is accepted gift face value, not purchase or affected refund amount');
select is(pg_temp.gift_snapshot()->>'currencyCode','USD','Currency comes from current gift terms');
select is(pg_temp.gift_snapshot()->'proofId','null'::jsonb,'Gift never invents card or cash proof');
select is(pg_temp.gift_snapshot()->'recommendationKind','null'::jsonb,'Gift never invents a recommendation');
select ok(pg_temp.gift_snapshot()::text not like '%PRIVATE-CODE%' and pg_temp.gift_snapshot()::text not like '%example.invalid%',
 'Gift presentation excludes code and customer identity');
select is(public.service_refund_manager_ready_notice_snapshot('fc860000-0000-4000-8000-000000000001',
 'fc810000-0000-4000-8000-000000000002'),null::jsonb,'Unassigned Manager cannot see the gift presentation');
update auth.users set banned_until=now()+interval '1 day' where id='fc810000-0000-4000-8000-000000000001';
select is(pg_temp.gift_snapshot(),null::jsonb,'Suspended user cannot receive gift presentation');
update auth.users set banned_until=null,deleted_at=now() where id='fc810000-0000-4000-8000-000000000001';
select is(pg_temp.gift_snapshot(),null::jsonb,'Deleted user cannot receive gift presentation');
update auth.users set deleted_at=null where id='fc810000-0000-4000-8000-000000000001';
create temporary table gift_before as select pg_temp.gift_snapshot() snapshot;
select is(public.refund_manager_daily_digest_projection_for('fc810000-0000-4000-8000-000000000001')->>'actionCount','2',
 'Both gift decisions are included in the canonical daily audit');
select is((select count(*)::int from jsonb_array_elements(public.refund_manager_daily_digest_projection_for(
 'fc810000-0000-4000-8000-000000000001')->'items') item where item->>'evidenceBasis'='gift_card_manager_review'),2,
 'No gift case is skipped or reinterpreted as cash payout');
update public.refund_gift_card_codes set status='revoked' where pool_id='fc850000-0000-4000-8000-000000000001';
select is(pg_temp.gift_snapshot()->>'preparationSummary','Partial order.', 'Stockout preserves the actual review reason without promising stock');
select is(pg_temp.gift_snapshot()->>'decisionFingerprint',(select snapshot->>'decisionFingerprint' from gift_before),
 'Inventory availability change cannot generate another decision interruption');
select lives_ok($$select public.refund_manager_daily_digest_projection_for('fc810000-0000-4000-8000-000000000001')$$,
 'Stockout does not erase the outstanding decision or break its digest');
update public.refund_gift_card_codes set status='available' where pool_id='fc850000-0000-4000-8000-000000000001';
update public.refund_gift_card_pools set enabled=false where id='fc850000-0000-4000-8000-000000000001';
select is(pg_temp.gift_snapshot()->>'preparationSummary','Partial order.', 'Inactive pool preserves the review reason without promising issuance');
select lives_ok($$select public.refund_manager_daily_digest_projection_for('fc810000-0000-4000-8000-000000000001')$$,
 'Inactive pool does not break the daily audit');
update public.refund_gift_card_pools set enabled=true where id='fc850000-0000-4000-8000-000000000001';
select is(public.service_refund_manager_ready_notice_snapshot('fc860000-0000-4000-8000-000000000001',
 'fc810000-0000-4000-8000-000000000001',now()+interval '31 days')->>'decisionFingerprint',
 (select snapshot->>'decisionFingerprint' from gift_before),
 'Clock expiry stays represented without creating a different decision or claiming issuance readiness');
select is(pg_temp.gift_snapshot()->>'decisionFingerprint',(select snapshot->>'decisionFingerprint' from gift_before),
 'Returning to the same material preparation restores the same semantic identity');

update private.email_alert_delivery_settings set delivery_enabled=true,activated_at=now()-interval '1 hour';
select is(public.service_enqueue_refund_manager_ready_notices('fc860000-0000-4000-8000-000000000001')->>'queuedCount','0',
 'Optional ready delivery remains off without a subscription');
insert into public.email_alert_preferences(user_id,alert_id,enabled,scope_mode,machine_ids,enabled_since)
 values('fc810000-0000-4000-8000-000000000001','decision-ready',true,'selected',
 array['fc840000-0000-4000-8000-000000000001']::uuid[],now()-interval '1 hour');
insert into public.email_alert_profiles(user_id,timezone,quiet_enabled,daily_time)
 values('fc810000-0000-4000-8000-000000000001','UTC',false,date_trunc('minute',now() at time zone 'UTC')::time);
select is(public.service_enqueue_refund_manager_ready_notices('fc860000-0000-4000-8000-000000000001')->>'queuedCount','1',
 'Explicitly subscribed Manager queues one gift decision');
select ok((select ready_proof_id is null and ready_evidence_basis='gift_card_manager_review'
 from public.refund_manager_notification_actions where notice_reason='decision_ready'),
 'Durable identity explicitly records gift review without a fabricated proof');
select throws_ok($$update public.refund_manager_notification_actions set ready_evidence_basis=null
 where notice_reason='decision_ready'$$,'23514',null,'Ordinary approval still requires its actual proof');
select throws_ok($$update public.refund_manager_notification_actions set ready_proof_id=gen_random_uuid()
 where notice_reason='decision_ready'$$,'23514',null,'Gift basis rejects an invented preparation proof');
select is(public.service_enqueue_refund_manager_ready_notices('fc860000-0000-4000-8000-000000000001')->>'queuedCount','0',
 'Repeated producer evaluation deduplicates the same gift decision');
create temporary table gift_claim as select public.service_claim_next_refund_manager_ready_notice(
 'fc860000-0000-4000-8000-000000000001') c;
select is((select c->>'claimed' from gift_claim),'true','Subscribed gift decision uses the existing claim');
update public.refund_gift_card_pools set redemption_instructions='Revised synthetic terms' where id='fc850000-0000-4000-8000-000000000001';
select is((select public.service_mark_refund_manager_ready_notice_provider_started(
 (c->>'intentId')::uuid,(c->>'claimToken')::uuid,c->>'routeFingerprint',c->>'recipient') from gift_claim),false,
 'Gift terms changed after claim cannot cross the provider boundary');
select ok((select provider_attempt_started_at is null from public.refund_manager_notification_actions where notice_reason='decision_ready'),
 'Stale gift remains definitely unsent');
select is(public.service_enqueue_refund_manager_ready_notices('fc860000-0000-4000-8000-000000000001')->>'queuedCount','1',
 'Current changed preparation can create its own semantic decision identity');
truncate gift_claim;
insert into gift_claim select public.service_claim_next_refund_manager_ready_notice('fc860000-0000-4000-8000-000000000001');
select is((select c->>'claimed' from gift_claim),'true','Current revised gift presentation can be reserved');
update public.reporting_machine_refund_managers set status='revoked',revoked_at=now(),revoke_reason='Synthetic revoke'
 where manager_user_id='fc810000-0000-4000-8000-000000000001';
select is(pg_temp.gift_snapshot(),null::jsonb,'Revocation removes gift presentation authority');
select is((select public.service_mark_refund_manager_ready_notice_provider_started(
 (c->>'intentId')::uuid,(c->>'claimToken')::uuid,c->>'routeFingerprint',c->>'recipient') from gift_claim),false,
 'Revoked gift assignment cannot cross the provider boundary');
update public.reporting_machine_refund_managers set status='active',revoked_at=null,revoke_reason=null
 where manager_user_id='fc810000-0000-4000-8000-000000000001';

-- Metadata version changes refresh the existing identity; they are not new work.
create temporary table gift_current as select pg_temp.gift_snapshot() snapshot;
set local session_replication_role=replica;
update public.refund_cases set official_action_version=official_action_version+1,deterministic_fact_version=deterministic_fact_version+1
 where id='fc860000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(pg_temp.gift_snapshot()->>'decisionFingerprint',(select snapshot->>'decisionFingerprint' from gift_current),
 'Metadata-only version change keeps the same material gift identity');
select isnt(pg_temp.gift_snapshot()->>'officialActionVersion',(select snapshot->>'officialActionVersion' from gift_current),
 'Current official version is still carried for claim validation');
set local session_replication_role=replica;
update public.refund_cases set affected_amount_cents=850 where id='fc860000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select isnt(pg_temp.gift_snapshot()->>'decisionFingerprint',(select snapshot->>'decisionFingerprint' from gift_current),
 'Changed affected amount invalidates material gift preparation');

-- Shared scheduler regression: a gift-bearing daily projection must not throw
-- before later subscribed new-request candidates can be admitted.
insert into public.email_alert_preferences(user_id,alert_id,enabled,enabled_since)
 values('fc810000-0000-4000-8000-000000000001','new-refund',true,now()-interval '1 hour');
create temporary table gift_shared_claims as select public.service_claim_next_email_alert(now()) c;
select is((select c->>'claimed' from gift_shared_claims),'true','Shared dispatcher admits current subscribed work');
-- Category order is intentionally not assumed. Two new requests and one daily
-- are due; every category must be admitted through the actual shared claim.
insert into gift_shared_claims select public.service_claim_next_email_alert(now());
insert into gift_shared_claims select public.service_claim_next_email_alert(now());
select ok(exists(select 1 from gift_shared_claims where c#>>'{projection,category}'='daily' and c->>'claimed'='true'),
 'Shared dispatcher admits the gift-bearing daily projection without a canonical snapshot error');
select ok(exists(select 1 from gift_shared_claims where c#>>'{projection,category}'='new-refund' and c->>'claimed'='true'),
 'Operational new-request work is also admitted in the same shared dispatch cycle');
select lives_ok($$select private.email_alert_projection('fc810000-0000-4000-8000-000000000001',
 'weekly',now(),current_date-7,current_date-1)$$,'Weekly projection also consumes the canonical gift snapshot');

set local session_replication_role=replica;
update public.refund_cases set gift_card_state='pending_inventory' where id='fc860000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(pg_temp.gift_snapshot(),null::jsonb,'Pending inventory is not a Manager gift decision');
set local session_replication_role=replica;
update public.refund_cases set gift_card_state='denied',decision='denied',status='denied' where id='fc860000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(pg_temp.gift_snapshot(),null::jsonb,'Denied gift is not a ready decision');
set local session_replication_role=replica;
update public.refund_cases set gift_card_state='issued',decision='approved',status='completed' where id='fc860000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is(pg_temp.gift_snapshot(),null::jsonb,'Issued gift or unknown notice delivery never creates another decision');
select is((select count(*)::int from public.refund_gift_card_issuances),0,'Presentation and notification testing never issued a gift');
select is((select count(*)::int from public.refund_case_nayax_refund_attempts),0,'Presentation never prepared or attempted a payment');
select is((select count(*)::int from public.refund_manager_notification_actions where provider_attempt_started_at is not null),0,
 'No ready test reached an actual mail provider');
select ok(not has_function_privilege('authenticated','public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)','execute'),
 'Clients cannot obtain service-only snapshots');
select ok(not has_function_privilege('service_role','public.service_refund_ready_snapshot_pre_gift_review_v1(uuid,uuid,timestamptz)','execute'),
 'Legacy implementation cannot be called to bypass the gift adapter');
select * from finish();
rollback;
