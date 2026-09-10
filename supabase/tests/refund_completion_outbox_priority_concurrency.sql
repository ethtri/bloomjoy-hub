create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path=public,extensions;
select no_plan();
select extensions.dblink_connect('completion_priority_a','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=completion_priority_a');
select extensions.dblink_connect('completion_priority_b','host=db port='||current_setting('port')||
  ' dbname='||current_database()||' user=postgres password=postgres sslmode=disable application_name=completion_priority_b');
delete from public.refund_completion_outbox_incidents;
select extensions.dblink_send_query('completion_priority_a',$q$
  select public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":0,"agingQueuedCount":1,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)
$q$);
select extensions.dblink_send_query('completion_priority_b',$q$
  select public.service_claim_refund_completion_outbox_notification(
    '{"status":"action_needed","sampleCount":0,"agingQueuedCount":1,"staleClaimedCount":0,"definiteFailedCount":0,"deliveryUnknownCount":0,"disabledContactDeferralCount":0,"missingRouteCount":0,"payloadRedacted":true}'::jsonb)
$q$);
create temporary table completion_priority_results(payload jsonb);
insert into completion_priority_results select payload from extensions.dblink_get_result('completion_priority_a') as x(payload jsonb);
insert into completion_priority_results select payload from extensions.dblink_get_result('completion_priority_b') as x(payload jsonb);
select is((select count(*) from completion_priority_results where payload->>'notificationType'='initial'),1::bigint,
  'concurrent notification claims coalesce to one initial action');
select is((select count(*) from public.refund_completion_outbox_incidents where status='open'),1::bigint,
  'concurrent claims preserve one open incident');
select extensions.dblink_disconnect('completion_priority_a');
select extensions.dblink_disconnect('completion_priority_b');
delete from public.refund_completion_outbox_incidents;
select * from finish();
