-- #1730 owner instruction: Merlin is venue/partner context; the reviewed six
-- machines belong to existing Bloomjoy Enterprises. Preserve every venue ID,
-- provider binding, explicit permission and historical financial/payroll row.
-- The exact production IDs below are correction scope, not user-facing labels.
do $correction$
declare
  correction_source_account_id constant uuid:='e7205cab-38a4-41c2-b93f-b2b9d0e74754';
  correction_target_account_id constant uuid:='893c32d0-d81e-482d-b139-2f25ed2668fb';
  machine_ids uuid[]:=array[
    '32acf22f-0238-465a-a23f-9b43c06e0055','ae3e581a-beec-496d-a7dc-b9b1030a15d0',
    'bda16d19-e27e-4028-9374-300984ce83b7','c7236c42-2812-44f2-8f44-0135104a7b4f',
    '3a9f6131-e420-41e4-a92f-47cd8ad636bc','8fa9b522-b5c6-4880-96a2-55fa1036e6f2']::uuid[];
  grant_ids uuid[]:=array['efaa745f-07b5-4440-a846-4b2efd2cb3db','f563dc9e-2add-482f-b007-aa7bd81ecdc9',
    '92dd8ef3-669f-494e-8499-3fb61f9ad3c5','5a8dcc8f-cae4-460a-9026-0319359ff83b']::uuid[];
  scope record; inserted_count integer; source_before public.customer_accounts;
  meta jsonb:=jsonb_build_object('issue',1730,'source','owner_instruction',
    'reason','Owner confirmed Merlin machines belong to Bloomjoy Enterprises; retain venue, partner, access and payroll arrangements',
    'migration','20261003222532','system_actor','reviewed_database_migration');
