begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(6);
\ir fixtures/refund_external_operator_recovery.inc

create temporary table recovery_before as
select to_jsonb(c) case_value,
  (select count(*) from public.refund_authoritative_receipts
    where refund_case_id=c.id) receipt_count,
  (select count(*) from public.refund_case_messages
    where refund_case_id=c.id) message_count,
  (select count(*) from public.sales_adjustment_facts
    where refund_case_id=c.id) adjustment_count
from public.refund_cases c
where c.id='bf400000-0000-4000-8000-000000000001';

select ok(
  not has_function_privilege('authenticated',
    'public.admin_reconcile_external_refund_and_notice(uuid,jsonb)','execute'),
  'Browser sessions cannot use the retired external card-recovery action'
);
select ok(
  not has_function_privilege('service_role',
    'public.admin_reconcile_external_refund_and_notice(uuid,jsonb)','execute'),
  'System services cannot use the retired external card-recovery action'
);
select ok(
  not has_function_privilege('anon',
    'public.admin_reconcile_external_refund_and_notice(uuid,jsonb)','execute'),
  'Anonymous sessions cannot use the retired external card-recovery action'
);

set local role authenticated;
select throws_ok(
  $$select public.admin_reconcile_external_refund_and_notice(
    'bf400000-0000-4000-8000-000000000001','{}'::jsonb)$$,
  '42501',null,
  'The retired external card-recovery action cannot be called from the portal'
);
reset role;

set local role service_role;
select throws_ok(
  $$select public.admin_reconcile_external_refund_and_notice(
    'bf400000-0000-4000-8000-000000000001','{}'::jsonb)$$,
  '42501',null,
  'The retired external card-recovery action cannot be called by a service'
);
reset role;

select ok(
  (select to_jsonb(c)=b.case_value
      and b.receipt_count=(select count(*) from public.refund_authoritative_receipts
        where refund_case_id=c.id)
      and b.message_count=(select count(*) from public.refund_case_messages
        where refund_case_id=c.id)
      and b.adjustment_count=(select count(*) from public.sales_adjustment_facts
        where refund_case_id=c.id)
    from public.refund_cases c cross join recovery_before b
    where c.id='bf400000-0000-4000-8000-000000000001'),
  'Rejected retired actions leave the case, receipts, messages and accounting unchanged'
);

select * from finish();
rollback;
