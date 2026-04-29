-- Harden existing SECURITY DEFINER RPC execute grants.
--
-- Classification:
-- - anon: no SECURITY DEFINER RPCs are intentionally unauthenticated.
-- - authenticated: browser-facing self-service RPCs, admin wrappers with
--   internal admin checks, and RLS helpers that policies call directly.
-- - service_role: all SECURITY DEFINER functions, including internal helpers
--   used by Edge Functions and wrapper RPCs.

do $$
declare
  fn record;
  locked_search_path_names constant text[] := array[
    'admin_scoped_grant_is_active',
    'corporate_partner_membership_is_active',
    'normalize_account_email',
    'normalize_corporate_partner_email',
    'normalize_operator_training_email',
    'normalize_reporting_match_text',
    'normalize_technician_email',
    'reporting_admin_assert_reason',
    'reporting_date_windows_overlap',
    'reporting_entitlement_is_active',
    'set_updated_at',
    'technician_assert_reason',
    'technician_assignment_is_active',
    'technician_grant_is_active'
  ];
  authenticated_rpc_names constant text[] := array[
    -- Authenticated self-service and route-context RPCs.
    'accept_customer_account_invite',
    'can_access_members_only_training',
    'can_access_technician_grant',
    'can_access_plus_portal',
    'create_report_export',
    'get_my_admin_access_context',
    'get_my_effective_access_context',
    'get_my_operator_training_grants',
    'get_my_plus_access',
    'get_my_portal_access_context',
    'get_my_reporting_access_context',
    'get_my_technician_grants',
    'get_my_technician_management_context',
    'get_partner_dashboard_partnerships',
    'get_portal_access_context',
    'get_reporting_dimensions',
    'get_sales_report',
    'grant_operator_training_access',
    'grant_technician_access',
    'issue_training_certificate',
    'resolve_my_technician_entitlements',
    'revoke_operator_training_access',
    'revoke_technician_access',
    'save_training_progress',
    'update_technician_machines',

    -- Auth-bound RLS helpers that must execute during policy evaluation.
    'has_my_active_customer_account_membership',
    'has_reporting_machine_access',
    'is_my_partner_on_customer_account',
    'is_reporting_account_member',
    'is_super_admin',

    -- Admin wrappers. These stay callable by signed-in users because the
    -- functions perform their own super-admin or scoped-admin checks.
    'admin_create_report_schedule',
    'admin_get_account_summaries',
    'admin_get_audit_log',
    'admin_get_corporate_partner_access_options',
    'admin_get_effective_access_context',
    'admin_get_partnership_reporting_setup',
    'admin_get_reporting_access_matrix',
    'admin_get_sunze_machine_mapping_queue',
    'admin_grant_corporate_partner_membership',
    'admin_grant_machine_report_access',
    'admin_grant_plus_access',
    'admin_grant_reporting_access',
    'admin_grant_scoped_admin_by_email',
    'admin_grant_super_admin_by_email',
    'admin_list_reporting_sync_runs',
    'admin_list_scoped_admin_grants',
    'admin_list_super_admin_roles',
    'admin_lookup_reporting_user_by_email',
    'admin_map_source_machine_to_partnership',
    'admin_preview_partner_period_report',
    'admin_preview_partner_weekly_report',
    'admin_reconcile_technician_entitlements',
    'admin_remove_reporting_partnership_party',
    'admin_revoke_corporate_partner_membership',
    'admin_revoke_plus_access',
    'admin_revoke_reporting_access',
    'admin_revoke_scoped_admin',
    'admin_revoke_super_admin',
    'admin_set_partnership_party_portal_access',
    'admin_set_reporting_machine_tax_rate',
    'admin_set_sunze_machine_discovery_status',
    'admin_set_user_machine_reporting_access',
    'admin_update_order_fulfillment',
    'admin_update_support_request',
    'admin_upsert_customer_machine_inventory',
    'admin_upsert_reporting_financial_rule',
    'admin_upsert_reporting_machine',
    'admin_upsert_reporting_machine_assignment',
    'admin_upsert_reporting_machine_tax_rate',
    'admin_upsert_reporting_partner',
    'admin_upsert_reporting_partnership',
    'admin_upsert_reporting_partnership_party'
  ];
begin
  for fn in
    select
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(locked_search_path_names)
  loop
    execute format(
      'alter function %I.%I(%s) set search_path = public',
      fn.nspname,
      fn.proname,
      fn.args
    );
  end loop;

  for fn in
    select
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      fn.nspname,
      fn.proname,
      fn.args
    );

    execute format(
      'grant execute on function %I.%I(%s) to service_role',
      fn.nspname,
      fn.proname,
      fn.args
    );

    if fn.proname = any(authenticated_rpc_names) then
      execute format(
        'grant execute on function %I.%I(%s) to authenticated',
        fn.nspname,
        fn.proname,
        fn.args
      );
    end if;
  end loop;
end $$;

select pg_notify('pgrst', 'reload schema');
