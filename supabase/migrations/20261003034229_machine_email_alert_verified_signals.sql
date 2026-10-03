-- Signals require explicit provider evidence; missing rows never mean offline.
create table private.email_alert_device_observations(
 machine_id uuid primary key references public.reporting_machines(id) on delete cascade,
 provider_field text not null check(provider_field='MachineMQTTStatus'),
 is_online boolean not null,first_observed_at timestamptz not null,last_observed_at timestamptz not null,
 observation_count integer not null check(observation_count>0),
 source_mapping_fingerprint text not null,
 has_observed_online boolean not null default false,last_online_observed_at timestamptz,
 check(has_observed_online=(last_online_observed_at is not null))
);
alter table private.email_alert_device_observations enable row level security;
revoke all on private.email_alert_device_observations from public,anon,authenticated;
grant select,insert,update on private.email_alert_device_observations to service_role;
create table private.email_alert_device_probe_state(
 machine_id uuid primary key references public.reporting_machines(id) on delete cascade,last_selected_at timestamptz not null);
alter table private.email_alert_device_probe_state enable row level security;
revoke all on private.email_alert_device_probe_state from public,anon,authenticated;
grant select,insert,update on private.email_alert_device_probe_state to service_role;

create function private.email_alert_quiet_candidate(p_machine_id uuid,p_observed_at timestamptz)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text;day_value date;day_start timestamptz;day_end timestamptz;baseline numeric;actual bigint;values_array bigint[]:='{}';count_value bigint;i integer;
begin
 select l.timezone into zone from public.reporting_machines m join public.reporting_locations l on l.id=m.location_id
  where m.id=p_machine_id and m.status='active' and nullif(btrim(m.sunze_machine_id),'') is not null;
 if zone is null then return null;end if;
 day_value:=(p_observed_at at time zone zone)::date-1;
 for i in 0..4 loop
  day_start:=((day_value-i*7)::timestamp at time zone zone);day_end:=((day_value-i*7+1)::timestamp at time zone zone);
  if not exists(select 1 from public.sunze_cash_source_watermarks w where w.reporting_machine_id=p_machine_id
    and w.coverage_started_at<=day_start and w.covered_through>=day_end and w.payment_time_timezone=zone
    and w.payment_time_basis='validated_iana_timezone' and w.timestamp_proof_scope='account'
    and (i>0 or w.freshness_expires_at>p_observed_at)) then return null;end if;
  select coalesce(sum(c.sales_transaction_count),0) into count_value
   from private.machine_sales_daily_components(p_machine_id,day_value-i*7,day_value-i*7) c
   where c.tender='cash' and c.source='sunze_browser';
  if i=0 then actual:=count_value;else values_array:=array_append(values_array,count_value);end if;
 end loop;
 select percentile_cont(0.5) within group(order by v)::numeric into baseline from unnest(values_array) v;
 return jsonb_build_object('machineId',p_machine_id,'signalKey','cash-day:'||day_value::text,
   'evidenceSource','sunze_validated_payment_window','observedAt',p_observed_at,'validUntil',p_observed_at+interval '24 hours',
   'payload',jsonb_build_object('periodStart',day_value::timestamp at time zone zone,'periodEnd',(day_value+1)::timestamp at time zone zone,
    'timezone',zone,'actualTransactions',actual,'baselineTransactions',baseline,'baselinePeriods',4,'paymentScope','cash','coverageVerified',true));
end $$;
revoke all on function private.email_alert_quiet_candidate(uuid,timestamptz) from public,anon,authenticated;

