create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
begin;
select no_plan();

select is((public.service_get_refund_completion_outbox_health()->>'payloadRedacted')::boolean,true,
  'health result is explicitly redacted');
select ok(public.service_get_refund_completion_outbox_health() ?& array[
  'sampleCount','queueToFirstProviderAttemptMedianSeconds','queueToFirstProviderAttemptP95Seconds',
  'agingQueuedCount','staleClaimedCount','definiteFailedCount','deliveryUnknownCount',
  'disabledContactDeferralCount','missingRouteCount'],
  'health result contains only the required aggregate dimensions');

delete from public.refund_completion_outbox_incidents;
create temporary table completion_health_claims(kind text,payload jsonb);
insert into completion_health_claims values('initial',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":0,"agingQueuedCount":1,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='initial'),'initial',
  'first actionable observation claims one incident notification');
insert into completion_health_claims values('coalesced',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":0,"agingQueuedCount":1,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='coalesced'),'none',
  'unchanged actionable health is coalesced');
update public.refund_completion_outbox_incidents set last_notification_claimed_at=now()-interval '25 hours';
insert into completion_health_claims values('reminder',
  public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":0,"agingQueuedCount":1,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb));
select is((select payload->>'notificationType' from completion_health_claims where kind='reminder'),'reminder',
  'daily reminder is bounded to the same incident');
select is((select count(*) from public.refund_completion_outbox_incidents where status='open'),1::bigint,
  'initial and reminder observations keep one open incident');

select is(public.service_claim_refund_completion_outbox_notification(
  '{"status":"healthy","sampleCount":1,"agingQueuedCount":0,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)->>'notificationType','none',
  'first healthy observation starts the stable recovery window');
update public.refund_completion_outbox_incidents set healthy_since=now()-interval '61 minutes';
select is(public.service_claim_refund_completion_outbox_notification(
  '{"status":"healthy","sampleCount":1,"agingQueuedCount":0,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)->>'notificationType','recovery',
  'stable health claims one recovery notification');
select is((select status from public.refund_completion_outbox_incidents),'resolved',
  'recovery closes the incident without deleting its ledger');

set local role authenticated;
select throws_ok('select * from public.refund_completion_outbox_incidents','42501',null,
  'incident ledger is private from authenticated callers');
select throws_ok('select public.service_get_refund_completion_outbox_health()','42501',null,
  'health RPC is private from authenticated callers');
reset role;

select * from finish();
rollback;
