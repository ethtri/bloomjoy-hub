-- Keep historical assignments, but reconcile only account/machine pairs that
-- the existing snapshot writer permits. Consolidated/revoked source profiles
-- must not make an otherwise authorized monthly report fail as a whole.
-- No rows, grants, refresh guards, issued statements or public contracts change.
do $report_scope$
declare
  definition text;
  anchor text := E'        and period.status <> ''voided''\n        and public.can_manage_operator_payout_account(actor_user_id, period.account_id)\n\n      union';
begin
  definition := replace(pg_get_functiondef(
    'public.get_current_pay_report_before_generation_status(date)'::regprocedure), chr(13), '');
  if (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'Assignment-derived Pay Report snapshot scope seam changed';
  end if;
  execute replace(definition, anchor,
    E'        and period.status <> ''voided''\n'
    || E'        and private.reporting_company_payroll_machine_matches(period.account_id, assignment.reporting_machine_id)\n'
    || E'        and public.can_manage_operator_payout_account(actor_user_id, period.account_id)\n\n      union');
end;
$report_scope$;
