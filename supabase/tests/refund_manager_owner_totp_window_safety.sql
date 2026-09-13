begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(7);

create function pg_temp.capture_error(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate||':'||sqlerrm;
end;
$$;

create temporary table retired_enrollment_baseline as
select
  (select count(*) from public.refund_manager_totp_enrollments) enrollments,
  (select count(*) from public.refund_manager_step_up_audit) enrollment_audit,
  (select count(*) from public.refund_case_official_action_authorizations) receipts,
  (select count(*) from public.refund_case_nayax_refund_attempts) attempts;

select ok(to_regclass('public.refund_manager_totp_enrollments') is not null
  and to_regclass('public.refund_manager_step_up_audit') is not null,
  'Historical authenticator enrollment records remain readable for audit');

select ok(
  not has_function_privilege('authenticated',
    'public.open_refund_manager_totp_enrollment_window_current_user()','execute')
  and not has_function_privilege('authenticated',
    'public.close_refund_manager_totp_enrollment_window_current_user()','execute')
  and not has_function_privilege('service_role',
    'public.service_record_refund_manager_totp_enrollment(uuid,text)','execute')
  and not has_function_privilege('service_role',
    'public.service_compensate_refund_manager_totp_enrollment(uuid,text)','execute'),
  'Application and service identities cannot execute retired enrollment functions');

select ok(
  pg_temp.capture_error($sql$select public.open_refund_manager_totp_enrollment_window_current_user()$sql$)
    like '42501:%authenticator enrollment lane is retired%'
  and pg_temp.capture_error($sql$select public.close_refund_manager_totp_enrollment_window_current_user()$sql$)
    like '42501:%authenticator enrollment lane is retired%'
  and pg_temp.capture_error($sql$select public.service_record_refund_manager_totp_enrollment(null,null)$sql$)
    like '42501:%authenticator enrollment lane is retired%'
  and pg_temp.capture_error($sql$select public.service_compensate_refund_manager_totp_enrollment(null,null)$sql$)
    like '42501:%authenticator enrollment lane is retired%',
  'Database-owner calls to every retired enrollment writer fail closed');

select ok((select
    baseline.enrollments=(select count(*) from public.refund_manager_totp_enrollments)
    and baseline.enrollment_audit=(select count(*) from public.refund_manager_step_up_audit)
    and baseline.receipts=(select count(*) from public.refund_case_official_action_authorizations)
    and baseline.attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
  from retired_enrollment_baseline baseline),
  'Database-owner calls create no enrollment, audit, receipt, or attempt writes');

set local role service_role;
select set_config('test.enrollment_record_error',
  pg_temp.capture_error($sql$select public.service_record_refund_manager_totp_enrollment(null,null)$sql$),true);
select set_config('test.enrollment_compensate_error',
  pg_temp.capture_error($sql$select public.service_compensate_refund_manager_totp_enrollment(null,null)$sql$),true);
reset role;

select ok(current_setting('test.enrollment_record_error') like '42501:%'
  and current_setting('test.enrollment_compensate_error') like '42501:%',
  'Service-context enrollment and compensation calls fail closed');

select ok((select
    baseline.enrollments=(select count(*) from public.refund_manager_totp_enrollments)
    and baseline.enrollment_audit=(select count(*) from public.refund_manager_step_up_audit)
    and baseline.receipts=(select count(*) from public.refund_case_official_action_authorizations)
    and baseline.attempts=(select count(*) from public.refund_case_nayax_refund_attempts)
  from retired_enrollment_baseline baseline),
  'Service-context calls fail before any write');

select ok(not has_table_privilege('authenticated','public.refund_manager_totp_enrollments','insert')
  and not has_table_privilege('authenticated','public.refund_manager_totp_enrollments','update')
  and not has_table_privilege('service_role','public.refund_manager_totp_enrollments','insert'),
  'Historical enrollment records are not directly writable by application identities');

select * from finish();
rollback;
