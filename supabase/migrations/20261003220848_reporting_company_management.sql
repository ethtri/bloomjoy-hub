-- #1730: archive is a reporting assignment choice, not account status/access.
alter table public.customer_accounts add column reporting_archived_at timestamptz;
comment on column public.customer_accounts.reporting_archived_at is
  'Excluded from new reporting machine assignments; current assignments, account status and access remain unchanged.';

-- Protect normalized names in every account writer, including older account
-- setup functions. Share the explicit-create name lock introduced in #1719.
create function private.reporting_company_name_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.name:=btrim(new.name);
  if coalesce(new.name,'')='' then
    raise exception 'Company name is required' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(new.name),1719));
  if exists(select 1 from public.customer_accounts a
    where lower(btrim(a.name))=lower(new.name) and a.id<>new.id
      and lower(a.name)<>lower(new.name)) then
    raise exception 'A company with this name already exists' using errcode='23505';
  end if;
  -- Ordinary duplicates are handled by the existing lower(name) unique index,
  -- preserving callers' ON CONFLICT behavior. Only historical spaced names
  -- require this additional check; existing rows are never normalized in bulk.
  return new;
end;
$$;
revoke all on function private.reporting_company_name_guard() from public,anon,authenticated,service_role;
create trigger customer_accounts_reporting_name_guard
before insert or update of name on public.customer_accounts
for each row execute function private.reporting_company_name_guard();

-- The ordinary updated_at trigger uses transaction time. Keep management
-- changes monotonic even when several actions share one transaction, including
-- other account edits that invalidate the management token; this runs
-- after customer_accounts_set_updated_at (alphabetical BEFORE trigger order).
create function private.reporting_company_management_timestamp()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
  return new;
end;
$$;
revoke all on function private.reporting_company_management_timestamp() from public,anon,authenticated,service_role;
create trigger customer_accounts_zz_reporting_management_timestamp
before update on public.customer_accounts
for each row
execute function private.reporting_company_management_timestamp();

-- A row guard closes every writer path: ID, legacy name/phase, Sunze, SnapCase,
-- and direct authorized inventory writes. A share lock serializes assignment
-- with archive on this same company row; saved same-company edits remain valid.
create function private.reporting_machine_company_archive_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare archived_at timestamptz;
begin
  if tg_op='UPDATE' and new.account_id is not distinct from old.account_id then return new; end if;
  select a.reporting_archived_at into archived_at from public.customer_accounts a
    where a.id=new.account_id for share;
  if archived_at is not null then
    raise exception 'Archived companies are unavailable for new machine assignments' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.reporting_machine_company_archive_guard() from public,anon,authenticated,service_role;
create trigger reporting_machines_company_archive_guard
before insert or update of account_id on public.reporting_machines
for each row execute function private.reporting_machine_company_archive_guard();

create or replace function public.admin_get_reporting_company_choices()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  return jsonb_build_object('canCreateCompany',true,'companies',coalesce((
    select jsonb_agg(jsonb_build_object('accountId',a.id,'accountName',a.name,'status',a.status,
      'archivedAt',a.reporting_archived_at,'updatedAt',a.updated_at,
      'machineCount',(select count(*) from public.reporting_machines m where m.account_id=a.id),
      'locations',coalesce((select jsonb_agg(jsonb_build_object('locationId',l.id,
        'locationName',l.name,'timezone',l.timezone,'status',l.status) order by l.name,l.id)
        from public.reporting_locations l where l.account_id=a.id),'[]'::jsonb)) order by a.name,a.id)
    from public.customer_accounts a),'[]'::jsonb));
end;
$$;

-- Preserve the existing explicit create/retry/audit behavior, enriching only
-- metadata. In particular, a duplicate archived name does not restore it.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.admin_create_reporting_company(text)'::regprocedure);
  if strpos(definition,'''created'',created)')=0 then raise exception 'Unexpected explicit company create contract'; end if;
  definition:=replace(definition,'''created'',created)',
    '''created'',created,''archivedAt'',a.reporting_archived_at,''updatedAt'',a.updated_at,''machineCount'',(select count(*) from public.reporting_machines m where m.account_id=a.id))');
  execute definition;
end;
$migration$;

create function public.admin_manage_reporting_company(
  p_account_id uuid,p_action text,p_expected_updated_at timestamptz,
  p_name text default null,p_reason text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare before_row public.customer_accounts; after_row public.customer_accounts;
  action text:=lower(btrim(coalesce(p_action,''))); new_name text;
  changed boolean:=false; reason text; before_state jsonb; after_state jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(auth.uid()),false) then
    raise exception 'Admin access required' using errcode='42501';
  end if;
  if action not in ('rename','archive','restore') then
    raise exception 'Choose rename, archive or restore' using errcode='22023';
  end if;
  select * into before_row from public.customer_accounts where id=p_account_id for update;
  if before_row.id is null then raise exception 'Company not found' using errcode='22023'; end if;
  if p_expected_updated_at is null or before_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'Company changed. Reload and review before saving.' using errcode='40001';
  end if;
  after_row:=before_row;
  if action='rename' then
    new_name:=btrim(coalesce(p_name,''));
    if new_name='' then raise exception 'Company name is required' using errcode='22023'; end if;
    -- Also lock no-op names so rename/create equivalence always has one lock.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(lower(new_name),1719));
    if exists(select 1 from public.customer_accounts a where a.id<>before_row.id and lower(btrim(a.name))=lower(new_name)) then
      raise exception 'A company with this name already exists' using errcode='23505';
    end if;
    if before_row.name is distinct from new_name then
      update public.customer_accounts set name=new_name where id=before_row.id returning * into after_row;
      changed:=true;
    end if;
  else
    if p_name is not null then raise exception 'Name is only used when renaming a company' using errcode='22023'; end if;
    if (action='archive' and before_row.reporting_archived_at is null)
      or (action='restore' and before_row.reporting_archived_at is not null) then
      update public.customer_accounts set reporting_archived_at=case when action='archive' then clock_timestamp() end
        where id=before_row.id returning * into after_row;
      changed:=true;
    end if;
  end if;
  if changed then
    reason:=coalesce(nullif(btrim(p_reason),''),'Company '||case action when 'rename' then 'renamed' when 'archive' then 'archived' else 'restored' end);
    before_state:=jsonb_build_object('accountId',before_row.id,'accountName',before_row.name,'status',before_row.status,
      'archivedAt',before_row.reporting_archived_at,'updatedAt',before_row.updated_at);
    after_state:=jsonb_build_object('accountId',after_row.id,'accountName',after_row.name,'status',after_row.status,
      'archivedAt',after_row.reporting_archived_at,'updatedAt',after_row.updated_at);
    insert into public.admin_audit_log(actor_user_id,action,entity_type,entity_id,before,after,meta)
      values(auth.uid(),'reporting_company.'||case action when 'rename' then 'renamed' when 'archive' then 'archived' else 'restored' end,
        'customer_account',after_row.id::text,before_state,after_state,jsonb_build_object('reason',reason));
  end if;
  return jsonb_build_object('accountId',after_row.id,'accountName',after_row.name,'status',after_row.status,
    'archivedAt',after_row.reporting_archived_at,'updatedAt',after_row.updated_at,'changed',changed,
    'machineCount',(select count(*) from public.reporting_machines m where m.account_id=after_row.id));
end;
$$;
revoke all on function public.admin_manage_reporting_company(uuid,text,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_manage_reporting_company(uuid,text,timestamptz,text,text) to authenticated;
select pg_notify('pgrst','reload schema');
