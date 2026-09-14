-- Complete the single-decision authority cutover for cash actions. A current
-- Machine Manager or Super-admin may make the one decision; downstream service
-- work must preserve that exact authority without assuming a machine mapping.

do $authority_consumer$
declare
  body text;
  old_text text;
  new_text text;
begin
  body := replace(pg_get_functiondef(
    'public.consume_refund_official_action_authorization(uuid,uuid,text,text,text,text,text,text,integer,text,timestamptz,boolean,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');

  old_text := E'  manager_mapping public.reporting_machine_refund_managers%rowtype;\n'
    || E'  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;';
  new_text := E'  manager_mapping public.reporting_machine_refund_managers%rowtype;\n'
    || E'  super_admin_role public.admin_roles%rowtype;\n'
    || E'  nayax_candidate public.refund_nayax_lookup_candidates%rowtype;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official authorization declaration shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'  select manager.*\n'
    || E'  into manager_mapping\n'
    || E'  from public.reporting_machine_refund_managers manager\n'
    || E'  where manager.id = authorization_row.manager_mapping_id\n'
    || E'    and manager.reporting_machine_id = refund_case.reporting_machine_id\n'
    || E'    and manager.manager_user_id = authorization_row.actor_user_id\n'
    || E'    and manager.mapping_version = authorization_row.manager_mapping_version\n'
    || E'    and manager.status = ''active''\n'
    || E'    and manager.revoked_at is null\n'
    || E'  for share;\n\n'
    || E'  if not found then\n'
    || E'    raise exception ''Machine Manager mapping changed before the official action'';\n'
    || E'  end if;';
  new_text := E'  if authorization_row.authority_kind = ''machine_manager'' then\n'
    || E'    select manager.*\n'
    || E'    into manager_mapping\n'
    || E'    from public.reporting_machine_refund_managers manager\n'
    || E'    where manager.id = authorization_row.manager_mapping_id\n'
    || E'      and manager.reporting_machine_id = refund_case.reporting_machine_id\n'
    || E'      and manager.manager_user_id = authorization_row.actor_user_id\n'
    || E'      and manager.mapping_version = authorization_row.manager_mapping_version\n'
    || E'      and manager.status = ''active''\n'
    || E'      and manager.revoked_at is null\n'
    || E'    for share;\n\n'
    || E'    if not found then\n'
    || E'      raise exception ''Machine Manager mapping changed before the official action'';\n'
    || E'    end if;\n'
    || E'  elsif authorization_row.authority_kind = ''super_admin'' then\n'
    || E'    select role_row.*\n'
    || E'    into super_admin_role\n'
    || E'    from public.admin_roles role_row\n'
    || E'    where role_row.id = authorization_row.super_admin_role_id\n'
    || E'      and role_row.user_id = authorization_row.actor_user_id\n'
    || E'      and role_row.role = ''super_admin''\n'
    || E'      and role_row.active\n'
    || E'    for share;\n\n'
    || E'    if not found then\n'
    || E'      raise exception ''Super-admin authority changed before the official action'';\n'
    || E'    end if;\n'
    || E'  else\n'
    || E'    raise exception ''Official action authority is invalid'';\n'
    || E'  end if;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official authorization authority check shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'  return jsonb_build_object(\n'
    || E'    ''actorUserId'', authorization_row.actor_user_id,\n'
    || E'    ''managerMappingId'', authorization_row.manager_mapping_id,\n'
    || E'    ''managerMappingVersion'', authorization_row.manager_mapping_version,\n'
    || E'    ''expectedCaseVersion'', authorization_row.expected_case_version,\n'
    || E'    ''action'', authorization_row.action\n'
    || E'  );';
  new_text := E'  return jsonb_build_object(\n'
    || E'    ''actorUserId'', authorization_row.actor_user_id,\n'
    || E'    ''authorityKind'', authorization_row.authority_kind,\n'
    || E'    ''authorityRecordId'', case\n'
    || E'      when authorization_row.authority_kind = ''machine_manager'' then authorization_row.manager_mapping_id\n'
    || E'      else authorization_row.super_admin_role_id\n'
    || E'    end,\n'
    || E'    ''authorityVersion'', case\n'
    || E'      when authorization_row.authority_kind = ''machine_manager'' then authorization_row.manager_mapping_version\n'
    || E'      else 1\n'
    || E'    end,\n'
    || E'    ''managerMappingId'', authorization_row.manager_mapping_id,\n'
    || E'    ''managerMappingVersion'', authorization_row.manager_mapping_version,\n'
    || E'    ''expectedCaseVersion'', authorization_row.expected_case_version,\n'
    || E'    ''action'', authorization_row.action\n'
    || E'  );';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official authorization return shape';
  end if;

  execute replace(body, old_text, new_text);
end;
$authority_consumer$;

do $official_case_update$
declare
  body text;
  old_text text;
  new_text text;
begin
  body := replace(pg_get_functiondef(
    'public.service_apply_refund_official_case_update(uuid,uuid,text,text,text,text,text,text,integer,text,uuid,text)'::regprocedure
  ), E'\r\n', E'\n');

  old_text := E'  actor_user_id uuid;\n'
    || E'  manager_mapping_id uuid;\n'
    || E'  manager_mapping_version bigint;\n'
    || E'  candidate public.refund_nayax_lookup_candidates%rowtype;';
  new_text := E'  actor_user_id uuid;\n'
    || E'  authority_kind text;\n'
    || E'  authority_record_id uuid;\n'
    || E'  authority_version bigint;\n'
    || E'  candidate public.refund_nayax_lookup_candidates%rowtype;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official case update declaration shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'  actor_user_id := (authorization_context ->> ''actorUserId'')::uuid;\n'
    || E'  manager_mapping_id := (authorization_context ->> ''managerMappingId'')::uuid;\n'
    || E'  manager_mapping_version := (authorization_context ->> ''managerMappingVersion'')::bigint;';
  new_text := E'  actor_user_id := (authorization_context ->> ''actorUserId'')::uuid;\n'
    || E'  authority_kind := authorization_context ->> ''authorityKind'';\n'
    || E'  authority_record_id := (authorization_context ->> ''authorityRecordId'')::uuid;\n'
    || E'  authority_version := (authorization_context ->> ''authorityVersion'')::bigint;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official case update authority assignment shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'    case\n'
    || E'      when lower(btrim(p_action)) = ''approve'' then ''Mapped Machine Manager approved the refund action.''\n'
    || E'      else ''Mapped Machine Manager declined the refund request.''\n'
    || E'    end,\n'
    || E'    jsonb_build_object(\n'
    || E'      ''action'', lower(btrim(p_action)),\n'
    || E'      ''manager_mapping_id'', manager_mapping_id,\n'
    || E'      ''manager_mapping_version'', manager_mapping_version,\n'
    || E'      ''payload_redacted'', true\n'
    || E'    )';
  new_text := E'    case\n'
    || E'      when lower(btrim(p_action)) = ''approve'' then ''Manager approved the refund action.''\n'
    || E'      else ''Manager declined the refund request.''\n'
    || E'    end,\n'
    || E'    jsonb_build_object(\n'
    || E'      ''action'', lower(btrim(p_action)),\n'
    || E'      ''authority_kind'', authority_kind,\n'
    || E'      ''authority_record_id'', authority_record_id,\n'
    || E'      ''authority_version'', authority_version,\n'
    || E'      ''payload_redacted'', true\n'
    || E'    )';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected official case update audit shape';
  end if;

  execute replace(body, old_text, new_text);
end;
$official_case_update$;

do $cash_completion$
declare
  body text;
  old_text text;
  new_text text;
begin
  body := replace(pg_get_functiondef(
    'public.service_complete_cash_refund_official(uuid,uuid,integer,text,timestamptz,text,text,text)'::regprocedure
  ), E'\r\n', E'\n');

  old_text := E'  actor_user_id uuid;\n'
    || E'  manager_mapping_id uuid;\n'
    || E'  manager_mapping_version bigint;\n'
    || E'  completion_result jsonb;';
  new_text := E'  actor_user_id uuid;\n'
    || E'  authority_kind text;\n'
    || E'  authority_record_id uuid;\n'
    || E'  authority_version bigint;\n'
    || E'  completion_result jsonb;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected cash completion declaration shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'  actor_user_id := (authorization_context ->> ''actorUserId'')::uuid;\n'
    || E'  manager_mapping_id := (authorization_context ->> ''managerMappingId'')::uuid;\n'
    || E'  manager_mapping_version := (authorization_context ->> ''managerMappingVersion'')::bigint;';
  new_text := E'  actor_user_id := (authorization_context ->> ''actorUserId'')::uuid;\n'
    || E'  authority_kind := authorization_context ->> ''authorityKind'';\n'
    || E'  authority_record_id := (authorization_context ->> ''authorityRecordId'')::uuid;\n'
    || E'  authority_version := (authorization_context ->> ''authorityVersion'')::bigint;';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected cash completion authority assignment shape';
  end if;
  body := replace(body, old_text, new_text);

  old_text := E'      ''Mapped Machine Manager confirmed an external cash refund was completed.'',\n'
    || E'      jsonb_build_object(\n'
    || E'        ''action'', ''cash_complete'',\n'
    || E'        ''completion_method'', ''manual_external'',\n'
    || E'        ''refund_amount_cents'', (completion_case ->> ''refund_amount_cents'')::integer,\n'
    || E'        ''confirmed_at'', completion_case ->> ''refund_completed_at'',\n'
    || E'        ''manager_mapping_id'', manager_mapping_id,\n'
    || E'        ''manager_mapping_version'', manager_mapping_version,\n'
    || E'        ''payload_redacted'', true\n'
    || E'      )';
  new_text := E'      ''Manager confirmed the cash refund was completed.'',\n'
    || E'      jsonb_build_object(\n'
    || E'        ''action'', ''cash_complete'',\n'
    || E'        ''completion_method'', ''manual_external'',\n'
    || E'        ''refund_amount_cents'', (completion_case ->> ''refund_amount_cents'')::integer,\n'
    || E'        ''confirmed_at'', completion_case ->> ''refund_completed_at'',\n'
    || E'        ''authority_kind'', authority_kind,\n'
    || E'        ''authority_record_id'', authority_record_id,\n'
    || E'        ''authority_version'', authority_version,\n'
    || E'        ''payload_redacted'', true\n'
    || E'      )';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected cash completion audit shape';
  end if;

  execute replace(body, old_text, new_text);
end;
$cash_completion$;

-- Older approvals that were not bound to an exact provider transaction cannot
-- be turned into a new exact authorization after the fact. Reject that retired
-- state before starting or recovering a lookup; undecided cases keep the normal
-- System lookup path.
do $retire_unbound_approval_lookup$
declare
  body text;
  old_text text;
  new_text text;
begin
  body := replace(pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)'::regprocedure
  ), E'\r\n', E'\n');

  old_text := E'  if not found then\n'
    || E'    raise exception ''Refund case not found'' using errcode = ''P4620'';\n'
    || E'  end if;\n\n'
    || E'  if case_row.nayax_lookup_status = ''checking'' then';
  new_text := E'  if not found then\n'
    || E'    raise exception ''Refund case not found'' using errcode = ''P4620'';\n'
    || E'  end if;\n\n'
    || E'  if case_row.decision = ''approved'' then\n'
    || E'    raise exception ''This older approval is not tied to an exact transaction and cannot be reused. It needs separate review.''\n'
    || E'      using errcode = ''P4622'';\n'
    || E'  end if;\n\n'
    || E'  if case_row.nayax_lookup_status = ''checking'' then';
  if cardinality(string_to_array(body, old_text)) <> 2 then
    raise exception 'Unexpected lookup start guard shape';
  end if;

  execute replace(body, old_text, new_text);
end;
$retire_unbound_approval_lookup$;

comment on function public.service_complete_cash_refund_official(
  uuid,uuid,integer,text,timestamptz,text,text,text
) is 'Service-only boundary that consumes one exact Manager or Super-admin decision and records a cash completion.';

select pg_notify('pgrst','reload schema');
