begin;

-- Absence of a policy retains the existing dated authority behavior. This
-- migration does not opt in any existing machine or change historical facts.
create table private.machine_card_financial_policies (
  reporting_machine_id uuid primary key references public.reporting_machines(id),
  mode text not null check (mode='nayax_card_app_cash'),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  reason text not null check (nullif(btrim(reason),'') is not null)
);
create table private.machine_preserved_source_card_facts (
  fact_id uuid primary key references public.machine_sales_facts(id),
  reporting_machine_id uuid not null references private.machine_card_financial_policies(reporting_machine_id),
  created_at timestamptz not null default now(),
  -- Actual server observation, not transaction-start time or source clock.
  observed_at timestamptz not null default clock_timestamp()
);
create index machine_preserved_source_card_facts_machine_idx
  on private.machine_preserved_source_card_facts(reporting_machine_id);
-- Hold obsolete management-only writers while validating the rollout state.
lock table private.machine_source_management_associations in share mode;
do $completed_association_rollout$
begin
  if exists(select 1 from private.machine_source_management_associations association
    join public.reporting_machines machine on machine.id=association.reporting_machine_id
    where not exists(select 1 from private.machine_card_financial_policies policy where policy.reporting_machine_id=machine.id)
      or not(case when association.platform='Sunze' then machine.sunze_machine_id is not distinct from association.source_id
        else exists(select 1 from private.snapcase_machine_mappings mapping
          where mapping.reporting_machine_id=machine.id and mapping.provider_account_id=association.provider_account_id
            and mapping.source_machine_id=association.source_id) end)) then
    raise exception 'A source has an incomplete management-only association. Review and complete it before this release.' using errcode='22023';
  end if;
end; $completed_association_rollout$;
create function private.require_completed_source_management_association()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if not exists(select 1 from public.reporting_machines machine
    join private.machine_card_financial_policies policy on policy.reporting_machine_id=machine.id
    where machine.id=new.reporting_machine_id and
      (case when new.platform='Sunze' then machine.sunze_machine_id is not distinct from new.source_id
        else exists(select 1 from private.snapcase_machine_mappings mapping
          where mapping.reporting_machine_id=machine.id and mapping.provider_account_id=new.provider_account_id
            and mapping.source_machine_id=new.source_id) end)) then
    raise exception 'Source mapping must complete in the same reviewed save; reload this machine.' using errcode='22023';
  end if;
  return new;
end; $fn$;
revoke all on function private.require_completed_source_management_association() from public,anon,authenticated;
create constraint trigger source_management_association_completed
  after insert on private.machine_source_management_associations
  deferrable initially deferred for each row execute function private.require_completed_source_management_association();

-- Reader ownership provenance only: no amounts, refund actions or sale ledger.
create table private.machine_nayax_reader_associations (
  id uuid primary key default gen_random_uuid(),
  account_key text not null check(account_key=upper(btrim(account_key)) and account_key<>''),
  nayax_machine_id text not null check(nullif(btrim(nayax_machine_id),'') is not null),
  reporting_machine_id uuid not null references public.reporting_machines(id),
  effective_from timestamptz,
  effective_until timestamptz,
  closed_on date,
  closed_timezone text,
  effective_from_date date,
  effective_timezone text,
  ownership_basis text not null check(ownership_basis in ('same_physical_machine_all_history','reviewed_physical_reader_change','reviewed_calendar_reader_change','original_transactions_only')),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  reason text not null check(nullif(btrim(reason),'') is not null),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  close_reason text,
  check((effective_until is null and closed_on is null and closed_timezone is null and closed_at is null and closed_by is null and close_reason is null)
    or ((effective_until is not null or closed_on is not null) and closed_at is not null and closed_by is not null and nullif(btrim(close_reason),'') is not null)),
  check(effective_until is null or effective_from is null or effective_until>effective_from),
  check((ownership_basis='same_physical_machine_all_history' and effective_from is null and effective_from_date is null and effective_timezone is null)
    or (ownership_basis='reviewed_physical_reader_change' and effective_from is not null and effective_from_date is not null and effective_timezone is not null)
    or (ownership_basis='reviewed_calendar_reader_change' and effective_from is null and effective_from_date is not null and effective_timezone is not null)
    or (ownership_basis='original_transactions_only' and effective_from is null and effective_from_date is null and effective_timezone is null and closed_at is not null))
);
create unique index machine_nayax_reader_open_owner_idx on private.machine_nayax_reader_associations(account_key,nayax_machine_id)
  where closed_at is null;
create index machine_nayax_reader_ownership_lookup_idx on private.machine_nayax_reader_associations(account_key,nayax_machine_id,effective_from,effective_until);
alter table private.machine_nayax_reader_associations enable row level security;
revoke all on private.machine_nayax_reader_associations from public,anon,authenticated;
grant select on private.machine_nayax_reader_associations to service_role;

create function private.record_same_machine_reader_association(p_machine_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; existing private.machine_nayax_reader_associations; account text;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  perform public.reporting_admin_assert_reason(p_reason);
  select * into machine from public.reporting_machines where id=p_machine_id for update nowait;
  if machine.id is null or machine.management_archived_at is not null then raise exception 'Active machine required' using errcode='22023'; end if;
  if nullif(btrim(machine.nayax_machine_id),'') is null then return; end if;
  account:=upper(coalesce(nullif(btrim(machine.nayax_account_key),''),'TGPACI_USA_DB'));
  select * into existing from private.machine_nayax_reader_associations
    where account_key=account and nayax_machine_id=machine.nayax_machine_id and closed_at is null for update nowait;
  if existing.reporting_machine_id=machine.id then return; end if;
  if existing.id is not null then raise exception 'Reader ownership changed. Review its existing machine before reassignment.' using errcode='40001'; end if;
  if account='TGPACI_USA_DB' and exists(select 1 from public.machine_sales_facts original
    where original.source='nayax_scheduled_report' and original.raw_payload->>'providerMachineId'=machine.nayax_machine_id
      and original.reporting_machine_id<>machine.id) then
    raise exception 'This reader has another machine in its financial history. Review the ownership change before saving.' using errcode='22023';
  end if;
  insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,ownership_basis,created_by,reason)
    values(account,machine.nayax_machine_id,machine.id,'same_physical_machine_all_history',auth.uid(),btrim(p_reason));
end; $fn$;
revoke all on function private.record_same_machine_reader_association(uuid,text) from public,anon,authenticated;

create function private.guard_reader_ownership_history()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_op='DELETE' then raise exception 'Reader ownership history cannot be deleted' using errcode='22023'; end if;
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false)
    or old.closed_at is not null or new.closed_at is null
    or new.closed_by is distinct from auth.uid()
    or (to_jsonb(new)-array['effective_until','closed_on','closed_timezone','closed_at','closed_by','close_reason'])
      is distinct from (to_jsonb(old)-array['effective_until','closed_on','closed_timezone','closed_at','closed_by','close_reason']) then
    raise exception 'Reader ownership history requires an explicit reviewed change' using errcode='22023';
  end if;
  return new;
end; $fn$;
revoke all on function private.guard_reader_ownership_history() from public,anon,authenticated;
create trigger guard_reader_ownership_history before update or delete on private.machine_nayax_reader_associations
  for each row execute function private.guard_reader_ownership_history();

-- Current pointers may be cleared by a real replacement. Exact retained
-- transaction owners still prevent a formerly used reader being called free.
create function private.original_reader_machine_owners(p_account_key text,p_reader_id text)
returns uuid[] language sql stable security definer set search_path='' as $$
  select coalesce(array_agg(distinct fact.reporting_machine_id),'{}'::uuid[])
  from public.machine_sales_facts fact
  where upper(btrim(p_account_key))='TGPACI_USA_DB'
    and fact.source='nayax_scheduled_report'
    and fact.raw_payload->>'providerMachineId'=btrim(p_reader_id);
$$;
revoke all on function private.original_reader_machine_owners(text,text) from public,anon,authenticated;

create function public.admin_preview_machine_reader_change(p_machine_id uuid,p_inventory_id uuid,p_changed_at_local timestamp)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare machine public.reporting_machines; reader public.refund_nayax_machine_inventory;
  owner public.reporting_machines; zone text; chosen timestamptz; times jsonb; original_owners uuid[];
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  select * into machine from public.reporting_machines where id=p_machine_id;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id;
  if machine.id is null or reader.id is null or machine.management_archived_at is not null then raise exception 'Active machine and imported reader required' using errcode='22023'; end if;
  select timezone into zone from public.reporting_locations where id=machine.location_id;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Review the saved machine time zone first' using errcode='22023'; end if;
  select * into owner from public.reporting_machines where id=coalesce(reader.reporting_machine_id,
    (select history.reporting_machine_id from private.machine_nayax_reader_associations history
      where history.account_key=reader.account_key and history.nayax_machine_id=reader.nayax_machine_id and history.closed_at is null));
  if owner.id is null then
    original_owners:=private.original_reader_machine_owners(reader.account_key,reader.nayax_machine_id);
    if cardinality(original_owners)=1 then
      select * into owner from public.reporting_machines where id=original_owners[1];
    end if;
  end if;
  if p_changed_at_local is not null then
    chosen:=p_changed_at_local at time zone zone;
    -- Round-trip every nearby offset. A missing or repeated DST wall-clock
    -- time is never silently converted into one arbitrary physical instant.
    select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate),'[]'::jsonb) into times
      from pg_catalog.generate_series(chosen-interval '2 hours',chosen+interval '2 hours',interval '1 minute') candidate
      where candidate at time zone zone=p_changed_at_local;
  end if;
  return jsonb_build_object('machineId',machine.id,'machineName',private.reporting_machine_display_name(machine),
    'expectedMachineUpdatedAt',machine.updated_at,'currentReaderId',machine.nayax_machine_id,'currentAccountKey',machine.nayax_account_key,
    'inventoryId',reader.id,'newReaderId',reader.nayax_machine_id,'newAccountKey',reader.account_key,
    'ownerMachineId',owner.id,'ownerMachineName',private.reporting_machine_display_name(owner),'expectedOwnerUpdatedAt',owner.updated_at,
    'historicalOwnerConflict',coalesce(cardinality(original_owners)>1,false),
    'ownerArchived',owner.management_archived_at is not null,'timezone',zone,'effectiveInstants',coalesce(times,'[]'::jsonb),
    'providerActive',reader.provider_is_active,'originalTransactionsRemainWithTheirMachine',true);
