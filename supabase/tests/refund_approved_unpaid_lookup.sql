begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values (
  'fa410000-0000-4000-8000-000000000001',
  'authenticated','authenticated','lookup-manager@example.invalid','{}','{}'
);
insert into public.customer_accounts(id,name,account_type)
values ('fa420000-0000-4000-8000-000000000001','Approved lookup fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values (
  'fa430000-0000-4000-8000-000000000001',
  'fa420000-0000-4000-8000-000000000001',
  'Lookup fixture','America/New_York'
);
insert into public.reporting_machines(
  id,account_id,location_id,machine_label,status,nayax_machine_id,
  nayax_account_key,nayax_refunds_enabled
)
values (
  'fa440000-0000-4000-8000-000000000001',
  'fa420000-0000-4000-8000-000000000001',
  'fa430000-0000-4000-8000-000000000001',
  'Lookup fixture','active','APPROVED-LOOKUP-MACHINE',
  'APPROVED-LOOKUP-ACCOUNT',true
);
insert into public.reporting_machine_refund_managers(
  reporting_machine_id,manager_user_id,manager_email,grant_reason
)
values (
  'fa440000-0000-4000-8000-000000000001',
  'fa410000-0000-4000-8000-000000000001',
  'lookup-manager@example.invalid','Lookup fixture'
);

insert into public.refund_cases(
  id,public_reference,reporting_machine_id,reporting_location_id,customer_email,
  issue_summary,incident_at,incident_timezone,payment_method,payment_amount_cents,
  refund_amount_cents,card_last4,status,decision,decision_reason,decided_by,
  decided_at,correlation_status,correlation_source,deterministic_fact_version,
  nayax_refund_execution_status,customer_request_received_at,
  customer_request_received_source,incident_time_resolution,incident_time_confidence
)
values
  (
    'fa450000-0000-4000-8000-000000000001','RF-APPROVED-LOOKUP-1',
    'fa440000-0000-4000-8000-000000000001',
    'fa430000-0000-4000-8000-000000000001',
    'approved-customer@example.invalid','Synthetic old unbound approval',
    now()-interval '2 days','America/New_York','card',963,963,'4242',
    'needs_review','approved','Ordinary manager decision',
    'fa410000-0000-4000-8000-000000000001',now()-interval '1 day',
    'no_match','nayax',1,'not_requested',now()-interval '1 day',
    'hosted_refund_intake','exact','exact'
  ),
  (
    'fa450000-0000-4000-8000-000000000002','RF-UNDECIDED-LOOKUP-2',
    'fa440000-0000-4000-8000-000000000001',
    'fa430000-0000-4000-8000-000000000001',
    'undecided-customer@example.invalid','Synthetic undecided lookup',
    now()-interval '2 days','America/New_York','card',963,963,'4242',
    'needs_review',null,null,null,null,'no_match','nayax',1,'not_requested',
    now()-interval '1 day','hosted_refund_intake','exact','exact'
  );

create temporary table approved_before as
select to_jsonb(refund_case) as snapshot
from public.refund_cases refund_case
where id='fa450000-0000-4000-8000-000000000001';

select ok(
  has_function_privilege(
    'service_role',
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)',
    'execute'
  ),
  'Only the System can start a transaction lookup'
);

set local role service_role;
select throws_ok(
  $$select public.service_begin_refund_nayax_lookup(
    'fa450000-0000-4000-8000-000000000001',1,'manual',
    'fa410000-0000-4000-8000-000000000001'
  )$$,
  'P4622',
  'This older approval is not tied to an exact transaction and cannot be reused. It needs separate review.',
  'An old approval cannot be attached to a transaction after the decision'
);
select throws_ok(
  $$select public.service_begin_refund_nayax_lookup(
    'fa450000-0000-4000-8000-000000000001',1,'automatic',null
  )$$,
  'P4622',
  'This older approval is not tied to an exact transaction and cannot be reused. It needs separate review.',
  'The System cannot manufacture exact transaction authority from an old approval'
);
select is(
  public.service_begin_refund_nayax_lookup(
    'fa450000-0000-4000-8000-000000000002',1,'automatic',null
  )->>'status',
  'checking',
  'An undecided case keeps the normal System transaction lookup'
);
reset role;

select ok(
  (select snapshot from approved_before) = (
    select to_jsonb(refund_case)
    from public.refund_cases refund_case
    where id='fa450000-0000-4000-8000-000000000001'
  ),
  'Rejected old-approval lookup leaves the case unchanged'
);
select is(
  (select count(*)::integer from public.refund_case_events
   where refund_case_id='fa450000-0000-4000-8000-000000000001'),
  0,
  'Rejected old-approval lookup creates no event'
);
select is(
  (select count(*)::integer from public.refund_case_nayax_refund_attempts
   where refund_case_id='fa450000-0000-4000-8000-000000000001'),
  0,
  'Rejected old-approval lookup creates no refund attempt'
);
select is(
  (select count(*)::integer from public.refund_nayax_lookup_candidates
   where refund_case_id='fa450000-0000-4000-8000-000000000001'),
  0,
  'Rejected old-approval lookup creates no candidate'
);
select is(
  (select count(*)::integer from public.refund_case_messages
   where refund_case_id='fa450000-0000-4000-8000-000000000001'),
  0,
  'Rejected old-approval lookup sends no customer message'
);

select * from finish();
rollback;
