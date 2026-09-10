create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
begin;
select no_plan();

delete from public.refund_completion_outbox_incidents;
create temporary table completion_health_claims(kind text,payload jsonb);
insert into completion_health_claims values('initial',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":1,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='initial'),'initial',
  'first actionable observation claims one incident notification');
select ok((select pending_notification_type='initial' and initial_notification_sent_at is null
  from public.refund_completion_outbox_incidents),
  'initial claim does not record notification success before email');
insert into completion_health_claims values('while_claimed',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":1,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='while_claimed'),'none',
  'concurrent unchanged health coalesces behind the active alert claim');
update public.refund_completion_outbox_incidents set notification_claimed_at=now()-interval '6 minutes';
insert into completion_health_claims values('crash_retry',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":1,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='crash_retry'),'initial',
  'stale crashed alert claim is reclaimed promptly');
select is((select payload->>'actionKey' from completion_health_claims where kind='crash_retry'),
  (select payload->>'actionKey' from completion_health_claims where kind='initial'),
  'crash retry preserves the provider idempotency action key');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='crash_retry'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='crash_retry'),'failed')->>'outcome','failed',
  'definite send failure releases the two-phase claim');
insert into completion_health_claims values('initial_retry',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":1,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='initial_retry'),'initial',
  'failed initial alert rearms promptly');
select is((select payload->>'actionKey' from completion_health_claims where kind='initial_retry'),
  (select payload->>'actionKey' from completion_health_claims where kind='initial'),
  'initial retry preserves the provider idempotency action key');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='initial_retry'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='initial_retry'),'sent')->>'outcome','sent',
  'initial success settles only after email acceptance');

insert into completion_health_claims values('changed',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":2,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='changed'),'changed',
  'materially changed actionable health claims a bounded update alert');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='changed'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='changed'),'sent')->>'outcome','sent',
  'changed alert settles after send');
select is(public.service_claim_refund_completion_outbox_notification(
  '{"status":"action_needed","sampleCount":4,"agingQueuedCount":2,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)->>'notificationType','none',
  'unchanged actionable health is coalesced');

update public.refund_completion_outbox_incidents set last_notification_sent_at=now()-interval '25 hours';
insert into completion_health_claims values('reminder',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":4,"agingQueuedCount":2,"staleClaimedCount":1,"definiteFailedCount":1,"deliveryUnknownCount":1,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='reminder'),'reminder',
  'daily reminder is bounded to the same incident');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='reminder'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='reminder'),'sent')->>'outcome','sent',
  'reminder success advances the incident only after send');

select is(public.service_claim_refund_completion_outbox_notification(
  '{"status":"healthy","sampleCount":4,"agingQueuedCount":0,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)->>'notificationType','none',
  'first healthy observation starts the stable recovery window');
update public.refund_completion_outbox_incidents set healthy_since=now()-interval '61 minutes';
insert into completion_health_claims values('recovery',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"healthy","sampleCount":4,"agingQueuedCount":0,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='recovery'),'recovery',
  'stable health claims one recovery notification');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='recovery'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='recovery'),'failed')->>'outcome','failed',
  'failed recovery email leaves the open incident eligible for retry');
insert into completion_health_claims values('recovery_retry',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"healthy","sampleCount":4,"agingQueuedCount":0,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='recovery_retry'),'recovery',
  'failed recovery alert rearms promptly');
select is(public.service_settle_refund_completion_outbox_notification(
  (select (payload->>'incidentId')::uuid from completion_health_claims where kind='recovery_retry'),
  (select (payload->>'claimToken')::uuid from completion_health_claims where kind='recovery_retry'),'sent')->>'outcome','sent',
  'recovery closes only after email acceptance');
select is((select status from public.refund_completion_outbox_incidents),'resolved',
  'recovery preserves the closed incident ledger');

set local role authenticated;
select throws_ok('select * from public.refund_completion_outbox_incidents','42501',null,
  'incident ledger is private from authenticated callers');
select throws_ok($$select public.service_get_refund_completion_outbox_health('{}'::text[],true,true,true)$$,
  '42501',null,'health RPC is private from authenticated callers');
select throws_ok($$select public.service_settle_refund_completion_outbox_notification(
  '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','failed')$$,
  '42501',null,'incident settlement is private from authenticated callers');
reset role;

select * from finish();
rollback;