create function public.service_get_email_alert_signal_inputs(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare devices jsonb;quiet_periods jsonb:='[]';machine_candidate record;candidate jsonb;
begin
 -- Read-only source probing may bootstrap capability before anyone can opt in.
 -- Existing opt-ins sort first, bootstrap rotates oldest capability first.
 with candidates as materialized(
  select m.id,m.nayax_machine_id,m.nayax_account_key,
    exists(select 1 from public.email_alert_preferences p cross join lateral private.email_alert_selected_scope(p.user_id,'device-offline') s where p.alert_id='device-offline' and p.enabled and s.machine_id=m.id) opted,
    probe.last_selected_at last_observed
  from public.reporting_machines m left join private.email_alert_device_observations o on o.machine_id=m.id
  left join private.email_alert_device_probe_state probe on probe.machine_id=m.id
  where m.status='active' and nullif(btrim(m.nayax_machine_id),'') is not null and nullif(btrim(m.nayax_account_key),'') is not null
    and exists(select 1 from auth.users u cross join lateral private.email_alert_machine_scope(u.id) s where s.machine_id=m.id and u.deleted_at is null)
 ), shortlisted as (select * from candidates where opted union all
  (select * from candidates c where not opted and not exists(select 1 from private.email_alert_signal_capabilities cap where cap.machine_id=c.id and cap.alert_id='device-offline' and cap.verified_until>p_observed_at
    and private.email_alert_capability_is_current(cap.machine_id,cap.alert_id,p_observed_at))
   order by last_observed nulls first,id limit 12))
 select coalesce(jsonb_agg(jsonb_build_object('machineId',x.id,'nayaxMachineId',x.nayax_machine_id,'nayaxAccountKey',x.nayax_account_key,'subscribed',x.opted)
  order by x.opted desc,x.last_observed nulls first,x.id),'[]') into devices from shortlisted x;
 insert into private.email_alert_device_probe_state(machine_id,last_selected_at)
  select (d->>'machineId')::uuid,p_observed_at from jsonb_array_elements(devices) d
  on conflict(machine_id) do update set last_selected_at=excluded.last_selected_at;
 for machine_candidate in select distinct s.machine_id from auth.users u cross join lateral private.email_alert_machine_scope(u.id) s where u.deleted_at is null loop
  candidate:=private.email_alert_quiet_candidate(machine_candidate.machine_id,p_observed_at);
  if candidate is null then continue;end if;
  insert into private.email_alert_signal_capabilities(machine_id,alert_id,evidence_source,verified_until)
   values(machine_candidate.machine_id,'sales-quiet','sunze_validated_payment_window',p_observed_at+interval '24 hours')
   on conflict(machine_id,alert_id) do update set verified_until=excluded.verified_until,updated_at=p_observed_at;
  if (candidate#>>'{payload,baselineTransactions}')::numeric>0 and (candidate#>>'{payload,actualTransactions}')::numeric<=(candidate#>>'{payload,baselineTransactions}')::numeric*0.5
    and exists(select 1 from public.email_alert_preferences p cross join lateral private.email_alert_selected_scope(p.user_id,'sales-quiet') s where p.alert_id='sales-quiet' and p.enabled and s.machine_id=machine_candidate.machine_id) then
   quiet_periods:=quiet_periods||jsonb_build_array(candidate);
  end if;
 end loop;
 return jsonb_build_object('observedAt',p_observed_at,'devices',devices,'quietPeriods',quiet_periods,'payloadRedacted',true);
end $$;
revoke all on function public.service_get_email_alert_signal_inputs(timestamptz) from public,anon,authenticated;
grant execute on function public.service_get_email_alert_signal_inputs(timestamptz) to service_role;

create function public.service_record_email_alert_device_observation(p_machine_id uuid,p_observed_at timestamptz,p_provider_field text,p_is_online boolean,
 p_expected_account_key text,p_expected_nayax_machine_id text)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare old private.email_alert_device_observations;current_mapping text;first_at timestamptz;n integer;signal_id uuid;payload jsonb;has_online boolean;online_at timestamptz;machine_row public.reporting_machines;
begin
 if p_observed_at is null or p_observed_at>statement_timestamp()+interval '1 minute' or p_observed_at<statement_timestamp()-interval '6 minutes'
   or p_provider_field is distinct from 'MachineMQTTStatus' or p_is_online is null
   or nullif(btrim(p_expected_account_key),'') is null or nullif(btrim(p_expected_nayax_machine_id),'') is null then raise exception 'Fresh explicit MQTT observation and captured mapping required' using errcode='22023';end if;
 select * into machine_row from public.reporting_machines where id=p_machine_id and status='active' for share;
 if machine_row.id is null or btrim(machine_row.nayax_account_key) is distinct from btrim(p_expected_account_key)
   or btrim(machine_row.nayax_machine_id) is distinct from btrim(p_expected_nayax_machine_id) then
  return jsonb_build_object('recorded',false,'reason','mapping_changed','payloadRedacted',true);end if;
 current_mapping:=private.email_alert_hash(machine_row.nayax_account_key||'|'||machine_row.nayax_machine_id);
 if current_mapping is null then raise exception 'No verified device mapping' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('email_alert_device:'||p_machine_id::text,0));
 select * into old from private.email_alert_device_observations where machine_id=p_machine_id for update;
 if old.last_observed_at>=p_observed_at then return jsonb_build_object('recorded',false,'reason','out_of_order');end if;
 first_at:=case when old.is_online=false and p_is_online=false and old.last_observed_at>=p_observed_at-interval '6 minutes' and old.source_mapping_fingerprint=current_mapping then old.first_observed_at else p_observed_at end;
 n:=case when first_at=old.first_observed_at then old.observation_count+1 else 1 end;
 has_online:=p_is_online or coalesce(old.has_observed_online and old.source_mapping_fingerprint=current_mapping,false);
 online_at:=case when p_is_online then p_observed_at when has_online then old.last_online_observed_at end;
 insert into private.email_alert_device_observations values(p_machine_id,p_provider_field,p_is_online,first_at,p_observed_at,n,current_mapping,has_online,online_at)
 on conflict(machine_id) do update set provider_field=excluded.provider_field,is_online=excluded.is_online,first_observed_at=excluded.first_observed_at,
  last_observed_at=excluded.last_observed_at,observation_count=excluded.observation_count,source_mapping_fingerprint=excluded.source_mapping_fingerprint,
  has_observed_online=excluded.has_observed_online,last_online_observed_at=excluded.last_online_observed_at;
 if has_online then
  insert into private.email_alert_signal_capabilities(machine_id,alert_id,evidence_source,verified_until)
  values(p_machine_id,'device-offline','nayax_mqtt_status',p_observed_at+interval '24 hours')
  on conflict(machine_id,alert_id) do update set evidence_source=excluded.evidence_source,verified_until=excluded.verified_until,updated_at=p_observed_at;
 else delete from private.email_alert_signal_capabilities where machine_id=p_machine_id and alert_id='device-offline';end if;
 if p_is_online then update private.email_alert_signals set valid_until=greatest(observed_at+interval '1 millisecond',p_observed_at) where machine_id=p_machine_id and alert_id='device-offline' and valid_until>p_observed_at;end if;
 if has_online and not p_is_online and first_at>=online_at and n>=4 and p_observed_at-first_at>=interval '15 minutes' then
  payload:=jsonb_build_object('component','Nayax MQTT connection','firstObservedAt',first_at,'lastObservedAt',p_observed_at,'observationCount',n,
    'state','offline','providerField',p_provider_field,'providerFieldValue',false,'priorOnlineObservedAt',online_at);
  insert into private.email_alert_signals(machine_id,alert_id,signal_key,evidence_source,observed_at,valid_until,payload)
   values(p_machine_id,'device-offline','outage:'||first_at::text,'nayax_mqtt_status',p_observed_at,p_observed_at+interval '6 minutes',payload)
  on conflict(machine_id,alert_id,signal_key) do update set valid_until=excluded.valid_until,payload=excluded.payload returning id into signal_id;
 end if;
 return jsonb_build_object('recorded',true,'signalId',signal_id,'observationCount',n,'payloadRedacted',true);
end $$;
revoke all on function public.service_record_email_alert_device_observation(uuid,timestamptz,text,boolean,text,text) from public,anon,authenticated;
grant execute on function public.service_record_email_alert_device_observation(uuid,timestamptz,text,boolean,text,text) to service_role;

create function public.service_record_email_alert_signal(p_signal jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare candidate jsonb;signal_id uuid;observed timestamptz;machine uuid;
begin
 if p_signal->>'schemaVersion' is distinct from 'machine_email_signal_v1' or p_signal->>'category' is distinct from 'sales-quiet' then
  raise exception 'Only validated cash-period candidates may be recorded here' using errcode='22023';end if;
 machine:=(p_signal->>'machineId')::uuid;observed:=(p_signal->>'observedAt')::timestamptz;
 if observed>statement_timestamp()+interval '1 minute' or observed<statement_timestamp()-interval '10 minutes' then raise exception 'Fresh signal observation required' using errcode='22023';end if;
 candidate:=private.email_alert_quiet_candidate(machine,observed);
 if candidate is null or candidate->'payload' is distinct from p_signal->'payload' or candidate->>'signalKey' is distinct from p_signal->>'signalKey'
   or candidate->>'evidenceSource' is distinct from p_signal->>'evidenceSource'
   or (candidate#>>'{payload,baselineTransactions}')::numeric<=0
   or (candidate#>>'{payload,actualTransactions}')::numeric>(candidate#>>'{payload,baselineTransactions}')::numeric*0.5 then
  raise exception 'Signal does not match complete source evidence' using errcode='22023';end if;
 insert into private.email_alert_signals(machine_id,alert_id,signal_key,evidence_source,observed_at,valid_until,payload)
 values(machine,'sales-quiet',candidate->>'signalKey',candidate->>'evidenceSource',observed,observed+interval '24 hours',candidate->'payload')
 on conflict(machine_id,alert_id,signal_key) do nothing returning id into signal_id;
 return jsonb_build_object('recorded',signal_id is not null,'signalId',signal_id,'payloadRedacted',true);
end $$;
revoke all on function public.service_record_email_alert_signal(jsonb) from public,anon,authenticated;
grant execute on function public.service_record_email_alert_signal(jsonb) to service_role;

create function private.email_alert_signal_is_current(p_signal_id uuid,p_observed_at timestamptz)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare s private.email_alert_signals;o private.email_alert_device_observations;mapping text;candidate jsonb;
begin
 select * into s from private.email_alert_signals where id=p_signal_id and observed_at<=p_observed_at and valid_until>p_observed_at;
 if s.id is null then return false;end if;
 if s.alert_id='sales-quiet' then
  candidate:=private.email_alert_quiet_candidate(s.machine_id,p_observed_at);
  return candidate is not null and candidate->'payload'=s.payload;
 end if;
 select * into o from private.email_alert_device_observations where machine_id=s.machine_id;
 select private.email_alert_hash(nayax_account_key||'|'||nayax_machine_id) into mapping from public.reporting_machines where id=s.machine_id and status='active';
 return coalesce(o.has_observed_online and not o.is_online and o.first_observed_at>=o.last_online_observed_at and o.last_observed_at>=p_observed_at-interval '6 minutes' and o.source_mapping_fingerprint=mapping
  and o.first_observed_at=(s.payload->>'firstObservedAt')::timestamptz and o.observation_count>=4,false);
end $$;
revoke all on function private.email_alert_signal_is_current(uuid,timestamptz) from public,anon,authenticated;

create function private.email_alert_capability_is_current(p_machine_id uuid,p_category text,p_observed_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.email_alert_signal_capabilities cap join public.reporting_machines m on m.id=cap.machine_id
  left join private.email_alert_device_observations o on o.machine_id=cap.machine_id
  where cap.machine_id=p_machine_id and cap.alert_id=p_category and cap.verified_until>p_observed_at and m.status='active'
   and (p_category<>'device-offline' or (o.has_observed_online and o.source_mapping_fingerprint=private.email_alert_hash(m.nayax_account_key||'|'||m.nayax_machine_id))));
$$;
revoke all on function private.email_alert_capability_is_current(uuid,text,timestamptz) from public,anon,authenticated;

-- Revalidate at selection and at the final provider boundary; a changed device
-- mapping, online observation or corrected sales import invalidates old proof.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('private.email_alert_context(uuid)'::regprocedure);
 definition:=replace(definition,'cap.verified_until>statement_timestamp()',
  'cap.verified_until>statement_timestamp() and private.email_alert_capability_is_current(cap.machine_id,cap.alert_id,statement_timestamp())');
 execute definition;
 definition:=pg_get_functiondef('public.save_my_email_alert_preferences(jsonb,integer)'::regprocedure);
 definition:=replace(definition,'cap.verified_until>statement_timestamp()',
  'cap.verified_until>statement_timestamp() and private.email_alert_capability_is_current(cap.machine_id,cap.alert_id,statement_timestamp())');
 execute definition;
 definition:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 definition:=replace(definition,'s.valid_until>p_observed_at','s.valid_until>p_observed_at and private.email_alert_signal_is_current(s.id,p_observed_at)');
 definition:=replace(definition,'z.valid_until>p_observed_at','z.valid_until>p_observed_at and private.email_alert_signal_is_current(z.id,p_observed_at)');
 execute definition;
 definition:=pg_get_functiondef('private.email_alert_due_candidates(timestamptz)'::regprocedure);
 definition:=replace(definition,'z.valid_until>p_observed_at','z.valid_until>p_observed_at and private.email_alert_signal_is_current(z.id,p_observed_at)');
 execute definition;
 definition:=pg_get_functiondef('public.service_mark_email_alert_provider_started(uuid,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'where id=j.event_id and valid_until>statement_timestamp()',
  'where id=j.event_id and valid_until>statement_timestamp() and private.email_alert_signal_is_current(id,statement_timestamp())');
 execute definition;
end $$;