end; $fn$;
revoke all on function public.admin_preview_machine_reader_change(uuid,uuid,timestamp) from public,anon;
grant execute on function public.admin_preview_machine_reader_change(uuid,uuid,timestamp) to authenticated;

create function private.resolve_machine_reader_purchase_owner(p_account_key text,p_reader_id text,p_authorized_at timestamptz)
returns uuid language sql stable security definer set search_path='' as $$
  select case when count(distinct ownership.reporting_machine_id)=1
    then (array_agg(distinct ownership.reporting_machine_id))[1] end
  from private.machine_nayax_reader_associations ownership
  where ownership.account_key=upper(btrim(p_account_key)) and ownership.nayax_machine_id=btrim(p_reader_id)
    and (
      (ownership.ownership_basis='same_physical_machine_all_history'
        and (ownership.effective_until is null or p_authorized_at<ownership.effective_until))
      or (ownership.ownership_basis='reviewed_physical_reader_change'
        and p_authorized_at>=ownership.effective_from
        and (ownership.effective_until is null or p_authorized_at<ownership.effective_until))
      or (ownership.ownership_basis='reviewed_calendar_reader_change'
        and (p_authorized_at at time zone ownership.effective_timezone)::date>ownership.effective_from_date
        and (ownership.effective_until is null or p_authorized_at<ownership.effective_until))
    )
    and (ownership.closed_on is null or (p_authorized_at at time zone ownership.closed_timezone)::date<ownership.closed_on)
    -- Missing purchase evidence cannot distinguish two different physical owners.
    and (p_authorized_at is not null or not exists(
      select 1 from private.machine_nayax_reader_associations other
      where other.account_key=ownership.account_key and other.nayax_machine_id=ownership.nayax_machine_id
        and other.reporting_machine_id<>ownership.reporting_machine_id));
$$;
revoke all on function private.resolve_machine_reader_purchase_owner(text,text,timestamptz) from public,anon,authenticated;
alter table private.machine_card_financial_policies enable row level security;
alter table private.machine_preserved_source_card_facts enable row level security;
revoke all on private.machine_card_financial_policies from public,anon,authenticated;
revoke all on private.machine_preserved_source_card_facts from public,anon,authenticated;
grant select on private.machine_card_financial_policies,private.machine_preserved_source_card_facts to service_role;

create function private.guard_machine_card_policy_immutable()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  raise exception 'Financial source policy history requires reviewed reconciliation' using errcode='22023';
end; $fn$;
revoke all on function private.guard_machine_card_policy_immutable() from public,anon,authenticated;
create trigger guard_machine_card_policy_immutable before update or delete
  on private.machine_card_financial_policies for each row execute function private.guard_machine_card_policy_immutable();
create trigger guard_machine_preserved_source_card_fact_immutable before update or delete
  on private.machine_preserved_source_card_facts for each row execute function private.guard_machine_card_policy_immutable();

-- Eligibility changes only for explicitly reviewed machines. Existing eligible
-- app-card facts remain eligible by exact identity, never by amount/date guesses.
create or replace view private.financial_machine_sales_facts with (security_invoker=true) as
select fact.* from public.machine_sales_facts fact
join public.reporting_machines machine on machine.id=fact.reporting_machine_id
where (fact.payment_method <> 'cash' or not machine.exclude_cash_from_financial_reporting)
  and (fact.source <> 'sunze_browser' or fact.payment_method = 'cash'
    or not exists(select 1 from private.machine_card_financial_policies policy
      where policy.reporting_machine_id=machine.id)
    or exists(select 1 from private.machine_preserved_source_card_facts preserved
      where preserved.fact_id=fact.id and preserved.reporting_machine_id=machine.id));
revoke all on private.financial_machine_sales_facts from public,anon,authenticated;
grant select on private.financial_machine_sales_facts to service_role;

create function private.establish_machine_card_financial_policy(p_machine_id uuid,p_reason text,p_record_reader boolean default true)
returns void language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Super admin access required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  -- Mapping callers may already hold the Hub row. Never wait for the authority
  -- advisory lock while holding that row; retry the complete reviewed action.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('machine-card-authority:'||p_machine_id::text,0)) then
    raise exception 'Financial imports are updating this machine. Reload and retry.' using errcode='40001';
  end if;
  select * into machine from public.reporting_machines where id=p_machine_id for update nowait;
  if machine.id is null or machine.management_archived_at is not null then
    raise exception 'Active machine required' using errcode='22023';
  end if;
  -- Existing real dated authority is deliberately inherited unchanged.
  if machine.nayax_card_sales_started_on is not null then return; end if;
  if exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=machine.id) then return; end if;
  insert into private.machine_card_financial_policies(reporting_machine_id,mode,created_by,reason)
    values(machine.id,'nayax_card_app_cash',auth.uid(),btrim(p_reason));
  if p_record_reader then perform private.record_same_machine_reader_association(machine.id,p_reason); end if;
  -- This branch is only for previously unconverted source-only history. It
  -- preserves exact prior inputs; it does not assert any cross-provider match.
  insert into private.machine_preserved_source_card_facts(fact_id,reporting_machine_id)
    select fact.id,machine.id from public.machine_sales_facts fact
    where fact.reporting_machine_id=machine.id and fact.source='sunze_browser'
      and fact.payment_method<>'cash';
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),'reporting_machine.card_financial_policy_established','reporting_machine',machine.id::text,
      jsonb_build_object('policy','legacy'),jsonb_build_object('policy','nayax_card_app_cash'),
      jsonb_build_object('reason',btrim(p_reason),'historicalFactsUnchanged',true,
        'preservedSourceCardFactCount',(select count(*) from private.machine_preserved_source_card_facts where reporting_machine_id=machine.id)));
