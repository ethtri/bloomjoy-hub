-- #1117: provider DTM identifies Simon South Hill as Enterprise Simon Snapcase.
-- Correct its category and withdraw the conflicting unverified public route in
-- one transaction. Provider identities, managers, cases and sales are retained.
create function public.reconcile_verified_south_hills_refund_routing()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  verified public.refund_nayax_machine_inventory%rowtype;
  unverified public.refund_nayax_machine_inventory%rowtype;
  before_rows jsonb; after_rows jsonb; source_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('verified_south_hills_refund_routing_v1'));
  select count(*) into source_count from public.refund_nayax_machine_inventory
    where account_key='TGPACI_USA_DB' and nayax_machine_id in ('545814962','40390734');
  if source_count=0 then return jsonb_build_object('skipped',true); end if;
  if source_count<>2 then raise exception 'Both reviewed provider identities are required'; end if;
  perform 1 from public.refund_nayax_machine_inventory
    where account_key='TGPACI_USA_DB' and nayax_machine_id in ('545814962','40390734') order by id for update;
  select * into verified from public.refund_nayax_machine_inventory where account_key='TGPACI_USA_DB' and nayax_machine_id='545814962';
  select * into unverified from public.refund_nayax_machine_inventory where account_key='TGPACI_USA_DB' and nayax_machine_id='40390734';
  perform 1 from public.reporting_machines where id in (verified.reporting_machine_id,unverified.reporting_machine_id) order by id for update;
  perform 1 from public.reporting_locations where id='5101aee2-69bd-474e-9f87-ad50b5072b09'::uuid for share;
  if verified.machine_name is distinct from 'Simon1302-South Hill Village'
    or verified.machine_number is distinct from '4434330125144394AutoFwp$r'
    or unverified.machine_name is distinct from 'Snapcase 03'
    or unverified.machine_number is distinct from '434333524111967Auto(8Jvj'
    or verified.reporting_machine_id is distinct from 'b9ec0e18-2b56-4c07-b47d-84e7613bc777'::uuid
    or unverified.reporting_machine_id is distinct from '1608ca48-9b3a-4dec-a228-71a9cfbecbb7'::uuid
    or not verified.provider_is_active or not unverified.provider_is_active
    or verified.missing_successful_snapshots<>0 or unverified.missing_successful_snapshots<>0
    or not exists(select 1 from public.reporting_machines a join public.reporting_machines b on b.account_id=a.account_id
      join public.reporting_locations l on l.id=a.location_id
      where a.id=verified.reporting_machine_id and b.id=unverified.reporting_machine_id
        and a.nayax_machine_id=verified.nayax_machine_id and b.nayax_machine_id=unverified.nayax_machine_id
        and a.nayax_account_key=verified.account_key and b.nayax_account_key=unverified.account_key
        and a.location_id=b.location_id and a.location_id='5101aee2-69bd-474e-9f87-ad50b5072b09'::uuid
        and l.name='South Hills Village' and l.timezone='America/New_York' and l.status='active'
        and a.status='active' and b.status='active' and b.machine_type='unknown'
        and not a.nayax_manual_portal_enabled and not b.nayax_manual_portal_enabled)
  then raise exception 'Reviewed South Hills identities or location have changed'; end if;
  if verified.refund_category='snapcase' and verified.reconciliation_state='published'
    and unverified.reconciliation_state='excluded' and unverified.setup_reason='location_verification_required'
    and exists(select 1 from public.reporting_machines where id=verified.reporting_machine_id
      and machine_type='unknown' and refund_public_display_label='South Hills Village — Phone cases (SnapCase)')
    and exists(select 1 from public.reporting_machines where id=unverified.reporting_machine_id
      and refund_intake_enabled is false and nayax_refunds_enabled is false)
    and exists(select 1 from public.public_refund_selections_v2() where machine_id=verified.reporting_machine_id)
    and not exists(select 1 from public.public_refund_selections_v2() where machine_id=unverified.reporting_machine_id)
  then return jsonb_build_object('skipped',false,'alreadyApplied',true); end if;
  if verified.refund_category is distinct from 'cotton_candy' or verified.reconciliation_state is distinct from 'published'
    or unverified.refund_category is distinct from 'snapcase' or unverified.reconciliation_state is distinct from 'published'
    or not exists(select 1 from public.reporting_machines where id=verified.reporting_machine_id
      and machine_type='commercial' and refund_public_display_label='South Hills Village — Cotton Candy')
  then raise exception 'Conflicting South Hills category or publication decision'; end if;
  select jsonb_agg(jsonb_build_object('inventory',to_jsonb(i),'machine',to_jsonb(m)) order by i.id)
    into before_rows from public.refund_nayax_machine_inventory i join public.reporting_machines m on m.id=i.reporting_machine_id
    where i.id in (verified.id,unverified.id);
  update public.refund_nayax_machine_inventory set refund_category='snapcase',
    decision_reason='Provider DTM group Enterprise Simon Snapcase verifies the South Hills phone-case machine (#1117).',
    decided_by=null,decided_at=statement_timestamp(),updated_at=statement_timestamp() where id=verified.id;
  update public.refund_nayax_machine_inventory set reconciliation_state='excluded',setup_reason='location_verification_required',
    exclusion_reason='South Hills route withdrawn pending physical-location verification; immutable provider identity retained (#1117).',
    decision_reason='The verified South Hills phone-case purchase belongs to the separate Simon provider identity (#1117).',
    decided_by=null,decided_at=statement_timestamp(),updated_at=statement_timestamp() where id=unverified.id;
  update public.reporting_machines set machine_type='unknown',refund_public_display_label='South Hills Village — Phone cases (SnapCase)',
    updated_at=statement_timestamp() where id=verified.reporting_machine_id;
  update public.reporting_machines set refund_intake_enabled=false,nayax_refunds_enabled=false,
    nayax_refunds_disabled_reason='owner_pause',updated_at=statement_timestamp()
    where id=unverified.reporting_machine_id;
  if (select count(*) from public.public_refund_machine_options() where location_id='5101aee2-69bd-474e-9f87-ad50b5072b09'::uuid)<>1
    or not exists(select 1 from public.public_refund_machine_options() where machine_id=verified.reporting_machine_id)
    or not exists(select 1 from public.public_refund_selections_v2() where machine_id=verified.reporting_machine_id)
  then raise exception 'The corrected public route must expose exactly one verified machine'; end if;
  select jsonb_agg(jsonb_build_object('inventory',to_jsonb(i),'machine',to_jsonb(m)) order by i.id)
    into after_rows from public.refund_nayax_machine_inventory i join public.reporting_machines m on m.id=i.reporting_machine_id
    where i.id in (verified.id,unverified.id);
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
  values(null,'refund_nayax_inventory.verified_south_hills_routing','reporting_machine_portfolio','south-hills-routing-1117',
    before_rows,after_rows,jsonb_build_object('issue',1117,'providerEvidence','DTM machine group: Enterprise Simon Snapcase',
    'caseRebinding',false,'managerAssignmentsChanged',false,'providerActionTaken',false,'customerContact',false));
  return jsonb_build_object('skipped',false,'alreadyApplied',false);
end;
$$;
revoke all on function public.reconcile_verified_south_hills_refund_routing() from public,anon,authenticated,service_role;
select public.reconcile_verified_south_hills_refund_routing();
