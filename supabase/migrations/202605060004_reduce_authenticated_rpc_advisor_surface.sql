-- Issue #347: reduce the authenticated SECURITY DEFINER RPC advisor surface.
--
-- Categories:
-- - Browser-facing wrappers and RLS helpers stay authenticated. That includes
--   auth.uid()-bound route context RPCs, admin wrappers with internal checks,
--   and helpers directly called by active RLS policies.
-- - The functions below are service-role/internal or legacy helper surfaces.
--   They are not current browser RPC entrypoints and should not remain
--   PostgREST probes for signed-in users.
--
-- Function-to-function calls from SECURITY DEFINER wrappers continue to work
-- through the function owner. Edge Functions and controlled operations keep
-- service_role execute where needed.

revoke execute on function public.can_access_partner_dashboard(uuid, uuid, date, date)
  from public, anon, authenticated;
grant execute on function public.can_access_partner_dashboard(uuid, uuid, date, date)
  to service_role;
comment on function public.can_access_partner_dashboard(uuid, uuid, date, date) is
  'Internal partner-dashboard access predicate. Browser callers must use get_partner_dashboard_partnerships() or admin_preview_partner_period_report().';

revoke execute on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text)
  to service_role;
comment on function public.admin_grant_machine_report_access(text, uuid, uuid, uuid, text, text) is
  'Internal reporting-access grant helper. Browser callers must use admin_grant_reporting_access() or admin_set_user_machine_reporting_access().';

revoke execute on function public.create_report_export(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_report_export(uuid, jsonb)
  to service_role;
comment on function public.create_report_export(uuid, jsonb) is
  'Legacy reporting snapshot helper superseded by the sales-report-export Edge Function.';

revoke execute on function public.admin_list_reporting_sync_runs(integer)
  from public, anon, authenticated;
grant execute on function public.admin_list_reporting_sync_runs(integer)
  to service_role;
comment on function public.admin_list_reporting_sync_runs(integer) is
  'Legacy reporting sync-run helper kept for service-role/internal operations, not direct browser RPC access.';

revoke execute on function public.admin_reconcile_technician_entitlements(text)
  from public, anon, authenticated;
grant execute on function public.admin_reconcile_technician_entitlements(text)
  to service_role;
comment on function public.admin_reconcile_technician_entitlements(text) is
  'Technician entitlement reconciliation helper kept for service-role/internal operations, not direct browser RPC access.';

select pg_notify('pgrst', 'reload schema');