exception when lock_not_available then
  raise exception 'Machine is being updated. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function private.establish_machine_card_financial_policy(uuid,text,boolean) from public,anon,authenticated;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.reconcile_machine_card_sales_authority(uuid,date)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  if p_reporting_machine_id is null or p_sale_date is null then';
  if strpos(definition,anchor)=0 then raise exception 'Card authority function changed'; end if;
  definition:=overlay(definition placing $new$begin
  if exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=p_reporting_machine_id) then return; end if;
  if p_reporting_machine_id is null or p_sale_date is null then$new$
    from strpos(definition,anchor) for length(anchor));
  anchor:=$old$'machine-card-authority:' || p_reporting_machine_id::text,
      0
    )
  );$old$;
  if strpos(definition,anchor)=0 then raise exception 'Card authority serialization anchor changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  if exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=p_reporting_machine_id) then return; end if;');
  anchor:=$old$nullif(btrim(machine.nayax_machine_id), '') is not null
  into authority_start, has_sunze, has_nayax$old$;
  if strpos(definition,anchor)=0 then raise exception 'Historical reader authority anchor changed'; end if;
  definition:=replace(definition,anchor,$new$(nullif(btrim(machine.nayax_machine_id), '') is not null
      or (machine.nayax_card_sales_started_on is not null and exists(
        select 1 from private.machine_nayax_reader_associations reviewed
        where reviewed.reporting_machine_id=machine.id and reviewed.closed_at is not null)))
  into authority_start, has_sunze, has_nayax$new$);
  execute definition;
  definition:=replace(pg_get_functiondef('private.reporting_machine_card_authority_reconcile_trigger()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  if current_setting(''app.nayax_reader_replacement'', true) = ''1'' then';
  if strpos(definition,anchor)=0 then raise exception 'Card authority trigger changed'; end if;
  definition:=overlay(definition placing $new$begin
  if exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=new.id) then return new; end if;
  if current_setting('app.nayax_reader_replacement', true) = '1' then$new$
    from strpos(definition,anchor) for length(anchor));
  execute definition;
end; $patch$;

create function public.admin_change_machine_reader(
  p_machine_id uuid,p_inventory_id uuid,p_expected_machine_updated_at timestamptz,
  p_expected_owner_updated_at timestamptz,p_expected_timezone text,
  p_changed_on date,p_changed_at timestamptz,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare machine public.reporting_machines; owner public.reporting_machines;
  reader public.refund_nayax_machine_inventory; history private.machine_nayax_reader_associations;
  zone text; old_account text; prior_guard text; prior_change_guard text; ownership_basis text; original_owners uuid[];
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  perform public.reporting_admin_assert_reason(p_reason);
  select * into machine from public.reporting_machines where id=p_machine_id for update nowait;
  if machine.id is null or machine.management_archived_at is not null then raise exception 'Active machine required' using errcode='22023'; end if;
  if p_expected_machine_updated_at is null or machine.updated_at is distinct from p_expected_machine_updated_at then raise exception 'Machine changed. Reload and review.' using errcode='40001'; end if;
  select timezone into zone from public.reporting_locations where id=machine.location_id for share nowait;
  if p_expected_timezone is null or zone is distinct from p_expected_timezone then raise exception 'Saved timezone changed. Reload and review.' using errcode='40001'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=zone) then raise exception 'Review the saved machine timezone first' using errcode='22023'; end if;
  if p_changed_on is null or p_changed_on>(statement_timestamp() at time zone zone)::date then raise exception 'Enter the actual reader change date' using errcode='22023'; end if;
  if p_changed_at is not null and ((p_changed_at at time zone zone)::date<>p_changed_on or p_changed_at>statement_timestamp()) then raise exception 'Review the actual change instant and local date' using errcode='22023'; end if;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id for update nowait;
  if reader.id is null then raise exception 'Imported reader required' using errcode='22023'; end if;
  if reader.nayax_machine_id=machine.nayax_machine_id and reader.account_key=upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')) then raise exception 'This is already the current reader' using errcode='22023'; end if;
  select * into history from private.machine_nayax_reader_associations
    where account_key=reader.account_key and nayax_machine_id=reader.nayax_machine_id and closed_at is null for update nowait;
  select * into owner from public.reporting_machines where id=coalesce(reader.reporting_machine_id,history.reporting_machine_id) for update nowait;
  if owner.id is null then
    original_owners:=private.original_reader_machine_owners(reader.account_key,reader.nayax_machine_id);
    if cardinality(original_owners)>1 then
      raise exception 'This reader has multiple historical machine owners. Reconcile its exact history before moving.' using errcode='22023';
    elsif cardinality(original_owners)=1 then
      select * into owner from public.reporting_machines where id=original_owners[1] for update nowait;
    end if;
  end if;
  if owner.id is not null and owner.id<>machine.id then
    if owner.management_archived_at is not null then raise exception 'Review the archived owner before moving its reader' using errcode='22023'; end if;
    if p_expected_owner_updated_at is null or owner.updated_at is distinct from p_expected_owner_updated_at then raise exception 'Reader owner changed. Reload and review both machines.' using errcode='40001'; end if;
    if p_changed_at is null then raise exception 'A move between different machines requires the actual change time' using errcode='22023'; end if;
    if history.id is not null and history.reporting_machine_id<>owner.id then raise exception 'Reader history and current owner conflict. Reconcile before moving.' using errcode='40001'; end if;
  elsif owner.id is null and p_expected_owner_updated_at is not null then raise exception 'Reader ownership changed. Reload and review.' using errcode='40001'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('machine-card-authority:'||machine.id::text,0))
    or (owner.id is not null and owner.id<>machine.id and not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('machine-card-authority:'||owner.id::text,0))) then
    raise exception 'Financial imports are updating these machines. Reload and retry.' using errcode='40001';
  end if;
  perform private.establish_machine_card_financial_policy(machine.id,p_reason,false);
  -- A routine change attests only the current configuration and exact original
  -- transactions, never an unproved all-history installation interval.
  if nullif(btrim(machine.nayax_machine_id),'') is not null and not exists(
    select 1 from private.machine_nayax_reader_associations previous
    where previous.reporting_machine_id=machine.id
      and previous.account_key=upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB'))
      and previous.nayax_machine_id=machine.nayax_machine_id) then
    insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,
      closed_on,ownership_basis,created_by,reason,closed_at,closed_by,close_reason)
      values(upper(coalesce(machine.nayax_account_key,'TGPACI_USA_DB')),machine.nayax_machine_id,machine.id,
        p_changed_on,'original_transactions_only',auth.uid(),btrim(p_reason),statement_timestamp(),auth.uid(),btrim(p_reason));
  end if;
  old_account:=upper(coalesce(nullif(btrim(machine.nayax_account_key),''),'TGPACI_USA_DB'));
  prior_change_guard:=current_setting('app.machine_reader_change',true);
  perform set_config('app.machine_reader_change','1',true);
  prior_guard:=current_setting('app.nayax_reader_replacement',true);
  perform set_config('app.nayax_reader_replacement','1',true);
  if owner.id is not null and owner.id<>machine.id then
    if history.id is not null then
      if history.effective_from is not null and p_changed_at<=history.effective_from then raise exception 'Change time precedes reviewed ownership' using errcode='22023'; end if;
      update private.machine_nayax_reader_associations set effective_until=p_changed_at,
        closed_at=statement_timestamp(),closed_by=auth.uid(),close_reason=btrim(p_reason) where id=history.id;
    else
      insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,
        effective_until,ownership_basis,created_by,reason,closed_at,closed_by,close_reason)
        values(reader.account_key,reader.nayax_machine_id,owner.id,p_changed_at,'original_transactions_only',
          auth.uid(),btrim(p_reason),statement_timestamp(),auth.uid(),btrim(p_reason));
    end if;
    if owner.nayax_machine_id=reader.nayax_machine_id and upper(coalesce(owner.nayax_account_key,'TGPACI_USA_DB'))=reader.account_key then
      perform public.admin_set_reporting_machine_nayax_config(owner.id,null,null,p_reason);
    end if;
  end if;
  -- Retire a proved old interval at the reviewed instant or calendar day.
  -- Exact original facts still win; an unseen switch-day purchase is unknown.
  update private.machine_nayax_reader_associations set effective_until=p_changed_at,
    closed_on=case when p_changed_at is null then p_changed_on end,
    closed_timezone=case when p_changed_at is null then zone end,
    closed_at=statement_timestamp(),closed_by=auth.uid(),close_reason=btrim(p_reason)
    where reporting_machine_id=machine.id and account_key=old_account
      and nayax_machine_id=machine.nayax_machine_id and closed_at is null;
  update public.refund_nayax_machine_inventory set reporting_machine_id=null,reconciliation_state='excluded',
    exclusion_reason='Retired reader after reviewed replacement',setup_reason='explicitly_excluded',
    decision_reason=btrim(p_reason),decided_by=auth.uid(),decided_at=statement_timestamp(),updated_at=statement_timestamp()
    where reporting_machine_id=machine.id and nayax_machine_id=machine.nayax_machine_id and account_key=old_account;
  perform public.admin_set_reporting_machine_nayax_config(machine.id,reader.nayax_machine_id,reader.account_key,p_reason);
  update public.refund_nayax_machine_inventory set reporting_machine_id=machine.id,reconciliation_state='needs_setup',
    exclusion_reason=null,setup_reason='machine_setup_incomplete',decision_reason=btrim(p_reason),
    decided_by=auth.uid(),decided_at=statement_timestamp(),updated_at=statement_timestamp() where id=reader.id;
  if history.id is null or history.reporting_machine_id<>machine.id then
    ownership_basis:=case when p_changed_at is null then 'reviewed_calendar_reader_change' else 'reviewed_physical_reader_change' end;
    insert into private.machine_nayax_reader_associations(account_key,nayax_machine_id,reporting_machine_id,
      effective_from,effective_from_date,effective_timezone,ownership_basis,created_by,reason)
      values(reader.account_key,reader.nayax_machine_id,machine.id,p_changed_at,p_changed_on,zone,ownership_basis,auth.uid(),btrim(p_reason));
  else ownership_basis:=history.ownership_basis; end if;
  perform set_config('app.nayax_reader_replacement',coalesce(prior_guard,''),true);
  perform set_config('app.machine_reader_change',coalesce(prior_change_guard,''),true);
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
    values(auth.uid(),'reporting_machine.reader_changed','reporting_machine',machine.id::text,
      jsonb_build_object('readerId',machine.nayax_machine_id,'accountKey',machine.nayax_account_key,'previousOwnerMachineId',owner.id),
      jsonb_build_object('readerId',reader.nayax_machine_id,'accountKey',reader.account_key),
      jsonb_build_object('reason',btrim(p_reason),'changedOn',p_changed_on,'changedAt',p_changed_at,'timezone',zone,
        'ownershipBasis',ownership_basis,'historicalTransactionsUnchanged',true,'refundCapabilitiesUnchanged',true));
  return jsonb_build_object('machineId',machine.id,'currentReaderId',reader.nayax_machine_id,'currentAccountKey',reader.account_key,
    'changedOn',p_changed_on,'changedAt',p_changed_at,'ownershipBasis',ownership_basis,'historicalTransactionsUnchanged',true);
exception when lock_not_available then raise exception 'Machine or reader changed. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_change_machine_reader(uuid,uuid,timestamptz,timestamptz,text,date,timestamptz,text) from public,anon;
grant execute on function public.admin_change_machine_reader(uuid,uuid,timestamptz,timestamptz,text,date,timestamptz,text) to authenticated;

