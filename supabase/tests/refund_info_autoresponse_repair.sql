begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

select lives_ok($$insert into public.refund_gmail_primary_scheduler_dispatches
  (bucket_at,run_key,status,request_id) values
  ('2099-01-01 00:00Z','supabase-primary:20990101T0000Z','dispatched',-1455001),
  ('2099-01-01 00:10Z','supabase-primary:20990101T0010Z','dispatched',-1455001)$$,
  'A restarted transport sequence does not prevent a later primary dispatch');
select lives_ok($$insert into public.refund_gmail_scheduler_dispatches
  (bucket_at,run_key,status,request_id) values
  ('2099-01-01 00:00Z','supabase-recovery:20990101T0000Z','dispatched',-1455001),
  ('2099-01-01 00:05Z','supabase-recovery:20990101T0005Z','dispatched',-1455001)$$,
  'A restarted transport sequence does not prevent a later recovery dispatch');
select throws_ok($$insert into public.refund_gmail_primary_scheduler_dispatches
  (bucket_at,run_key,status,request_id) values
  ('2099-01-01 00:00Z','supabase-primary:20990101T0020Z','dispatched',-1455002)$$,
  '23505', null, 'Primary bucket uniqueness still prevents duplicate dispatch');
select throws_ok($$insert into public.refund_gmail_scheduler_dispatches
  (bucket_at,run_key,status,request_id) values
  ('2099-01-01 00:15Z','supabase-recovery:20990101T0005Z','dispatched',-1455002)$$,
  '23505', null, 'Recovery run-key uniqueness still prevents duplicate dispatch');
select ok(not has_function_privilege('authenticated',
  'public.service_get_refund_gmail_delivery_health()', 'execute'),
  'Raw cron health is unavailable to browser callers');

update public.refund_gmail_primary_scheduler_settings set enabled=true where singleton;
update public.refund_gmail_scheduler_settings set enabled=false where singleton;
delete from cron.job_run_details where jobid in
  (select jobid from cron.job where jobname='refund-gmail-sync-primary-v1');
-- Fixed synthetic IDs avoid touching the extension-owned runid sequence.
insert into cron.job_run_details (runid,jobid,status,start_time,end_time)
select -1455001,jobid,'failed',now()-interval '12 minutes',now()-interval '12 minutes'
from cron.job where jobname='refund-gmail-sync-primary-v1';
insert into cron.job_run_details (runid,jobid,status,start_time,end_time)
select -1455002,jobid,'failed',now()-interval '2 minutes',now()-interval '2 minutes'
from cron.job where jobname='refund-gmail-sync-primary-v1';
select is(public.service_get_refund_gmail_delivery_health()->>'failedSchedulerCount','1',
  'Repeated primary failures are visible even without worker run rows');
select is(public.service_get_refund_gmail_delivery_health()->>'status','failing',
  'Repeated scheduler failures degrade email delivery health');
select is(public.service_get_refund_workflow_health(true,true,true,false,false,
  array['info@bloomjoysweets.com'])->>'workflowStatus','degraded',
  'The existing coalesced alert pipeline sees Gmail delivery degradation');
select ok(public.service_get_refund_workflow_health(true,true,true,false,false,
  array['info@bloomjoysweets.com']) ?& array['customerClarificationDelivery','customerStatusDelivery','customerDelivery'],
  'Gmail health preserves the current clarification, status, and completion obligations');
insert into cron.job_run_details (runid,jobid,status,start_time,end_time)
select -1455003,jobid,'succeeded',now()-interval '1 minute',now()-interval '1 minute'
from cron.job where jobname='refund-gmail-sync-primary-v1';
select is(public.service_get_refund_gmail_delivery_health()->>'failedSchedulerCount','0',
  'A successful primary run clears its previous error without erasing history');
update public.refund_gmail_primary_scheduler_settings set enabled=false where singleton;
select is(public.service_get_refund_gmail_delivery_health()->>'failedSchedulerCount','0',
  'An intentionally disabled scheduler creates no false incident');

create temporary table repair_source as
select public.service_ingest_refund_gmail_contact_v1(
  repeat('8',64),'repair-synthetic-thread','repair-synthetic-message',
  '<repair-synthetic@example.test>',null,'inbound',false,
  'repair-customer@example.test','Synthetic Customer','info@bloomjoysweets.com',
  'Refund','The machine took my money',false,now()-interval '31 minutes',null,
  '[]'::jsonb,'{}'::text[],array['info@bloomjoysweets.com','refunds@bloomjoysweets.com'],
  'direct_human',false,false,'{}'::text[]) as result;
select public.service_mark_refund_info_inquiry(
  (select (result->>'messageId')::uuid from repair_source),'new_refund_inquiry');
select is(public.service_get_refund_gmail_delivery_health()->>'unansweredDueCount','1',
  'A recognized inquiry remains an observable delivery obligation');
select is(public.service_get_refund_workflow_health(true,true,true,false,false,
  array['info@bloomjoysweets.com'])->'gmailDelivery'->>'unansweredDueCount','1',
  'The same unanswered obligation reaches the existing health alert');
select * from finish();
rollback;