begin
  -- Empty-schema replay has no production identities. Partial presence is drift
  -- and must fail rather than create or select a similarly named company.
  if not exists(select 1 from public.customer_accounts where id in(correction_source_account_id,correction_target_account_id)) then return; end if;
  -- Hold the reviewed dependency sets stable while checking and correcting.
  -- Row locks alone cannot prevent a new membership/grant/assignment phantom.
  lock table public.customer_account_memberships, public.admin_scoped_access_scopes,
    public.reporting_machine_entitlements, public.technician_grants,
    public.technician_machine_assignments, public.operator_machine_assignments,
    public.reporting_machine_partnership_assignments, public.reporting_machines,
    public.reporting_locations in share row exclusive mode;
  -- Match normal assignment writers' machine-then-company lock order.
  perform id from public.reporting_machines where id=any(machine_ids) order by id for update;
  perform id from public.customer_accounts where id in(correction_source_account_id,correction_target_account_id) order by id for update;
  if not exists(select 1 from public.customer_accounts where id=correction_source_account_id and name='Merlin Entertainments')
    or not exists(select 1 from public.customer_accounts where id=correction_target_account_id and name='Bloomjoy Enterprises' and reporting_archived_at is null) then
    raise exception '#1730 reviewed source/destination company identity changed';
  end if;
  if (select count(*) from public.reporting_machines where id=any(machine_ids))<>6
    or exists(select 1 from public.reporting_machines where account_id=correction_source_account_id and not id=any(machine_ids)) then
    raise exception '#1730 reviewed six-machine scope changed';
  end if;
  if exists(select 1 from public.customer_account_memberships where account_id in(correction_source_account_id,correction_target_account_id))
    or exists(select 1 from public.admin_scoped_access_scopes where account_id in(correction_source_account_id,correction_target_account_id))
    or exists(select 1 from public.reporting_machine_entitlements where account_id in(correction_source_account_id,correction_target_account_id))
    or exists(select 1 from public.technician_grants where account_id=correction_source_account_id and status in('active','pending') and not id=any(grant_ids))
    or exists(select 1 from public.operator_machine_assignments where reporting_machine_id=any(machine_ids)
      and status='active' and revoked_at is null and id not in('c43c30f6-cc37-4dd0-b768-5549b3bab677','78666acd-ffb7-4e01-91f9-0232abc4f792')) then
    raise exception '#1730 reviewed zero account-scoped access or exact active dependency set changed';
  end if;
  if not exists(select 1 from public.reporting_partnerships where id='866e9e1d-d3f4-429c-bf4c-3ae0fe8c5499' and name='Merlin Revenue Share')
    or (select count(distinct a.machine_id) from public.reporting_machine_partnership_assignments a
    where a.partnership_id='866e9e1d-d3f4-429c-bf4c-3ae0fe8c5499')<>6
    or exists(select 1 from public.reporting_machine_partnership_assignments a
      where a.partnership_id='866e9e1d-d3f4-429c-bf4c-3ae0fe8c5499' and not a.machine_id=any(machine_ids)) then
    raise exception '#1730 reviewed Merlin partnership machine scope changed';
  end if;
  for scope in select * from (values
    ('32acf22f-0238-465a-a23f-9b43c06e0055'::uuid,'e7f0240a-57a9-40e8-a3f5-8f1cfdaae14e'::uuid),
    ('ae3e581a-beec-496d-a7dc-b9b1030a15d0','ff727f67-c1f2-47b2-9d6a-5c232d39f8ee'),
    ('bda16d19-e27e-4028-9374-300984ce83b7','e946ee16-7de1-49c0-be9a-9dd999240372'),
    ('c7236c42-2812-44f2-8f44-0135104a7b4f','cceacdcc-d358-4fe4-a0d0-617f2095e431'),
    ('3a9f6131-e420-41e4-a92f-47cd8ad636bc','f0b1e1a7-cba7-49bb-8649-2df0e234eee3'),
    ('8fa9b522-b5c6-4880-96a2-55fa1036e6f2','83f8576b-7f4e-460f-b812-41edf34e21c2')
  ) expected(machine_id,location_id) order by location_id loop
    perform id from public.reporting_locations where id=scope.location_id for update;
    if not exists(select 1 from public.reporting_machines where id=scope.machine_id and location_id=scope.location_id and account_id in(correction_source_account_id,correction_target_account_id))
      or not exists(select 1 from public.reporting_locations where id=scope.location_id and account_id in(correction_source_account_id,correction_target_account_id))
      or exists(select 1 from public.reporting_machines where location_id=scope.location_id and id<>scope.machine_id)
      or exists(select 1 from public.reporting_locations l join public.reporting_locations destination
        on destination.account_id=correction_target_account_id and lower(destination.name)=lower(l.name) and destination.id<>l.id
        where l.id=scope.location_id) then
      raise exception '#1730 reviewed exclusive venue or destination collision changed for machine %',scope.machine_id;
    end if;
  end loop;

  -- Register only the two already active payroll tuples. Profiles, assignments,
  -- policies, rates, periods and time entries stay on their original payroll
  -- account; the private predicate preserves these exact arrangements.
  perform id from public.operator_payout_profiles where id in('3b8e9f12-31e9-4ec7-a46e-7957a5b6bd1c','6f95c31a-9923-4971-a0a5-5fe615aad9fa') order by id for update;
  perform id from public.operator_machine_assignments where id in('c43c30f6-cc37-4dd0-b768-5549b3bab677','78666acd-ffb7-4e01-91f9-0232abc4f792') order by id for update;
  for scope in select * from (values
    ('c43c30f6-cc37-4dd0-b768-5549b3bab677'::uuid,'3b8e9f12-31e9-4ec7-a46e-7957a5b6bd1c'::uuid,'32acf22f-0238-465a-a23f-9b43c06e0055'::uuid),
    ('78666acd-ffb7-4e01-91f9-0232abc4f792','6f95c31a-9923-4971-a0a5-5fe615aad9fa','ae3e581a-beec-496d-a7dc-b9b1030a15d0')
  ) expected(assignment_id,profile_id,machine_id) loop
    if not exists(select 1 from public.operator_machine_assignments a
      join public.operator_payout_profiles p on p.id=a.operator_profile_id and p.account_id=correction_source_account_id and p.status='active'
      where a.id=scope.assignment_id and a.operator_profile_id=scope.profile_id and a.reporting_machine_id=scope.machine_id
        and a.account_id=correction_source_account_id and a.status='active' and a.revoked_at is null
        and a.effective_start_date='2026-09-01' and a.effective_end_date is null) then
      raise exception '#1730 reviewed payroll arrangement changed for profile %',scope.profile_id;
    end if;
    insert into private.reporting_company_payroll_compatibility(operator_assignment_id,operator_profile_id,reporting_machine_id,payroll_account_id,reporting_account_id,correction_issue)
      values(scope.assignment_id,scope.profile_id,scope.machine_id,correction_source_account_id,correction_target_account_id,1730) on conflict do nothing;
    get diagnostics inserted_count=row_count;
    if inserted_count=1 then
      insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
        values(null,'reporting_company.payroll_preserved','operator_machine_assignment',scope.assignment_id::text,'{}'::jsonb,
          jsonb_build_object('operatorProfileId',scope.profile_id,'machineId',scope.machine_id,'payrollAccountId',correction_source_account_id,'reportingAccountId',correction_target_account_id),meta);
    end if;
    if not exists(select 1 from private.reporting_company_payroll_compatibility where operator_assignment_id=scope.assignment_id
      and operator_profile_id=scope.profile_id and reporting_machine_id=scope.machine_id
      and payroll_account_id=correction_source_account_id and reporting_account_id=correction_target_account_id and correction_issue=1730) then
      raise exception '#1730 payroll preservation record conflicts';
    end if;
  end loop;

  if (select count(*) from public.technician_grants where id=any(grant_ids))<>4 then raise exception '#1730 reviewed Technician grants missing'; end if;
  perform id from public.technician_grants where id=any(grant_ids) order by id for update;
  for scope in select * from public.technician_grants where id=any(grant_ids) order by id loop
    if scope.account_id not in(correction_source_account_id,correction_target_account_id) or scope.status<>'active' or scope.revoked_at is not null
      or not coalesce(public.is_super_admin(scope.sponsor_user_id),false)
      or not exists(select 1 from public.technician_machine_assignments a where a.technician_grant_id=scope.id)
      or exists(select 1 from public.technician_machine_assignments a where a.technician_grant_id=scope.id and not a.machine_id=any(machine_ids)) then
      raise exception '#1730 reviewed Technician grant authority or exact-machine scope changed';
    end if;
    if scope.account_id=correction_source_account_id then
      update public.technician_grants set account_id=correction_target_account_id where id=scope.id;
      insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
        values(null,'technician_access.company_corrected','technician_grant',scope.id::text,
          jsonb_build_object('accountId',correction_source_account_id),jsonb_build_object('accountId',correction_target_account_id),meta);
    end if;
  end loop;

  for scope in select * from public.reporting_locations where id in(select location_id from public.reporting_machines where id=any(machine_ids)) order by id loop
    if scope.account_id=correction_source_account_id then
      update public.reporting_locations set account_id=correction_target_account_id where id=scope.id;
      insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
        values(null,'reporting_location.company_corrected','reporting_location',scope.id::text,
          jsonb_build_object('accountId',correction_source_account_id),jsonb_build_object('accountId',correction_target_account_id),meta);
    end if;
  end loop;
  for scope in select * from public.reporting_machines where id=any(machine_ids) order by id loop
    if scope.account_id=correction_source_account_id then
      update public.reporting_machines set account_id=correction_target_account_id where id=scope.id;
      insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
        values(null,'reporting_machine.company_corrected','reporting_machine',scope.id::text,
          jsonb_build_object('accountId',correction_source_account_id,'locationId',scope.location_id),
          jsonb_build_object('accountId',correction_target_account_id,'locationId',scope.location_id),meta);
    end if;
  end loop;
  select * into source_before from public.customer_accounts where id=correction_source_account_id;
  if source_before.reporting_archived_at is null then
    update public.customer_accounts set reporting_archived_at=clock_timestamp() where id=correction_source_account_id;
    insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
      values(null,'reporting_company.archived','customer_account',correction_source_account_id::text,
        jsonb_build_object('archivedAt',null),
        (select jsonb_build_object('archivedAt',reporting_archived_at) from public.customer_accounts where id=correction_source_account_id),meta);
  end if;
end;
$correction$;