-- A retained native purchase keeps its reader's tax evidence after replacement.
-- The current machine reader is configuration, not original-purchase evidence.
create or replace function private.normalize_original_reader_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean,p_source text,p_reader_id text
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language sql stable security definer set search_path='' as $$
  select legacy.* from private.normalize_reporting_treated_amount_cents(
    p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
    p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis) legacy
  where p_source not in ('nayax_scheduled_report','card_authority_daily') or not exists(
    select 1 from private.machine_nayax_reader_associations history where history.reporting_machine_id=p_machine_id)
  union all
  select normalized.* from (select 1) singleton
  left join lateral (
    select case when evidence.classification='verified_tax' then evidence.rate_percent end as rate_percent
    from private.nayax_machine_tax_observations evidence
    where evidence.account_key='TGPACI_USA_DB'
      and evidence.nayax_machine_id=nullif(btrim(p_reader_id),'')
      and evidence.effective_start_date<=p_purchase_date
      and coalesce(evidence.effective_end_date,'infinity'::date)>=p_purchase_date
    order by (evidence.classification<>'unavailable') desc,
      evidence.effective_start_date desc,evidence.observed_at desc,evidence.id limit 1
  ) original_tax on true
  cross join lateral private.normalize_financial_amount_cents(p_amount_cents,
    case when p_tender='cash' or p_amount_cents=0 then 'tax_exclusive'
      when p_separate_tax_cents is not null then 'separate_tax'
      when p_amount_basis in ('tax_inclusive','legacy_percentage_of_gross_estimate')
        and original_tax.rate_percent is null then 'unknown' else p_amount_basis end,
    case when p_tender='cash' then 0 else original_tax.rate_percent end,
    case when p_tender='cash' then null else p_separate_tax_cents end) normalized
  where p_source in ('nayax_scheduled_report','card_authority_daily') and exists(
    select 1 from private.machine_nayax_reader_associations history where history.reporting_machine_id=p_machine_id);
$$;
revoke all on function private.normalize_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean,text,text) from public,anon,authenticated;

do $original_reader_sales$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'private.machine_sales_daily_components(uuid,date,date)',
    'private.machine_sales_daily_waterfall_components(uuid,date,date)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    anchor:='fact.source,';
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original reader sales source anchor changed: %',signature; end if;
    definition:=replace(definition,anchor,anchor||$reader$
      case when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then nullif(btrim(fact.raw_payload->>'providerMachineId'),'')
        when fact.source='card_authority_daily' and exists(select 1 from private.machine_nayax_reader_associations history
          where history.reporting_machine_id=fact.reporting_machine_id) then (
          select case when count(distinct nullif(btrim(original.raw_payload->>'providerMachineId'),''))=1
            and count(*)=count(nullif(btrim(original.raw_payload->>'providerMachineId'),''))
            then min(original.raw_payload->>'providerMachineId') end
          from public.machine_sales_facts original
          cross join lateral private.reporting_retained_original_money(original) retained
          where original.reporting_machine_id=fact.reporting_machine_id and original.sale_date=fact.sale_date
            and original.source='nayax_scheduled_report' and original.payment_method='credit'
            and retained.original_amount_cents>0
        ) end as original_reader_id,$reader$);
    anchor:='scoped.source,';
    if cardinality(string_to_array(definition,anchor))<>3 then raise exception 'Original reader grouped source anchors changed: %',signature; end if;
    definition:=replace(definition,anchor,anchor||E'\n      scoped.original_reader_id,');
    anchor:=$old$private.normalize_reporting_treated_amount_cents(
      grouped.reporting_machine_id$old$;
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original reader normalization anchor changed: %',signature; end if;
    definition:=replace(definition,anchor,$new$private.normalize_original_reader_amount_cents(
      grouped.reporting_machine_id$new$);
    anchor:=$old$      true
    ) normalized
  ), active_recognition$old$;
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original reader normalization tail changed: %',signature; end if;
    definition:=replace(definition,anchor,$new$      true,grouped.source,grouped.original_reader_id
    ) normalized
  ), active_recognition$new$);
    execute definition;
  end loop;
end; $original_reader_sales$;

