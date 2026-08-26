-- Smooth manager refund lifecycle.
--
-- Routine Machine Managers keep the exact selection/confirmation/refund path.
-- Provider references, manual Nayax evidence, retry decisions, and technical
-- reconciliation move behind the Super Admin Refund Operations boundary.

alter function public.admin_get_refund_operations_overview()
  rename to admin_get_refund_operations_overview_pre_manager_lifecycle_v1;

revoke execute on function
  public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_operations_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
  actor_role text := auth.role();
  base_result jsonb;
begin
  -- Compatibility and privacy anchors retained from the delegated overview:
  -- current_lookup.status = 'claimed'; lookup_failed;
  -- Refresh transaction results; 'cardNetwork', refund_case.card_network;
  -- paymentInteraction; incidentTimeConfidence; issueCategory;
  -- productLabel; machineStatus; nearbyMachineAlerts.
  if actor_role not in ('authenticated', 'service_role')
    or (
      actor_role = 'authenticated'
      and (
        actor_user_id is null
        or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
      )
    ) then
    raise exception 'Authenticated refund session required'
      using errcode = '28000';
  end if;

  base_result :=
    public.admin_get_refund_operations_overview_pre_manager_lifecycle_v1();

  return base_result || jsonb_build_object(
    'refundOperationsAccess',
    actor_role = 'service_role' or public.is_super_admin(actor_user_id)
  );
end;
$$;

revoke execute on function public.admin_get_refund_operations_overview()
  from public, anon;
grant execute on function public.admin_get_refund_operations_overview()
  to authenticated, service_role;

alter function public.admin_get_refund_manual_nayax_context()
  rename to admin_get_refund_manual_nayax_context_pre_ops_v1;

revoke execute on function
  public.admin_get_refund_manual_nayax_context_pre_ops_v1()
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_manual_nayax_context()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_user_id uuid := auth.uid();
begin
  if auth.role() is distinct from 'authenticated'
    or actor_user_id is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Authenticated refund session required'
      using errcode = '28000';
  end if;

  if not public.is_super_admin(actor_user_id) then
    return '[]'::jsonb;
  end if;

  return public.admin_get_refund_manual_nayax_context_pre_ops_v1();
end;
$$;

revoke execute on function public.admin_get_refund_manual_nayax_context()
  from public, anon, service_role;
grant execute on function public.admin_get_refund_manual_nayax_context()
  to authenticated;

alter function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) rename to admin_create_refund_manual_nayax_candidate_pre_ops_v1;

revoke execute on function
  public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(
    uuid, bigint, text, text, text, integer, text
  ) from public, anon, authenticated, service_role;

create function public.admin_create_refund_manual_nayax_candidate(
  p_case_id uuid,
  p_expected_case_version bigint,
  p_portal_machine_reference text,
  p_provider_transaction_id text,
  p_machine_authorization_local_time text,
  p_amount_cents integer,
  p_card_last4 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Refund Operations administrator required'
      using errcode = '42501';
  end if;

  return public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(
    p_case_id,
    p_expected_case_version,
    p_portal_machine_reference,
    p_provider_transaction_id,
    p_machine_authorization_local_time,
    p_amount_cents,
    p_card_last4
  );
end;
$$;

revoke execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) from public, anon, service_role;
grant execute on function public.admin_create_refund_manual_nayax_candidate(
  uuid, bigint, text, text, text, integer, text
) to authenticated;

alter function public.admin_begin_refund_manual_nayax_portal(uuid, bigint)
  rename to admin_begin_refund_manual_nayax_portal_pre_ops_v1;

revoke execute on function
  public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(uuid, bigint)
  from public, anon, authenticated, service_role;

