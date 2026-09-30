-- Depends on refund_gift_card_issuance. Pool.enabled is the single activation
-- control; rules are deterministic stock targets, never customer eligibility.
create table public.refund_gift_card_refill_rules (
  pool_id uuid primary key references public.refund_gift_card_pools(id),
  min_available integer not null check (min_available between 0 and 199),
  target_available integer not null check (target_available between 1 and 200 and target_available > min_available),
  max_batch_size integer not null default 20 check (max_batch_size between 1 and 200),
  validity_days integer not null default 90 check(validity_days between 1 and 90),
  renew_before_days integer not null default 30 check(renew_before_days between 1 and 89 and renew_before_days<validity_days),
  provider_config jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_config)='object'),
  next_check_at timestamptz not null default now(),
  last_check_at timestamptz,
  last_reason text,
  incident_id uuid,
  updated_at timestamptz not null default now()
);
create table public.refund_gift_card_refill_attempts (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.refund_gift_card_pools(id),
  provider text not null,
  provider_account_id text not null,
  requested_count integer not null check(requested_count between 1 and 200),
  status text not null default 'preparing' check(status in ('preparing','submitting','unknown','complete','failed')),
  claim_token uuid,
  claimed_at timestamptz,
  attempted_at timestamptz,
  baseline jsonb not null default '[]'::jsonb check(jsonb_typeof(baseline)='array'),
  reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
-- Provider-account serialization also protects Sunzee's before/after list delta.
-- An uncertain creation blocks further creation only in that account.
create unique index refund_gift_card_refill_account_active_idx
  on public.refund_gift_card_refill_attempts(provider,provider_account_id)
  where status in ('preparing','submitting','unknown');
alter table public.refund_gift_card_refill_rules enable row level security;
alter table public.refund_gift_card_refill_attempts enable row level security;
revoke all on public.refund_gift_card_refill_rules,public.refund_gift_card_refill_attempts from public,anon,authenticated;
grant all on public.refund_gift_card_refill_rules,public.refund_gift_card_refill_attempts to service_role;

create function public.admin_configure_refund_gift_card_supply(
  p_pool_id uuid,p_min_available integer,p_target_available integer,
  p_max_batch_size integer,p_provider_config jsonb default null,
  p_validity_days integer default null,p_renew_before_days integer default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare config jsonb; validity integer; renew_before integer; provider text;
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  select coalesce(p_provider_config,r.provider_config),coalesce(p_validity_days,r.validity_days,90),
    coalesce(p_renew_before_days,r.renew_before_days,30) into config,validity,renew_before
    from (select 1) seed left join public.refund_gift_card_refill_rules r on r.pool_id=p_pool_id;
  select p.provider into provider from public.refund_gift_card_pools p where p.id=p_pool_id;
  if jsonb_typeof(config) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(config) k where k not in
      ('credential_prefix','merchant_id','machine_ids','timezone','validity_months',
       'account_wide_scope','scope_verified','currency_verified'))
    or coalesce(config->>'credential_prefix','') !~ '^[A-Z][A-Z0-9_]{0,70}$'
    or config->>'scope_verified' is distinct from 'true'
    or config->>'currency_verified' is distinct from 'true'
    or (provider='sunzee' and (coalesce(config->>'validity_months','') !~ '^[1-3]$'
      or validity>(config->>'validity_months')::integer*30)) then
    raise exception 'Verified provider configuration required';
  end if;
  if exists(select 1 from public.refund_gift_card_refill_attempts where pool_id=p_pool_id
    and status in ('preparing','submitting','unknown')) then
    raise exception 'Reconcile active refill before changing configuration';
  end if;
  insert into public.refund_gift_card_refill_rules(pool_id,min_available,target_available,max_batch_size,provider_config,validity_days,renew_before_days)
    values(p_pool_id,p_min_available,p_target_available,p_max_batch_size,config,validity,renew_before)
    on conflict(pool_id) do update set min_available=excluded.min_available,
      target_available=excluded.target_available,max_batch_size=excluded.max_batch_size,
      provider_config=excluded.provider_config,validity_days=excluded.validity_days,
      renew_before_days=excluded.renew_before_days,next_check_at=now(),last_reason=null,updated_at=now();
  return jsonb_build_object('configured',true,'payloadRedacted',true);
end $$;

create function public.admin_setup_refund_gift_card_pool(
  p_provider text,p_provider_account_id text,p_face_value_cents integer,
  p_eligible_machine_ids uuid[],p_eligible_locations text[],p_redemption_instructions text,
  p_provider_config jsonb,p_min_available integer default 5,p_target_available integer default 20,
  p_max_batch_size integer default 20,p_validity_days integer default 90,p_renew_before_days integer default 30
) returns jsonb language plpgsql security definer set search_path='' as $$
declare pool_id uuid;
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  if p_face_value_cents%500<>0 then raise exception 'Launch denomination must be a $5 increment'; end if;
  insert into public.refund_gift_card_pools(provider,provider_account_id,currency,face_value_cents,
    eligible_machine_ids,eligible_locations,expires_at,enabled,redemption_instructions)
    values(p_provider,p_provider_account_id,'USD',p_face_value_cents,p_eligible_machine_ids,p_eligible_locations,
      date_trunc('second',clock_timestamp())+make_interval(days=>p_validity_days),false,p_redemption_instructions)
    returning id into pool_id;
  perform public.admin_configure_refund_gift_card_supply(pool_id,p_min_available,p_target_available,p_max_batch_size,
    p_provider_config,p_validity_days,p_renew_before_days);
  return jsonb_build_object('poolId',pool_id,'enabled',false,'payloadRedacted',true);
end $$;

create function public.service_rollover_refund_gift_card_supply()
returns integer language plpgsql security definer set search_path='' as $$
declare rule public.refund_gift_card_refill_rules%rowtype; renewed integer:=0;
begin
  for rule in select r.* from public.refund_gift_card_refill_rules r
    join public.refund_gift_card_pools p on p.id=r.pool_id
    where p.enabled and p.expires_at<=clock_timestamp()+make_interval(days=>r.renew_before_days)
      and not exists(select 1 from public.refund_gift_card_refill_attempts a
        where a.pool_id=p.id and a.status in ('preparing','submitting','unknown'))
    order by p.id for update of r skip locked loop
    perform public.service_renew_refund_gift_card_pool(rule.pool_id,
      date_trunc('second',clock_timestamp())+make_interval(days=>rule.validity_days));
    update public.refund_gift_card_refill_rules set next_check_at=now() where pool_id=rule.pool_id;
    renewed:=renewed+1;
  end loop;
  return renewed;
end $$;

create function public.admin_set_refund_gift_card_pool_enabled(p_pool_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  if p_enabled is null then raise exception 'Explicit pool state required'; end if;
  if p_enabled and not exists(select 1 from public.refund_gift_card_pools p
    join public.refund_gift_card_refill_rules r on r.pool_id=p.id where p.id=p_pool_id
      and p.expires_at>now() and r.provider_config->>'scope_verified'='true'
      and r.provider_config->>'currency_verified'='true') then
    raise exception 'Configured current provider terms required';
  end if;
  update public.refund_gift_card_pools set enabled=p_enabled where id=p_pool_id;
  if not found then raise exception 'Pool not found'; end if;
  return jsonb_build_object('enabled',p_enabled,'payloadRedacted',true);
end $$;

create function public.internal_import_refund_gift_card_codes(p_pool_id uuid,p_codes jsonb,p_source text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pool public.refund_gift_card_pools%rowtype; item jsonb; inserted integer:=0;
  replayed integer:=0; affected integer; code_value text; provider_id text;
  v_valid_from timestamptz; v_expires_at timestamptz;
begin
  select * into pool from public.refund_gift_card_pools where id=p_pool_id for update;
  if pool.id is null or pool.expires_at<=now() or jsonb_typeof(p_codes) is distinct from 'array'
    or jsonb_array_length(p_codes) not between 1 and 200
    or nullif(btrim(p_source),'') is null or length(p_source)>160 then
    raise exception 'Valid pool and bounded provider code batch required';
  end if;
  if (select count(*) from jsonb_array_elements(p_codes)) <>
     (select count(distinct value->>'code') from jsonb_array_elements(p_codes)) then
    raise exception 'Duplicate codes in provider batch';
  end if;
  for item in select value from jsonb_array_elements(p_codes) loop
    -- A JSON number has already lost its original formatting. Setup imports
    -- must supply strings; Sunzee's observed numeric API is normalized upstream.
    if jsonb_typeof(item->'code') is distinct from 'string' then
      raise exception 'Provider codes must be strings';
    end if;
    code_value:=item->>'code'; provider_id:=nullif(btrim(item->>'provider_code_id'),'');
    if code_value !~ '^[0-9]{6,9}$'
      or (pool.provider='kemore' and length(code_value)<>9)
      or (pool.provider='sunzee' and length(code_value)<>6)
      or provider_id is null or length(provider_id)>160 then
      raise exception 'Invalid provider code identity';
    end if;
    v_valid_from:=(item->>'valid_from')::timestamptz; v_expires_at:=(item->>'expires_at')::timestamptz;
    if v_valid_from is null or v_expires_at is null or v_valid_from>=v_expires_at
      or v_expires_at<pool.expires_at or v_expires_at<=now() then
      raise exception 'Provider validity does not cover advertised terms';
    end if;
    if exists(select 1 from public.refund_gift_card_codes c where c.provider=pool.provider
      and c.provider_account_id=pool.provider_account_id
      and (c.code=code_value or c.provider_code_id=provider_id)
      and (c.pool_id<>pool.id or c.code<>code_value or c.provider_code_id<>provider_id
        or c.valid_from<>v_valid_from or c.expires_at<>v_expires_at)) then
      raise exception 'Provider code conflicts with existing inventory';
    end if;
    insert into public.refund_gift_card_codes(pool_id,provider,provider_account_id,
      provider_code_id,code,valid_from,expires_at,status,provider_evidence)
    values(pool.id,pool.provider,pool.provider_account_id,provider_id,code_value,
      v_valid_from,v_expires_at,'available',jsonb_build_object('source',p_source,'one_use',true))
    on conflict do nothing;
    get diagnostics affected=row_count;
    inserted:=inserted+affected; replayed:=replayed+1-affected;
  end loop;
  update public.refund_gift_card_refill_rules set next_check_at=now(),updated_at=now() where pool_id=pool.id;
  return jsonb_build_object('importedCount',inserted,'replayedCount',replayed,'payloadRedacted',true);
end $$;

create function public.admin_import_refund_gift_card_codes(p_pool_id uuid,p_codes jsonb,p_source_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  return public.internal_import_refund_gift_card_codes(p_pool_id,p_codes,'setup_or_recovery:'||p_source_reference);
end $$;

create function public.service_claim_refund_gift_card_refill(p_excluded_attempt_ids uuid[] default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.refund_gift_card_refill_attempts%rowtype;
  pool public.refund_gift_card_pools%rowtype; rule public.refund_gift_card_refill_rules%rowtype;
  usable integer; token uuid:=gen_random_uuid(); now_at timestamptz:=clock_timestamp();
begin
  -- Stale pre-request work is safely retried. Once dispatch was durably marked,
  -- a stale claim is unknown, even if the process died before its network call.
  update public.refund_gift_card_refill_attempts set status='unknown',reason='worker_interrupted',
    claim_token=null,claimed_at=null where status='submitting' and claimed_at<now_at-interval '5 minutes';
  update public.refund_gift_card_refill_attempts set status='failed',reason='preparation_interrupted',
    completed_at=now_at,claim_token=null,claimed_at=null where status='preparing' and claimed_at<now_at-interval '5 minutes';
  select a.* into attempt from public.refund_gift_card_refill_attempts a
    join public.refund_gift_card_pools p on p.id=a.pool_id
    where a.status='unknown' and p.enabled and p.expires_at>now_at
      and not(a.id=any(p_excluded_attempt_ids))
      and (a.claimed_at is null or a.claimed_at<now_at-interval '5 minutes')
    order by a.created_at for update of a skip locked limit 1;
  if attempt.id is not null then
    select * into pool from public.refund_gift_card_pools where id=attempt.pool_id;
    select * into rule from public.refund_gift_card_refill_rules where pool_id=attempt.pool_id;
    update public.refund_gift_card_refill_attempts set claim_token=token,claimed_at=now_at where id=attempt.id;
    return jsonb_build_object('claimed',true,'attemptId',attempt.id,'claimToken',token,'reconcile',true,
      'requestedCount',attempt.requested_count,'pool',to_jsonb(pool),'config',rule.provider_config,
      'baseline',attempt.baseline,'attemptedAt',attempt.attempted_at);
  end if;
  for rule in select r.* from public.refund_gift_card_refill_rules r
    join public.refund_gift_card_pools p on p.id=r.pool_id
    where p.enabled and p.expires_at>now_at and r.next_check_at<=now_at
    order by r.next_check_at for update of r skip locked loop
    select * into pool from public.refund_gift_card_pools where id=rule.pool_id;
    -- Acquire the account lock before examining active operations, including
    -- different pools with the same credential/account. Hash collisions serialize.
    if not pg_try_advisory_xact_lock(hashtextextended(pool.provider||':'||pool.provider_account_id,0)) then continue; end if;
    if exists(select 1 from public.refund_gift_card_refill_attempts where provider=pool.provider
      and provider_account_id=pool.provider_account_id and status in ('preparing','submitting','unknown')) then continue; end if;
    select count(*) into usable from public.refund_gift_card_codes where pool_id=pool.id
      and status='available' and valid_from<=now_at and expires_at>=pool.expires_at;
    update public.refund_gift_card_refill_rules set last_check_at=now_at,next_check_at=now_at+interval '5 minutes',
      last_reason=case when usable>=min_available then 'healthy_stock' else 'refill_due' end where pool_id=pool.id;
    if usable>=rule.min_available then continue; end if;
    insert into public.refund_gift_card_refill_attempts(pool_id,provider,provider_account_id,requested_count,claim_token,claimed_at)
      values(pool.id,pool.provider,pool.provider_account_id,least(rule.max_batch_size,rule.target_available-usable),token,now_at)
      returning * into attempt;
    return jsonb_build_object('claimed',true,'attemptId',attempt.id,'claimToken',token,'reconcile',false,
      'requestedCount',attempt.requested_count,'pool',to_jsonb(pool),'config',rule.provider_config,'baseline','[]'::jsonb,'attemptedAt',null);
  end loop;
  return jsonb_build_object('claimed',false,'payloadRedacted',true);
end $$;

create function public.service_begin_refund_gift_card_refill(p_attempt_id uuid,p_claim_token uuid,p_baseline jsonb,p_attempted_at timestamptz)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if jsonb_typeof(p_baseline) is distinct from 'array' or jsonb_array_length(p_baseline)>5000
    or exists(select 1 from jsonb_array_elements(p_baseline) v where jsonb_typeof(v)<>'string')
    or p_attempted_at is null or abs(extract(epoch from clock_timestamp()-p_attempted_at))>60 then
    raise exception 'Exact pre-dispatch evidence required';
  end if;
  update public.refund_gift_card_refill_attempts set status='submitting',baseline=p_baseline,attempted_at=p_attempted_at
    where id=p_attempt_id and claim_token=p_claim_token and status='preparing'
      and claimed_at>clock_timestamp()-interval '5 minutes';
  return found;
end $$;

create function public.service_finish_refund_gift_card_refill(p_attempt_id uuid,p_claim_token uuid,p_outcome text,p_reason text,p_codes jsonb default '[]')
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.refund_gift_card_refill_attempts%rowtype; imported jsonb; incident uuid;
begin
  if p_outcome not in ('complete','failed','unknown') or p_reason !~ '^[a-z_]{1,80}$' then
    raise exception 'Bounded refill outcome required';
  end if;
  select * into attempt from public.refund_gift_card_refill_attempts where id=p_attempt_id for update;
  if attempt.claim_token is distinct from p_claim_token or attempt.id is null
    or attempt.status not in ('preparing','submitting','unknown') then
    return jsonb_build_object('settled',false,'payloadRedacted',true);
  end if;
  if p_outcome='complete' then
    if attempt.attempted_at is null or jsonb_array_length(p_codes)<>attempt.requested_count then
      raise exception 'Exact requested provider batch required';
    end if;
    imported:=public.internal_import_refund_gift_card_codes(attempt.pool_id,p_codes,'automatic_refill:'||attempt.id);
  end if;
  update public.refund_gift_card_refill_attempts set status=p_outcome,reason=p_reason,
    claim_token=null,claimed_at=case when p_outcome='unknown' then now() else null end,
    completed_at=case when p_outcome='unknown' then null else now() end where id=attempt.id;
  update public.refund_gift_card_refill_rules set last_reason=p_reason,
    incident_id=case when p_outcome='complete' then null else coalesce(incident_id,gen_random_uuid()) end,
    next_check_at=now()+case when p_outcome='failed' then interval '30 minutes' else interval '5 minutes' end,
    updated_at=now() where pool_id=attempt.pool_id returning incident_id into incident;
  return coalesce(imported,'{}'::jsonb)||jsonb_build_object('settled',true,'outcome',p_outcome,'incidentId',incident,'payloadRedacted',true);
end $$;

create function public.admin_get_refund_gift_card_supply()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  return jsonb_build_object('pools',coalesce((select jsonb_agg(jsonb_build_object(
    'id',p.id,'provider',p.provider,'providerAccountId',p.provider_account_id,
    'currency',p.currency,'faceValueCents',p.face_value_cents,'expiresAt',p.expires_at,
    'enabled',p.enabled,'eligibleLocations',p.eligible_locations,
    'usableCount',(select count(*) from public.refund_gift_card_codes c where c.pool_id=p.id
      and c.status='available' and c.valid_from<=now() and c.expires_at>=p.expires_at and p.expires_at>now()),
    'expiredCount',(select count(*) from public.refund_gift_card_codes c where c.pool_id=p.id
      and c.status='available' and (c.expires_at<=now() or p.expires_at<=now())),
    'minAvailable',r.min_available,'targetAvailable',r.target_available,'maxBatchSize',r.max_batch_size,
    'validityDays',r.validity_days,'renewBeforeDays',r.renew_before_days,
    'configured',r.pool_id is not null,'lastCheckAt',r.last_check_at,'lastReason',r.last_reason,
    'refillState',coalesce((select a.status from public.refund_gift_card_refill_attempts a
      where a.pool_id=p.id order by a.created_at desc limit 1),'not_started')
  ) order by p.provider,p.face_value_cents,p.expires_at) from public.refund_gift_card_pools p
    left join public.refund_gift_card_refill_rules r on r.pool_id=p.id),'[]'::jsonb),'payloadRedacted',true);
end $$;

-- Exceptional recovery only: bind a positively verified batch to the unknown
-- creation. There is intentionally no "retry anyway" or absent-result reset.
create function public.admin_recover_refund_gift_card_refill(p_attempt_id uuid,p_codes jsonb,p_source_reference text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare attempt public.refund_gift_card_refill_attempts%rowtype; imported jsonb;
begin
  if auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Super-admin required' using errcode='42501';
  end if;
  select * into attempt from public.refund_gift_card_refill_attempts where id=p_attempt_id for update;
  if attempt.status is distinct from 'unknown' or attempt.attempted_at is null
    or (attempt.claimed_at is not null and attempt.claimed_at>clock_timestamp()-interval '5 minutes')
    or jsonb_typeof(p_codes) is distinct from 'array' or jsonb_array_length(p_codes)<>attempt.requested_count then
    raise exception 'Unclaimed unknown refill and exact verified batch required';
  end if;
  imported:=public.internal_import_refund_gift_card_codes(attempt.pool_id,p_codes,'reconciled_batch:'||p_source_reference);
  update public.refund_gift_card_refill_attempts set status='complete',reason='verified_recovery',
    claim_token=null,claimed_at=null,completed_at=now() where id=attempt.id;
  update public.refund_gift_card_refill_rules set last_reason='verified_recovery',incident_id=null,
    next_check_at=now(),updated_at=now() where pool_id=attempt.pool_id;
  return imported||jsonb_build_object('settled',true,'payloadRedacted',true);
end $$;

revoke all on function public.internal_import_refund_gift_card_codes(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.admin_configure_refund_gift_card_supply(uuid,integer,integer,integer,jsonb,integer,integer),
  public.admin_setup_refund_gift_card_pool(text,text,integer,uuid[],text[],text,jsonb,integer,integer,integer,integer,integer),
  public.admin_set_refund_gift_card_pool_enabled(uuid,boolean),
  public.admin_recover_refund_gift_card_refill(uuid,jsonb,text),
  public.admin_import_refund_gift_card_codes(uuid,jsonb,text),public.admin_get_refund_gift_card_supply()
  from public,anon,authenticated,service_role;
grant execute on function public.admin_configure_refund_gift_card_supply(uuid,integer,integer,integer,jsonb,integer,integer),
  public.admin_setup_refund_gift_card_pool(text,text,integer,uuid[],text[],text,jsonb,integer,integer,integer,integer,integer),
  public.admin_set_refund_gift_card_pool_enabled(uuid,boolean),
  public.admin_recover_refund_gift_card_refill(uuid,jsonb,text),
  public.admin_import_refund_gift_card_codes(uuid,jsonb,text),public.admin_get_refund_gift_card_supply() to authenticated;
revoke all on function public.service_rollover_refund_gift_card_supply(),public.service_claim_refund_gift_card_refill(uuid[]),
  public.service_begin_refund_gift_card_refill(uuid,uuid,jsonb,timestamptz),
  public.service_finish_refund_gift_card_refill(uuid,uuid,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_rollover_refund_gift_card_supply(),public.service_claim_refund_gift_card_refill(uuid[]),
  public.service_begin_refund_gift_card_refill(uuid,uuid,jsonb,timestamptz),
  public.service_finish_refund_gift_card_refill(uuid,uuid,text,text,jsonb) to service_role;