do $original_reader_refund$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array['private.refund_original_source_tax_cents(uuid,bigint)',
    'private.provider_refund_original_source_tax_cents(uuid,bigint)'] loop
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  anchor:='cross join lateral private.reporting_retained_original_money(fact) money';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original refund retained money anchor changed'; end if;
  definition:=replace(definition,anchor,anchor||$new$
  left join lateral private.normalize_original_reader_amount_cents(
    fact.reporting_machine_id,'card',fact.sale_date,money.original_amount_cents,
    'tax_inclusive',null,null,true,fact.source,fact.raw_payload->>'providerMachineId'
  ) original_reader on fact.source='nayax_scheduled_report'
  cross join lateral (select case
    when money.original_tax_cents>0
      or lower(coalesce(fact.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
      or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax')
      then money.original_tax_cents
    when fact.source='nayax_scheduled_report' and exists(select 1 from private.machine_nayax_reader_associations history
      where history.reporting_machine_id=fact.reporting_machine_id) then original_reader.tax_cents
    else null end as original_tax_cents) resolved_tax$new$);
  anchor:='money.original_tax_cents/money.original_amount_cents';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original refund tax numerator changed'; end if;
  definition:=replace(definition,anchor,'resolved_tax.original_tax_cents/money.original_amount_cents');
  anchor:=$old$    and money.original_tax_cents between 0 and money.original_amount_cents
    and (money.original_tax_cents>0 or lower(coalesce(fact.raw_payload->>'amountBasis','')) in ('separate_tax','separately_imported_tax')
      or lower(coalesce(fact.raw_payload->>'taxBasis','')) in ('separate_tax','separately_imported_tax'))$old$;
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original refund tax eligibility changed'; end if;
  definition:=replace(definition,anchor,'    and resolved_tax.original_tax_cents between 0 and money.original_amount_cents');
  execute definition;
  end loop;
end; $original_reader_refund$;

create function private.normalize_refund_original_reader_amount_cents(
  p_machine_id uuid,p_tender text,p_purchase_date date,p_amount_cents bigint,
  p_amount_basis text,p_tax_rate_percent numeric,p_separate_tax_cents bigint,
  p_preserve_basis boolean
) returns table(recorded_amount_cents bigint,tax_exclusive_amount_cents bigint,
  tax_cents bigint,amount_basis text,normalization_status text,normalization_reason text)
language sql stable security definer set search_path='' as $$
  select legacy.* from private.normalize_reporting_treated_amount_cents(
    p_machine_id,p_tender,p_purchase_date,p_amount_cents,p_amount_basis,
    p_tax_rate_percent,p_separate_tax_cents,p_preserve_basis) legacy
  where p_tender='cash' or p_amount_basis='tax_exclusive' or p_separate_tax_cents is not null or not exists(
    select 1 from private.machine_nayax_reader_associations history where history.reporting_machine_id=p_machine_id)
  union all
  select missing.* from private.normalize_financial_amount_cents(p_amount_cents,
    case when p_amount_cents=0 then 'tax_exclusive' else 'unknown' end,null,null) missing
  where p_tender<>'cash' and p_amount_basis is distinct from 'tax_exclusive' and p_separate_tax_cents is null and exists(
    select 1 from private.machine_nayax_reader_associations history where history.reporting_machine_id=p_machine_id);
$$;
revoke all on function private.normalize_refund_original_reader_amount_cents(uuid,text,date,bigint,text,numeric,bigint,boolean) from public,anon,authenticated;

do $original_reader_refund_components$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array['private.machine_sales_daily_components(uuid,date,date)',
    'private.machine_sales_daily_waterfall_components(uuid,date,date)'] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    anchor:=$old$private.normalize_reporting_treated_amount_cents(
      event.reporting_machine_id$old$;
    if cardinality(string_to_array(definition,anchor))<>5 then raise exception 'Original refund component call anchors changed: %',signature; end if;
    definition:=replace(definition,anchor,$new$private.normalize_refund_original_reader_amount_cents(
      event.reporting_machine_id$new$);
    anchor:=$old$private.normalize_reporting_treated_amount_cents(
      adjustment.reporting_machine_id$old$;
    if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Original paid adjustment anchor changed: %',signature; end if;
    definition:=replace(definition,anchor,$new$private.normalize_refund_original_reader_amount_cents(
      adjustment.reporting_machine_id$new$);
    execute definition;
  end loop;
end; $original_reader_refund_components$;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_imported_source_reuse_options(text,uuid,text)'::regprocedure),E'\r\n',E'\n');
  anchor:='and m.nayax_machine_id=i.nayax_machine_id';
  if strpos(definition,anchor)=0 then raise exception 'Reader reuse eligibility anchor changed'; end if;
  definition:=replace(definition,anchor,$new$and (p_platform<>'Kexiaozhan' or private.snapcase_mapping_target_eligible(m))
      and m.nayax_card_sales_started_on is null
      and m.nayax_machine_id=i.nayax_machine_id$new$);
  anchor:='when m.nayax_machine_id is distinct from i.nayax_machine_id';
  if strpos(definition,anchor)=0 then raise exception 'Reader reuse eligibility reason changed'; end if;
  definition:=replace(definition,anchor,$new$when p_platform='Kexiaozhan' and not private.snapcase_mapping_target_eligible(m) then 'This machine configuration is not eligible for this Kex source. Review the existing machine.'
      when m.nayax_card_sales_started_on is not null then 'This machine has existing dated financial authority. Review its current source connection.'
      when m.nayax_machine_id is distinct from i.nayax_machine_id$new$);
  anchor:='join public.reporting_machines m on m.id=i.reporting_machine_id';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Reader reuse owner projection changed'; end if;
  definition:=replace(definition,anchor,$new$join public.reporting_machines m on m.id=coalesce(i.reporting_machine_id,
      (select history.reporting_machine_id from private.machine_nayax_reader_associations history
        where history.account_key=i.account_key and history.nayax_machine_id=i.nayax_machine_id and history.closed_at is null),
      case when cardinality(private.original_reader_machine_owners(i.account_key,i.nayax_machine_id))=1
        then (private.original_reader_machine_owners(i.account_key,i.nayax_machine_id))[1] end)$new$);
  execute definition;
end; $patch$;

-- The native feed carries settlement timestamps, not proved purchase-time
-- ownership. Preserve exact original transactions before current-reader lookup.
do $pending_authorization_allowlist$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_catalog.pg_constraint
    where conrelid='public.nayax_pending_sales'::regclass and conname='nayax_pending_sales_normalized_allowlist';
  if definition is null or cardinality(string_to_array(definition,'''sourceRowHash''::text'))<>2 then
    raise exception 'Native pending strict allowlist changed';
  end if;
  definition:=replace(definition,'''sourceRowHash''::text','''sourceRowHash''::text, ''machineAuthorizedAt''::text, ''authorizedAt''::text');
  alter table public.nayax_pending_sales drop constraint nayax_pending_sales_normalized_allowlist;
  execute 'alter table public.nayax_pending_sales add constraint nayax_pending_sales_normalized_allowlist '||definition;
end; $pending_authorization_allowlist$;
alter table public.nayax_pending_sales add constraint nayax_pending_sales_authorization_shape check (
  (not(normalized_sale?'authorizedAt') or normalized_sale->'authorizedAt'='null'::jsonb
    or (jsonb_typeof(normalized_sale->'authorizedAt')='string'
      and normalized_sale->>'authorizedAt'~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'))
  and (not(normalized_sale?'machineAuthorizedAt') or normalized_sale->'machineAuthorizedAt'='null'::jsonb
    or (jsonb_typeof(normalized_sale->'machineAuthorizedAt')='string'
      and normalized_sale->>'machineAuthorizedAt'~'^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$'))
);
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.service_ingest_nayax_scheduled_sales(text,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:='  pending_disposition text;';
  if strpos(definition,anchor)=0 then raise exception 'Native pending declaration changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  inherited_history_ambiguous boolean:=false;');
  anchor:=$old$          'sourceRowHash'
        )$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native optional authorization allowlist changed'; end if;
  definition:=replace(definition,anchor,$new$          'sourceRowHash', 'machineAuthorizedAt', 'authorizedAt'
        )$new$);
  anchor:=$old$    machine_settled_at := (sale ->> 'machineSettledAt')::timestamp;$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native time validation changed'; end if;
  definition:=replace(definition,anchor,$new$    if (sale->>'authorizedAt' is not null and sale->>'authorizedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$')
      or (sale->>'machineAuthorizedAt' is not null and sale->>'machineAuthorizedAt' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$') then
      raise exception 'Invalid native report authorization time' using errcode='22023';
    end if;
    if sale->>'authorizedAt' is not null and ((sale->>'authorizedAt')::timestamptz<timestamptz '2025-01-01 00:00:00+00'
      or (sale->>'authorizedAt')::timestamptz>(sale->>'providerSettledAt')::timestamptz) then
      raise exception 'Invalid native report authorization interval' using errcode='22023';
    end if;
    machine_settled_at := (sale ->> 'machineSettledAt')::timestamp;$new$);
  anchor:='    mapped_machine_id := null;';
  if strpos(definition,anchor)=0 then raise exception 'Native per-row mapping reset changed'; end if;
  definition:=replace(definition,anchor,E'    inherited_history_ambiguous:=false;\n'||anchor);
  anchor:=$old$and inventory.reconciliation_state = 'published'
      and machine.nayax_machine_id = inventory.nayax_machine_id$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native financial eligibility anchor changed'; end if;
  definition:=replace(definition,anchor,$new$and (inventory.reconciliation_state = 'published'
        or (inventory.provider_is_active and exists(select 1 from private.machine_card_financial_policies policy where policy.reporting_machine_id=machine.id)))
      and machine.nayax_machine_id = inventory.nayax_machine_id$new$);
  anchor:=$old$    if mapped_machine_id is null then$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native pending mapping anchor changed'; end if;
  definition:=replace(definition,anchor,$new$    -- A reviewed historical reader cannot silently use today's owner.
    if exists(select 1 from private.machine_nayax_reader_associations history
      where history.account_key='TGPACI_USA_DB' and history.nayax_machine_id=sale->>'providerMachineId') then
      select machine.id,machine.location_id,machine.sunze_machine_id
        into mapped_machine_id,mapped_location_id,mapped_sunze_machine_id
      from public.reporting_machines machine where machine.id=private.resolve_machine_reader_purchase_owner(
        'TGPACI_USA_DB',sale->>'providerMachineId',(sale->>'authorizedAt')::timestamptz);
    end if;
    -- Exact immutable transaction identity outranks a reader's current owner.
    if exists(select 1 from public.machine_sales_facts original where original.source='nayax_scheduled_report'
      and original.source_order_hash=sale->>'sourceOrderHash') then
      select original.reporting_machine_id,original.reporting_location_id,m.sunze_machine_id
        into mapped_machine_id,mapped_location_id,mapped_sunze_machine_id
      from public.machine_sales_facts original join public.reporting_machines m on m.id=original.reporting_machine_id
      where original.source='nayax_scheduled_report' and original.source_order_hash=sale->>'sourceOrderHash';
    elsif exists(select 1 from private.machine_preserved_source_card_facts preserved where preserved.reporting_machine_id=mapped_machine_id)
      and not coalesce((sale->>'authorizedAt')::timestamptz>(
        select max(preserved.observed_at) from private.machine_preserved_source_card_facts preserved
        where preserved.reporting_machine_id=mapped_machine_id),false) then
      -- Only the validated provider UTC purchase authorization can prove it
      -- occurred after every already-observed immutable inherited input.
      -- Missing/older/equal clocks cannot prove non-overlap; keep evidence.
      inherited_history_ambiguous:=true;
      mapped_machine_id:=null; mapped_location_id:=null; mapped_sunze_machine_id:=null;
    end if;
    if mapped_machine_id is null then$new$);
  anchor:=$old$      reporting_machine_id = excluded.reporting_machine_id,
      reporting_location_id = excluded.reporting_location_id,
      sale_date = excluded.sale_date,$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native original ownership anchor changed'; end if;
  definition:=replace(definition,anchor,$new$      reporting_machine_id = target.reporting_machine_id,
      reporting_location_id = target.reporting_location_id,
      sale_date = target.sale_date,$new$);
  anchor:=$old$          else 'exact_mapping_required'$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native pending reason changed'; end if;
  definition:=replace(definition,anchor,$new$          when inherited_history_ambiguous then 'inherited_source_card_purchase_ownership_unverified'
          else 'exact_mapping_required'$new$);
  anchor:=$old$        'transactionId', sale ->> 'transactionId',$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native retained authorization evidence changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n        ''authorizedAt'',sale->''authorizedAt'',\n        ''machineAuthorizedAt'',sale->''machineAuthorizedAt'',');
  anchor:=$old$      raw_payload = excluded.raw_payload,
      updated_at = statement_timestamp()$old$;
  if strpos(definition,anchor)=0 then raise exception 'Native original reader provenance changed'; end if;
  definition:=replace(definition,anchor,$new$      raw_payload = excluded.raw_payload || jsonb_build_object(
        'providerMachineId',coalesce(target.raw_payload->'providerMachineId',excluded.raw_payload->'providerMachineId'),
        'actorId',coalesce(target.raw_payload->'actorId',excluded.raw_payload->'actorId'),
        'siteId',coalesce(target.raw_payload->'siteId',excluded.raw_payload->'siteId'),
        'transactionId',coalesce(target.raw_payload->'transactionId',excluded.raw_payload->'transactionId'),
        'authorizedAt',coalesce(nullif(excluded.raw_payload->'authorizedAt','null'::jsonb),target.raw_payload->'authorizedAt'),
        'machineAuthorizedAt',coalesce(nullif(excluded.raw_payload->'machineAuthorizedAt','null'::jsonb),target.raw_payload->'machineAuthorizedAt')),
      updated_at = statement_timestamp()$new$);
  execute definition;
end; $patch$;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_get_machine_source_inventory()'::regprocedure),E'\r\n',E'\n');
  anchor:='and association.source_id=src.source_id and association.reporting_machine_id=current_machine.id)';
  if strpos(definition,anchor)=0 then raise exception 'Source catalogue completion anchor changed'; end if;
  execute replace(definition,anchor,$new$and association.source_id=src.source_id and association.reporting_machine_id=current_machine.id
          and not exists(select 1 from private.machine_card_financial_policies policy where policy.reporting_machine_id=current_machine.id))$new$);
  definition:=replace(pg_get_functiondef('public.admin_get_machine_workspace_metadata()'::regprocedure),E'\r\n',E'\n');
  anchor:='where association.reporting_machine_id=machine.id';
  if strpos(definition,anchor)=0 then raise exception 'Source metadata completion anchor changed'; end if;
  execute replace(definition,anchor,$new$where association.reporting_machine_id=machine.id
      and not exists(select 1 from private.machine_card_financial_policies policy where policy.reporting_machine_id=machine.id)$new$);
end; $patch$;

-- A completed exact association may be written only to its reviewed Hub. The
-- policy is established first, so ordinary authority triggers cannot rewrite
-- existing Nayax history while the source identity is being attached.
create or replace function private.guard_source_management_financial_activation()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if tg_table_name='reporting_machines' then
    if nullif(btrim(new.sunze_machine_id),'') is not null
      and (tg_op='INSERT' or new.sunze_machine_id is distinct from old.sunze_machine_id)
      and exists(select 1 from private.machine_source_management_associations a
        where a.reporting_machine_id=new.id or (a.platform='Sunze' and a.source_id=new.sunze_machine_id))
      and not exists(select 1 from private.machine_source_management_associations a
        join private.machine_card_financial_policies policy on policy.reporting_machine_id=a.reporting_machine_id
        where a.reporting_machine_id=new.id and a.platform='Sunze' and a.source_id=new.sunze_machine_id) then
      raise exception 'Source identity conflicts with its reviewed machine' using errcode='22023';
    end if;
  elsif exists(select 1 from private.machine_source_management_associations a
    where a.reporting_machine_id=new.reporting_machine_id
      or (a.platform='Kexiaozhan' and a.provider_account_id=new.provider_account_id and a.source_id=new.source_machine_id))
    and not exists(select 1 from private.machine_source_management_associations a
      join private.machine_card_financial_policies policy on policy.reporting_machine_id=a.reporting_machine_id
      where a.reporting_machine_id=new.reporting_machine_id and a.platform='Kexiaozhan'
        and a.provider_account_id=new.provider_account_id and a.source_id=new.source_machine_id) then
    raise exception 'Source identity conflicts with its reviewed machine' using errcode='22023';
  end if;
  return new;
end; $fn$;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_reuse_imported_source_machine(text,uuid,text,uuid,uuid,timestamptz,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:='insert into private.machine_source_management_associations(platform,provider_account_id,source_id,reporting_machine_id,created_by,reason)';
  if strpos(definition,anchor)=0 then raise exception 'Existing machine reuse association anchor changed'; end if;
  definition:=replace(definition,anchor,$new$if p_platform='Kexiaozhan' and not private.snapcase_mapping_target_eligible(machine) then
    raise exception 'Kexiaozhan requires an existing SnapCase machine' using errcode='22023';
  end if;
  perform private.establish_machine_card_financial_policy(machine.id,p_reason);
  insert into private.machine_source_management_associations(platform,provider_account_id,source_id,reporting_machine_id,created_by,reason)$new$);
  anchor:='insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)';
  if strpos(definition,anchor)=0 then raise exception 'Existing machine reuse audit anchor changed'; end if;
  definition:=replace(definition,anchor,$new$if p_platform='Sunze' then
    perform private.upsert_reporting_machine_identity(machine.id,machine.account_id,machine.location_id,
      machine.machine_label,machine.machine_type,p_source_id,p_reason,true);
  else
    perform public.admin_map_snapcase_machine(p_provider_account_id,p_source_id,machine.id,
      machine.account_id,machine.location_id,null,machine.machine_label,null,'-infinity'::date,null,p_reason,site_zone);
  end if;
  insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)$new$);
  definition:=replace(definition,'''salesActivationPending'',true','''salesActivationPending'',false');
  definition:=replace(definition,'''financialMappingUnchanged'',true','''historicalFinancialFactsUnchanged'',true');
  definition:=replace(definition,'''promotedPendingCount'',0','''sourceAssociationCompleted'',true');
  execute definition;
end; $patch$;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_setup_imported_machine(text,uuid,text,uuid,text,text,text,text,uuid,text[],text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$'Unmapped Hub Source Sunze '||p_source_id,p_timezone,true)$old$;
  if strpos(definition,anchor)=0 then raise exception 'Initial source promotion anchor changed'; end if;
  definition:=replace(definition,anchor,$new$'Unmapped Hub Source Sunze '||p_source_id,p_timezone,false)$new$);
  anchor:='perform public.admin_set_machine_display_name(machine.id,btrim(p_machine_name),private.reporting_machine_display_name(machine));';
  if strpos(definition,anchor)=0 then raise exception 'Initial source name anchor changed'; end if;
  definition:=replace(definition,anchor,$new$perform private.establish_machine_card_financial_policy(machine.id,p_reason);
  if p_platform='Sunze' then
    machine:=private.upsert_reporting_machine_identity(machine.id,machine.account_id,machine.location_id,
      machine.machine_label,machine.machine_type,p_source_id,p_reason,true);
  end if;
  perform public.admin_set_machine_display_name(machine.id,btrim(p_machine_name),private.reporting_machine_display_name(machine));$new$);
  execute definition;
end; $patch$;

do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_save_machine_workspace_mapping(uuid,text,uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$select * into current_inventory from public.refund_nayax_machine_inventory$old$;
  if strpos(definition,anchor)=0 then raise exception 'Workspace mapping reader anchor changed'; end if;
  definition:=replace(definition,anchor,$new$if nullif(btrim(m.nayax_machine_id),'') is not null
      and (m.nayax_machine_id is distinct from i.nayax_machine_id
        or upper(coalesce(m.nayax_account_key,'TGPACI_USA_DB')) is distinct from i.account_key) then
      raise exception 'Use the reviewed reader change action with its actual change date' using errcode='22023';
    end if;
    if exists(select 1 from unnest(private.original_reader_machine_owners(i.account_key,i.nayax_machine_id)) historical_owner
      where historical_owner<>m.id) then
      raise exception 'This reader has prior machine ownership. Review the reader change instead.' using errcode='22023';
    end if;
    if nullif(btrim(m.nayax_machine_id),'') is null then
      perform private.establish_machine_card_financial_policy(m.id,'Explicit first imported reader selection; preserve existing source-card history');
    end if;
    select * into current_inventory from public.refund_nayax_machine_inventory$new$);
  anchor:='where id=m.id returning * into updated;';
  if strpos(definition,anchor)=0 then raise exception 'Workspace mapping ownership audit anchor changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  perform private.record_same_machine_reader_association(m.id,''Explicit reviewed machine workspace reader selection'');');
  execute definition;
end; $patch$;

-- A case resolves its original reader inside its retained machine/location scope.
-- Current configuration is used only when no reviewed ownership history exists.
create function public.service_refund_case_reader_identity(p_case_id uuid,p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare refund_case public.refund_cases; machine public.reporting_machines;
  original public.machine_sales_facts; receipt public.refund_authoritative_receipts; tuples jsonb; tuple_count integer;
begin
  select * into refund_case from public.refund_cases where id=p_case_id;
  select * into machine from public.reporting_machines where id=p_machine_id;
  if refund_case.id is null or machine.id is null
    or (refund_case.reporting_machine_id is distinct from machine.id
      and not(machine.id=any(coalesce(refund_case.intake_selection_machine_ids,'{}'::uuid[]))))
    or refund_case.reporting_location_id is distinct from machine.location_id then
    raise exception 'Refund machine/location scope changed' using errcode='22023';
  end if;
  select * into original from public.machine_sales_facts where id=refund_case.matched_sales_fact_id
    and reporting_machine_id=machine.id and source='nayax_scheduled_report';
  if original.id is not null and nullif(original.raw_payload->>'providerMachineId','') is not null then
    if refund_case.matched_nayax_transaction_id is not null and
      (original.raw_payload->>'transactionId' is distinct from refund_case.matched_nayax_transaction_id
        or (refund_case.matched_nayax_site_id is not null and original.raw_payload->>'siteId' is distinct from refund_case.matched_nayax_site_id::text)) then
      return jsonb_build_object('readerId',null,'accountKey',null,'basis','original_transaction_conflict');
    end if;
    return jsonb_build_object('readerId',original.raw_payload->>'providerMachineId','accountKey','TGPACI_USA_DB','basis','matched_original_transaction');
  end if;
  select * into receipt from public.refund_authoritative_receipts
    where refund_case_id=refund_case.id and reporting_machine_id=machine.id
      and original_transaction_id=refund_case.matched_nayax_transaction_id;
  if receipt.id is not null then
    return jsonb_build_object('readerId',receipt.provider_machine_id,'accountKey',receipt.account_scope,'basis','authoritative_original_receipt');
  end if;
  if not exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id=machine.id) then
    return jsonb_build_object('readerId',machine.nayax_machine_id,'accountKey',machine.nayax_account_key,'basis','legacy_current_configuration');
  end if;
  select count(*),jsonb_agg(jsonb_build_object('readerId',nayax_machine_id,'accountKey',account_key)) into tuple_count,tuples
    from private.machine_nayax_reader_associations where reporting_machine_id=machine.id;
  if tuple_count=1 and exists(select 1 from private.machine_nayax_reader_associations
    where reporting_machine_id=machine.id and ownership_basis='same_physical_machine_all_history' and closed_at is null) then
    return tuples->0||jsonb_build_object('basis','single_attested_all_history_reader');
  end if;
  if refund_case.incident_time_resolution not in ('exact','legacy_absolute')
    or refund_case.incident_time_resolution is null
    or refund_case.incident_time_confidence is distinct from 'exact' then
    return jsonb_build_object('readerId',null,'accountKey',null,'basis','purchase_ownership_unverified');
  end if;
  select count(*),jsonb_agg(candidate) into tuple_count,tuples from (
    select distinct history.account_key,history.nayax_machine_id from private.machine_nayax_reader_associations history
    where history.reporting_machine_id=machine.id
      and private.resolve_machine_reader_purchase_owner(history.account_key,history.nayax_machine_id,refund_case.incident_at)=machine.id
  ) candidate;
  if tuple_count=1 then
    return jsonb_build_object('readerId',tuples->0->>'nayax_machine_id','accountKey',tuples->0->>'account_key','basis','reviewed_purchase_ownership');
  end if;
  return jsonb_build_object('readerId',null,'accountKey',null,'basis','purchase_ownership_unverified');
end; $fn$;
revoke all on function public.service_refund_case_reader_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_refund_case_reader_identity(uuid,uuid) to service_role;

create function public.service_refund_case_reader_clock(p_case_id uuid,p_machine_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare identity jsonb; clock_row public.refund_nayax_machine_inventory;
begin
  identity:=public.service_refund_case_reader_identity(p_case_id,p_machine_id);
  if identity->>'readerId' is null or identity->>'accountKey' is null then
    raise exception 'Original reader clock identity unavailable' using errcode='22023';
  end if;
  select * into clock_row from public.refund_nayax_machine_inventory
    where account_key=identity->>'accountKey' and nayax_machine_id=identity->>'readerId';
  return jsonb_build_object('provider_clock_timezone',clock_row.provider_clock_timezone,
    'provider_clock_source',clock_row.provider_clock_source,
    'provider_clock_observed_at',clock_row.provider_clock_observed_at,
    'provider_clock_daylight_saving',clock_row.provider_clock_daylight_saving);
end; $fn$;
revoke all on function public.service_refund_case_reader_clock(uuid,uuid) from public,anon,authenticated;
grant execute on function public.service_refund_case_reader_clock(uuid,uuid) to service_role;

-- Candidate identity and its signed execution context follow the proved original
-- reader. The retained Hub row still supplies status, caps and authorization.
do $patch$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.refund_nayax_selected_execution_context(uuid)'::regprocedure);
  anchor:='select * into m from public.reporting_machines where id=c.reporting_machine_id;';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Selected execution context reader anchor changed';
  end if;
  definition:=replace(definition,anchor,anchor||E'\n  if c.id is null or m.id is null then return null; end if;\n  m.nayax_account_key:=public.service_refund_case_reader_identity(c.id,m.id)->>''accountKey'';\n  m.nayax_machine_id:=public.service_refund_case_reader_identity(c.id,m.id)->>''readerId'';\n  if m.nayax_account_key is null or m.nayax_machine_id is null then return null; end if;');
  execute definition;
end; $patch$;

create function private.refund_case_reader_clock_context_matches(p_case_id uuid,p_machine_id uuid,p_context jsonb)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare clock_row public.refund_nayax_machine_inventory; identity jsonb;
begin
  if jsonb_typeof(p_context) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_context))<>4
    or not p_context ?& array['reportingMachineId','timezone','source','observedAt']
    or p_context->>'reportingMachineId' is distinct from p_machine_id::text then return false; end if;
  identity:=public.service_refund_case_reader_identity(p_case_id,p_machine_id);
  if identity->>'readerId' is null or identity->>'accountKey' is null then return false; end if;
  select * into clock_row from public.refund_nayax_machine_inventory
    where account_key=identity->>'accountKey' and nayax_machine_id=identity->>'readerId' for share;
  if clock_row.id is null then return false; end if;
  if clock_row.provider_clock_timezone is null then
    return p_context->'timezone'='null'::jsonb and p_context->>'source'='unknown'
      and p_context->'observedAt'='null'::jsonb;
  end if;
  return jsonb_typeof(p_context->'timezone')='string' and jsonb_typeof(p_context->'observedAt')='string'
    and p_context->>'timezone'=clock_row.provider_clock_timezone
    and p_context->>'source'=clock_row.provider_clock_source
    and (p_context->>'observedAt')::timestamptz=clock_row.provider_clock_observed_at;
exception when invalid_datetime_format or datetime_field_overflow or sqlstate '22023' then return false;
end; $fn$;
revoke all on function private.refund_case_reader_clock_context_matches(uuid,uuid,jsonb) from public,anon,authenticated,service_role;

do $patch$
declare signature text; definition text; anchor text;
begin
  foreach signature in array array[
    'public.refund_nayax_candidate_id_state_pre_time_v1(uuid,uuid,integer,timestamptz,integer,text,text,jsonb)',
    'public.refund_nayax_candidate_id_state_time_v1(uuid,uuid,integer,timestamptz,integer,text,text,jsonb)'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    anchor:=E'select m.* into machine_row from public.reporting_machines m where m.id = p_reporting_machine_id;\n  if not found then return ''invalid''; end if;';
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'Candidate original reader anchor changed: %',signature;
    end if;
    definition:=replace(definition,anchor,anchor||E'\n  if exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id=machine_row.id) then\n    begin\n      machine_row.nayax_account_key:=public.service_refund_case_reader_identity(case_row.id,machine_row.id)->>''accountKey'';\n      machine_row.nayax_machine_id:=public.service_refund_case_reader_identity(case_row.id,machine_row.id)->>''readerId'';\n    exception when sqlstate ''22023'' then return ''invalid''; end;\n    if machine_row.nayax_account_key is null or machine_row.nayax_machine_id is null then return ''refresh''; end if;\n    if p_evidence->''machine_clock_context'' is not null and p_evidence->''machine_clock_context''<>''null''::jsonb and private.refund_case_reader_clock_context_matches(case_row.id,machine_row.id,p_evidence->''machine_clock_context'') is not true then return ''refresh''; end if;\n  end if;');
    anchor:=E'on inventory.reporting_machine_id = machine_row.id\n    and inventory.account_key = machine_row.nayax_account_key';
    if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
      raise exception 'Candidate retained inventory anchor changed: %',signature;
    end if;
    definition:=replace(definition,anchor,'on inventory.account_key = machine_row.nayax_account_key');
    execute definition;
  end loop;
end; $patch$;

-- Keep each authorization/case/money guard, replacing only the reader identity
-- comparisons in the installed ordinary manager execution paths. Pilot hashes
-- and authorizations are deliberately not migrated to a different configuration.
do $patch$
declare item record; definition text; account_anchor text; reader_anchor text; identity text;
begin
  for item in select * from (values
    ('public.admin_approve_selected_nayax_refund_for_system_v1(uuid,bigint)','c.id','machine',1,1,false),
    ('public.admin_approve_selected_nayax_refund_for_system_v2(uuid,bigint,integer)','c.id','machine',1,1,false),
    ('public.can_prepare_nayax_refund_execution(uuid,uuid)','refund_case.id','machine',0,2,false),
    ('public.refund_nayax_retry_safe_case_is_current(public.refund_cases)','p_case.id','machine',0,2,false),
    ('public.service_claim_due_nayax_refund_attempts_v1(text,text,text,text,integer)','refund_case.id','machine',3,2,false),
    ('public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)','refund_case.id','machine',3,2,false),
    ('public.service_reserve_nayax_refund_approval_continuation_v1(text,uuid,uuid,bigint,text,integer,text,text,text)','case_row.id','machine_row',1,1,false),
    ('public.guard_refund_nayax_execution_context_stage()','c.id','machine',1,1,true),
    ('public.refund_receipt_verified_api_attempt(uuid,uuid)','c.id','m',1,1,false)
    ,('public.refund_case_nayax_manager_readiness(uuid,uuid)','c.id','machine',1,1,false)
    ,('public.refund_nayax_api_terminal_evidence_proved(uuid,uuid)','c.id','machine',1,1,false)
  ) patches(signature,case_expression,machine_alias,account_count,reader_count,nonnull_comparison) loop
    definition:=replace(pg_get_functiondef(item.signature::regprocedure),E'\r\n',E'\n');
    account_anchor:=item.machine_alias||'.nayax_account_key';
    reader_anchor:=item.machine_alias||'.nayax_machine_id';
    if (length(definition)-length(replace(definition,account_anchor,'')))/length(account_anchor)<>item.account_count
      or (length(definition)-length(replace(definition,reader_anchor,'')))/length(reader_anchor)<>item.reader_count then
      raise exception 'Original execution reader anchors changed: %',item.signature;
    end if;
    identity:='public.service_refund_case_reader_identity('||item.case_expression||','||item.machine_alias||'.id)';
    if item.signature='public.service_claim_due_nayax_approval_continuations_v1(text,text,integer)' then
      account_anchor:=E'machine.nayax_account_key,\n      machine.nayax_machine_id,';
      if length(definition)-length(replace(definition,account_anchor,''))<>length(account_anchor) then
        raise exception 'Continuation reader output aliases changed';
      end if;
      definition:=replace(definition,account_anchor,E'machine.nayax_account_key as nayax_account_key,\n      machine.nayax_machine_id as nayax_machine_id,');
      account_anchor:=item.machine_alias||'.nayax_account_key';
    end if;
    definition:=replace(definition,account_anchor,case when item.nonnull_comparison then 'coalesce('||identity||'->>''accountKey'','''')' else '('||identity||'->>''accountKey'')' end);
    definition:=replace(definition,reader_anchor,case when item.nonnull_comparison then 'coalesce('||identity||'->>''readerId'','''')' else '('||identity||'->>''readerId'')' end);
    execute definition;
  end loop;
end; $patch$;

do $patch$
declare definition text; anchor text;
begin
  definition:=pg_get_functiondef('public.guard_refund_receipt_exact_original()'::regprocedure);
  anchor:='else m.nayax_account_key end';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Receipt original-account lock anchor changed';
  end if;
  execute replace(definition,anchor,'else public.service_refund_case_reader_identity(c.id,m.id)->>''accountKey'' end');

  definition:=pg_get_functiondef('public.refund_ensure_proved_nayax_api_terminal_receipt(uuid,uuid)'::regprocedure);
  anchor:='c.id,attempt.id,machine.id,machine.nayax_account_key,machine.nayax_machine_id,';
  if length(definition)-length(replace(definition,anchor,''))<>length(anchor) then
    raise exception 'Terminal original receipt tuple anchor changed';
  end if;
  execute replace(definition,anchor,'c.id,attempt.id,machine.id,(select context->>''accountScope'' from public.refund_nayax_execution_contexts where attempt_id=attempt.id),(select context->>''providerMachineId'' from public.refund_nayax_execution_contexts where attempt_id=attempt.id),');
end; $patch$;

do $patch$
declare item record; definition text;
begin
  for item in select * from (values
    ('public.guard_refund_nayax_candidate_provider_clock()',
      'public.refund_nayax_provider_clock_context_matches(new.reporting_machine_id,new.evidence_summary->''machine_clock_context'')',
      'private.refund_case_reader_clock_context_matches(new.refund_case_id,new.reporting_machine_id,new.evidence_summary->''machine_clock_context'')'),
    ('public.guard_refund_nayax_selected_provider_clock()',
      'public.refund_nayax_provider_clock_context_matches(new.reporting_machine_id,clock_context)',
      'private.refund_case_reader_clock_context_matches(new.id,new.reporting_machine_id,clock_context)'),
    ('public.service_commit_refund_nayax_lookup_with_diagnostics(uuid,bigint,bigint,text,text,text,timestamptz,text,uuid,integer,text,uuid,jsonb)',
      'public.refund_nayax_provider_clock_context_matches((clock_context ->> ''reportingMachineId'')::uuid, clock_context)',
      'private.refund_case_reader_clock_context_matches(p_refund_case_id,(clock_context ->> ''reportingMachineId'')::uuid, clock_context)')
  ) patches(signature,old_text,new_text) loop
    definition:=pg_get_functiondef(item.signature::regprocedure);
    if length(definition)-length(replace(definition,item.old_text,''))<>length(item.old_text) then
      raise exception 'Case reader clock anchor changed: %',item.signature;
    end if;
    execute replace(definition,item.old_text,item.new_text);
  end loop;
end; $patch$;

do $scheduled_refund_original_reader$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.service_record_nayax_scheduled_report_pre_provider_refund_v1(text,timestamptz,text,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:='m.nayax_machine_id=receipt.provider_machine_id';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Scheduled receipt original reader anchor changed'; end if;
  definition:=replace(definition,anchor,$new$public.service_refund_case_reader_identity(c.id,m.id)->>'readerId'=receipt.provider_machine_id$new$);
  anchor:='m.nayax_account_key=receipt.account_scope';
  if cardinality(string_to_array(definition,anchor))<>2 then raise exception 'Scheduled receipt original account anchor changed'; end if;
  definition:=replace(definition,anchor,$new$public.service_refund_case_reader_identity(c.id,m.id)->>'accountKey'=receipt.account_scope$new$);
  anchor:='m.nayax_machine_id=row_data->>''providerMachineId''';
  if cardinality(string_to_array(definition,anchor))<>3 then raise exception 'Scheduled original reader branch anchors changed'; end if;
  definition:=replace(definition,anchor,$new$public.service_refund_case_reader_identity(c.id,m.id)->>'readerId'=row_data->>'providerMachineId'$new$);
  anchor:='m.nayax_account_key=''TGPACI_USA_DB''';
  if cardinality(string_to_array(definition,anchor))<>3 then raise exception 'Scheduled original account branch anchors changed'; end if;
  definition:=replace(definition,anchor,$new$public.service_refund_case_reader_identity(c.id,m.id)->>'accountKey'='TGPACI_USA_DB'$new$);
  execute definition;
end; $scheduled_refund_original_reader$;

-- First setup plus a genuinely occupied-reader move commits as one reviewed
-- action. A failure creates neither a partial Hub nor a partial ownership move.
create function public.admin_setup_imported_machine_with_reader_change(
  p_platform text,p_provider_account_id uuid,p_source_id text,p_account_id uuid,
  p_machine_name text,p_machine_type text,p_operational_phase text,p_timezone text,
  p_inventory_id uuid,p_manager_emails text[],p_reason text,
  p_expected_owner_updated_at timestamptz,p_changed_on date,p_changed_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare result jsonb; machine public.reporting_machines; changed jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  if p_inventory_id is null or p_expected_owner_updated_at is null or p_changed_at is null then
    raise exception 'Review the occupied reader owner and actual change instant' using errcode='22023';
  end if;
  result:=public.admin_setup_imported_machine(p_platform,p_provider_account_id,p_source_id,p_account_id,
    p_machine_name,p_machine_type,p_operational_phase,p_timezone,null,p_manager_emails,p_reason);
  select * into machine from public.reporting_machines where id=(result->>'machineId')::uuid for update nowait;
  if machine.id is null then raise exception 'Source setup returned no exact machine' using errcode='22023'; end if;
  changed:=public.admin_change_machine_reader(machine.id,p_inventory_id,machine.updated_at,
    p_expected_owner_updated_at,p_timezone,p_changed_on,p_changed_at,p_reason);
  return result||jsonb_build_object('readerChange',changed);
exception when lock_not_available then raise exception 'Source or reader is being updated. Reload and retry.' using errcode='40001';
end; $fn$;
revoke all on function public.admin_setup_imported_machine_with_reader_change(text,uuid,text,uuid,text,text,text,text,uuid,text[],text,timestamptz,date,timestamptz) from public,anon;
grant execute on function public.admin_setup_imported_machine_with_reader_change(text,uuid,text,uuid,text,text,text,text,uuid,text[],text,timestamptz,date,timestamptz) to authenticated;

create function public.admin_preview_imported_machine_reader_change(p_inventory_id uuid,p_timezone text,p_changed_at_local timestamp)
returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare reader public.refund_nayax_machine_inventory; owner public.reporting_machines;
  original_owners uuid[]; times jsonb; chosen timestamptz;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then raise exception 'Super admin access required' using errcode='42501'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'Choose the actual machine timezone' using errcode='22023'; end if;
  select * into reader from public.refund_nayax_machine_inventory where id=p_inventory_id;
  if reader.id is null then raise exception 'Imported reader required' using errcode='22023'; end if;
  select * into owner from public.reporting_machines where id=coalesce(reader.reporting_machine_id,
    (select reporting_machine_id from private.machine_nayax_reader_associations
      where account_key=reader.account_key and nayax_machine_id=reader.nayax_machine_id and closed_at is null));
  if owner.id is null then
    original_owners:=private.original_reader_machine_owners(reader.account_key,reader.nayax_machine_id);
    if cardinality(original_owners)=1 then select * into owner from public.reporting_machines where id=original_owners[1]; end if;
  end if;
  if p_changed_at_local is not null then
    chosen:=p_changed_at_local at time zone p_timezone;
    select coalesce(jsonb_agg(to_jsonb(candidate) order by candidate),'[]'::jsonb) into times
      from pg_catalog.generate_series(chosen-interval '2 hours',chosen+interval '2 hours',interval '1 minute') candidate
      where candidate at time zone p_timezone=p_changed_at_local;
  end if;
  return jsonb_build_object('inventoryId',reader.id,'newReaderId',reader.nayax_machine_id,'newAccountKey',reader.account_key,
    'ownerMachineId',owner.id,'ownerMachineName',private.reporting_machine_display_name(owner),
    'expectedOwnerUpdatedAt',owner.updated_at,'ownerArchived',owner.management_archived_at is not null,
    'historicalOwnerConflict',coalesce(cardinality(original_owners)>1,false),'timezone',p_timezone,
    'effectiveInstants',coalesce(times,'[]'::jsonb));
end; $fn$;
revoke all on function public.admin_preview_imported_machine_reader_change(uuid,text,timestamp) from public,anon;
grant execute on function public.admin_preview_imported_machine_reader_change(uuid,text,timestamp) to authenticated;

-- Retired entry points cannot bypass the reviewed date/ownership writer.
do $patch$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('public.admin_set_reporting_machine_nayax_config(uuid,text,text,text)'::regprocedure),E'\r\n',E'\n');
  anchor:=E'  update public.reporting_machines\n  set';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Canonical reader setter anchor changed'; end if;
  definition:=replace(definition,anchor,$guard$  if normalized_machine_id is not null and before_row.nayax_machine_id is not null
    and (normalized_machine_id is distinct from before_row.nayax_machine_id
      or normalized_account_key is distinct from before_row.nayax_account_key)
    and (exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=p_machine_id)
      or exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id=p_machine_id))
    and coalesce(current_setting('app.machine_reader_change',true),'')<>'1' then
    raise exception 'Open Manage and review the reader change date and ownership' using errcode='22023';
  end if;
$guard$||anchor);
  execute definition;
  definition:=replace(pg_get_functiondef('public.admin_replace_refund_nayax_machine(uuid,uuid,text)'::regprocedure),E'\r\n',E'\n');
  anchor:='  if machine.status <> ''active'' then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Legacy replacement guard anchor changed'; end if;
  definition:=replace(definition,anchor,$guard$  if exists(select 1 from private.machine_card_financial_policies where reporting_machine_id=p_reporting_machine_id)
    or exists(select 1 from private.machine_nayax_reader_associations where reporting_machine_id=p_reporting_machine_id) then
    raise exception 'Open Manage and review the reader change date and ownership' using errcode='22023';
  end if;
$guard$||anchor);
  execute definition;
end; $patch$;
commit;