create function public.admin_begin_refund_manual_nayax_portal(
  p_case_id uuid,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Refund Operations administrator required'
      using errcode = '42501';
  end if;

  return public.admin_begin_refund_manual_nayax_portal_pre_ops_v1(
    p_case_id,
    p_expected_case_version
  );
end;
$$;

revoke execute on function public.admin_begin_refund_manual_nayax_portal(
  uuid, bigint
) from public, anon, service_role;
grant execute on function public.admin_begin_refund_manual_nayax_portal(
  uuid, bigint
) to authenticated;

alter function public.admin_get_refund_nayax_resolution_readiness(uuid)
  rename to admin_get_refund_nayax_resolution_readiness_pre_ops_v1;

revoke execute on function
  public.admin_get_refund_nayax_resolution_readiness_pre_ops_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.admin_get_refund_nayax_resolution_readiness(
  p_refund_case_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    return jsonb_build_object(
      'visible', false,
      'available', false,
      'blockReason', 'refund_operations_access_required',
      'payloadRedacted', true
    );
  end if;

  return public.admin_get_refund_nayax_resolution_readiness_pre_ops_v1(
    p_refund_case_id
  );
end;
$$;

revoke execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  from public, anon, service_role;
grant execute on function public.admin_get_refund_nayax_resolution_readiness(uuid)
  to authenticated;

alter function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  uuid, bigint
) rename to admin_begin_refund_nayax_evidence_reconcile_pre_ops_v1;

revoke execute on function
  public.admin_begin_refund_nayax_evidence_reconcile_pre_ops_v1(
    uuid, bigint
  ) from public, anon, authenticated, service_role;

create function public.admin_begin_refund_nayax_evidence_only_reconciliation(
  p_case_id uuid,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Refund Operations administrator required'
      using errcode = '42501';
  end if;

  return
    public.admin_begin_refund_nayax_evidence_reconcile_pre_ops_v1(
      p_case_id,
      p_expected_case_version
    );
end;
$$;

revoke execute on function
  public.admin_begin_refund_nayax_evidence_only_reconciliation(uuid, bigint)
  from public, anon, service_role;
grant execute on function
  public.admin_begin_refund_nayax_evidence_only_reconciliation(uuid, bigint)
  to authenticated;

alter function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) rename to admin_prepare_refund_nayax_resolution_intent_pre_ops_v1;

revoke execute on function
  public.admin_prepare_refund_nayax_resolution_intent_pre_ops_v1(
    uuid, uuid, text, text, text, timestamptz, text, bigint
  ) from public, anon, authenticated, service_role;

create function public.admin_prepare_refund_nayax_resolution_intent(
  p_case_id uuid,
  p_attempt_id uuid,
  p_resolution_result text,
  p_evidence_type text,
  p_evidence_reference text,
  p_evidence_occurred_at timestamptz,
  p_reason_code text,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Refund Operations administrator required'
      using errcode = '42501';
  end if;

  return public.admin_prepare_refund_nayax_resolution_intent_pre_ops_v1(
    p_case_id,
    p_attempt_id,
    p_resolution_result,
    p_evidence_type,
    p_evidence_reference,
    p_evidence_occurred_at,
    p_reason_code,
    p_expected_case_version
  );
end;
$$;

revoke execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) from public, anon, service_role;
grant execute on function public.admin_prepare_refund_nayax_resolution_intent(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) to authenticated;

alter function public.admin_resolve_refund_nayax_outcome_manager_session(
  uuid, uuid, text, text, text, timestamptz, text, bigint
) rename to admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1;

revoke execute on function
  public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(
    uuid, uuid, text, text, text, timestamptz, text, bigint
  ) from public, anon, authenticated, service_role;

create function public.admin_resolve_refund_nayax_outcome_manager_session(
  p_case_id uuid,
  p_attempt_id uuid,
  p_resolution_result text,
  p_evidence_type text,
  p_evidence_reference text,
  p_evidence_occurred_at timestamptz,
  p_reason_code text,
  p_expected_case_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'authenticated'
    or auth.uid() is null
    or not public.is_super_admin(auth.uid()) then
    raise exception 'Refund Operations administrator required'
      using errcode = '42501';
  end if;

  return public.admin_resolve_refund_nayax_outcome_manager_session_pre_ops_v1(
    p_case_id,
    p_attempt_id,
    p_resolution_result,
    p_evidence_type,
    p_evidence_reference,
    p_evidence_occurred_at,
    p_reason_code,
    p_expected_case_version
  );
end;
$$;

revoke execute on function
  public.admin_resolve_refund_nayax_outcome_manager_session(
    uuid, uuid, text, text, text, timestamptz, text, bigint
  ) from public, anon, service_role;
grant execute on function
  public.admin_resolve_refund_nayax_outcome_manager_session(
    uuid, uuid, text, text, text, timestamptz, text, bigint
  ) to authenticated;

select pg_notify('pgrst', 'reload schema');
