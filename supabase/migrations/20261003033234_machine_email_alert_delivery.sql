-- #1715: server-owned projections and durable, at-most-once provider boundary.
create table private.email_alert_delivery_settings (
 singleton boolean primary key default true check(singleton),
 delivery_enabled boolean not null default false,
 activated_at timestamptz
);
insert into private.email_alert_delivery_settings(singleton) values(true);
create table private.email_alert_jobs (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check(category in ('daily','weekly','new-refund','sales-quiet','device-offline')),
 slot_key text not null, observed_at timestamptz not null,date_from date not null,date_to date not null,
 event_id uuid, claim_token uuid not null default gen_random_uuid(),
 state text not null default 'reserved' check(state in ('reserved','sent','known_not_sent','delivery_unknown')),
 attempts integer not null default 1 check(attempts between 1 and 3),
 route_fingerprint text not null, projection_fingerprint text not null,
 legacy_batch_id uuid references public.refund_manager_digest_batches(id),
 provider_started_at timestamptz,provider_id_digest text,error_code text,
 created_at timestamptz not null default statement_timestamp(),updated_at timestamptz not null default statement_timestamp(),
 unique(user_id,category,slot_key),check(date_to>=date_from),
 check((state in ('reserved','known_not_sent') and provider_started_at is null) or
       (state in ('sent','delivery_unknown') and provider_started_at is not null))
);
alter table private.email_alert_delivery_settings enable row level security;
alter table private.email_alert_jobs enable row level security;
revoke all on private.email_alert_delivery_settings,private.email_alert_jobs from public,anon,authenticated;
grant select,insert,update on private.email_alert_delivery_settings,private.email_alert_jobs to service_role;
create index email_alert_jobs_pending on private.email_alert_jobs(state,updated_at) where state in ('reserved','known_not_sent');

create function private.email_alert_hash(p_value text) returns text
language sql immutable strict set search_path='' as $$
 select encode(extensions.digest(convert_to(p_value,'UTF8'),'sha256'),'hex');
$$;
revoke all on function private.email_alert_hash(text) from public,anon,authenticated;

create function private.email_alert_selected_scope(p_user_id uuid,p_category text)
returns table(machine_id uuid,machine_label text,location_name text,timezone text,is_manager boolean,is_technician boolean,can_view_sales boolean)
language sql stable security definer set search_path='' as $$
 select s.* from private.email_alert_machine_scope(p_user_id) s
 left join public.email_alert_preferences p on p.user_id=p_user_id and p.alert_id=p_category
 where coalesce(p.enabled,p_category='daily') and (p_category<>'decision-ready' or s.is_manager)
 and (coalesce(p.scope_mode,'all_assigned')='all_assigned' or s.machine_id=any(p.machine_ids));
$$;
revoke all on function private.email_alert_selected_scope(uuid,text) from public,anon,authenticated;

-- Email is not an unrestricted free-text export. Managers receive a sanitized
-- bounded narrative; technicians receive only fixed symptom descriptions.
create function private.email_alert_comment(p_case public.refund_cases,p_is_manager boolean)
returns text language plpgsql immutable set search_path='' as $$
declare value text:=p_case.issue_summary; sensitive text;
begin
 if not p_is_manager then
   return case
    when lower(coalesce(value,''))~'(did not|didn''t|does not|doesn''t|not|no).{0,20}(dispense|come out|product)' then 'Customer reported that the machine did not dispense.'
    when lower(coalesce(value,''))~'(stuck|jammed)' then 'Customer reported a possible jam.'
    when lower(coalesce(value,''))~'(broken|out of order|not working)' then 'Customer reported that the machine was not working.'
    when lower(coalesce(value,''))~'(wrong|incorrect).{0,15}(item|product)' then 'Customer reported receiving an incorrect product.'
    when lower(coalesce(value,''))~'(damaged|melted|spoiled)' then 'Customer reported a product quality issue.'
    else null end;
 end if;
 foreach sensitive in array array[p_case.customer_email,to_jsonb(p_case)->>'customer_name',
   to_jsonb(p_case)->>'customer_phone',to_jsonb(p_case)->>'zelle_payment_contact'] loop
   if length(coalesce(sensitive,''))>=3 then value:=replace(value,sensitive,'[redacted]'); end if;
 end loop;
 value:=regexp_replace(value,'[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[contact redacted]','gi');
 value:=regexp_replace(value,'https?://[^[:space:]]+','[link redacted]','gi');
 value:=regexp_replace(value,'[0-9][0-9 ()+.-]{5,}[0-9]','[number redacted]','g');
 value:=regexp_replace(value,'(code|token|password|secret|pin)[[:space:]:=#-]+[[:alnum:]_-]+','[credential redacted]','gi');
 return nullif(left(regexp_replace(value,'[[:cntrl:]]',' ','g'),280),'');
end $$;
revoke all on function private.email_alert_comment(public.refund_cases,boolean) from public,anon,authenticated;

create function private.email_alert_projection(p_user_id uuid,p_category text,p_observed_at timestamptz,
 p_date_from date,p_date_to date,p_event_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare settings jsonb; manager_projection jsonb; machine_row record; case_row public.refund_cases;
 cases jsonb; machines jsonb:='[]'; life jsonb; work jsonb; item jsonb; metrics record; previous record;
 manager_map jsonb:='[]'; signal jsonb; machine_ids uuid[]; summary jsonb; new_case boolean; open_case boolean; selected_scope boolean; machine_from date; machine_to date;
begin
 settings:=private.email_alert_context(p_user_id)->'settings';
 if p_category not in ('daily','weekly','new-refund','sales-quiet','device-offline') then raise exception 'Invalid category' using errcode='22023'; end if;
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>7 then raise exception 'Invalid email period' using errcode='22023'; end if;
 if p_category in ('daily','weekly') and exists(select 1 from private.email_alert_machine_scope(p_user_id) where is_manager) then
   manager_projection:=public.refund_manager_daily_digest_projection_for(p_user_id,p_observed_at);
   select coalesce(jsonb_agg(jsonb_build_object('caseId',c.id,'machineId',c.reporting_machine_id) order by c.id),'[]')
   into manager_map from public.refund_cases c join jsonb_array_elements(manager_projection->'items') x on c.id=(x->>'caseId')::uuid;
 end if;
 if p_category in ('sales-quiet','device-offline') then
   select s.payload into signal from private.email_alert_signals s where s.id=p_event_id and s.alert_id=p_category and s.valid_until>p_observed_at;
 end if;
 select array_agg(distinct id) into machine_ids from (
  select s.machine_id id from private.email_alert_selected_scope(p_user_id,p_category) s
  where p_category in ('daily','weekly') or (p_category='new-refund' and exists(select 1 from public.refund_cases c where c.id=p_event_id and c.reporting_machine_id=s.machine_id))
    or exists(select 1 from private.email_alert_signals z where z.id=p_event_id and z.machine_id=s.machine_id and z.alert_id=p_category and z.valid_until>p_observed_at)
  union select (x->>'machineId')::uuid from jsonb_array_elements(manager_map) x
 ) scoped;
 for machine_row in select * from private.email_alert_machine_scope(p_user_id) where machine_id=any(machine_ids) order by location_name,machine_label,machine_id loop
  cases:='[]';selected_scope:=exists(select 1 from private.email_alert_selected_scope(p_user_id,p_category) s where s.machine_id=machine_row.machine_id);
  machine_to:=case when p_category='weekly' then date_trunc('week',p_observed_at at time zone machine_row.timezone)::date-1
    when p_category='daily' then (p_observed_at at time zone machine_row.timezone)::date-1 else (p_observed_at at time zone machine_row.timezone)::date end;
  machine_from:=case when p_category='weekly' then machine_to-6 else machine_to end;
  for case_row in select c.* from public.refund_cases c where c.reporting_machine_id=machine_row.machine_id
    and ((coalesce(c.case_population,'customer')='customer' and c.duplicate_of_refund_case_id is null)
      or exists(select 1 from jsonb_array_elements(manager_map) x where x->>'caseId'=c.id::text))
    and ((p_category='new-refund' and c.id=p_event_id) or (p_category in ('daily','weekly') and
      ((c.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to
       or exists(select 1 from jsonb_array_elements(manager_map) x where x->>'caseId'=c.id::text)
       or (not machine_row.is_manager and coalesce((public.refund_lifecycle_contract(c.id)#>>'{nextWork,isOpen}')::boolean,false)))))
    order by c.customer_request_received_at,c.id loop
   life:=public.refund_lifecycle_contract(case_row.id); work:=life->'nextWork';
   new_case:=p_category='new-refund' or (case_row.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to;
   open_case:=coalesce((work->>'isOpen')::boolean,false);
   select x into item from jsonb_array_elements(coalesce(manager_projection->'items','[]')) x where x->>'caseId'=case_row.id::text;
   cases:=cases||jsonb_build_array(jsonb_build_object('caseId',case_row.id,'publicReference',case_row.public_reference,
    'receivedAt',case_row.customer_request_received_at,'incidentAt',case_row.incident_at,
    'issueCategory',case_row.issue_category,'commentExcerpt',private.email_alert_comment(case_row,machine_row.is_manager),
    'commentRedacted',true,'commentKind',case when machine_row.is_manager then 'sanitized-narrative' else 'operational-summary' end,
    'isNew',coalesce(new_case,false),'isOpen',open_case,'needsDecision',p_category<>'new-refund' and machine_row.is_manager and open_case and work->>'actor'='manager',
    'statusLabel',case when open_case then 'Open' else 'Resolved' end,
    'nextAction',case when p_category='new-refund' then case when machine_row.is_manager then 'View the request in Bloomjoy Hub' else 'Review the machine condition' end
      when machine_row.is_manager then concat_ws(' ',coalesce(item->>'actionLabel',work->>'actionLabel','View request'),
      nullif(item->>'preparationSummary',''),case when item->>'paymentComplete'='true' then 'Payment is already complete; do not pay again.' end) else 'Review the machine condition' end,
    'amountCents',case when machine_row.is_manager then coalesce((item->>'amountCents')::bigint,case_row.refund_amount_cents) else null end,
    'currencyCode',case when machine_row.is_manager then coalesce(item->>'currencyCode',case_row.matched_nayax_currency_code,case when case_row.payment_method='cash' then 'USD' end) end,
    'canOpenCase',machine_row.is_manager));
  end loop;
  select false complete,null::bigint gross,null::bigint refunds,null::bigint net,null::bigint transactions into metrics;
  select null::bigint gross into previous;
  if selected_scope and machine_row.can_view_sales and p_category in ('daily','weekly') then
    select count(*)>0 and coalesce(sum(r.unresolved_sales_count),0)=0 and coalesce(sum(r.unresolved_refund_count),0)=0 complete,
      sum(r.gross_sales_cents) gross,sum(r.refund_amount_cents) refunds,sum(r.net_sales_cents) net,sum(r.transaction_count) transactions
    into metrics from private.sales_report_rows_for_actor(p_user_id,machine_from,machine_to,'day',array[machine_row.machine_id]) r;
    select case when count(*)>0 and coalesce(sum(r.unresolved_sales_count),0)=0 then sum(r.gross_sales_cents) end gross into previous
    from private.sales_report_rows_for_actor(p_user_id,machine_from-7,machine_to-7,'day',array[machine_row.machine_id]) r;
  end if;
  machines:=machines||jsonb_build_array(jsonb_build_object('machineId',machine_row.machine_id,'machineLabel',machine_row.machine_label,
    'locationName',machine_row.location_name,'timezone',machine_row.timezone,'dateFrom',machine_from,'dateTo',machine_to,
    'coverageStatus',case when metrics.complete then 'reported_snapshot' else 'unavailable' end,
    'coverageNote','Reported data at the snapshot time; delayed imports may change totals.',
    'includedInPerformanceScope',selected_scope,'reportingAllowed',machine_row.can_view_sales,'salesComplete',coalesce(metrics.complete,false),
    'grossSalesCents',case when metrics.complete then metrics.gross end,'refundAmountCents',case when metrics.complete then metrics.refunds end,
    'netSalesCents',case when metrics.complete then metrics.net end,'transactionCount',case when metrics.complete then metrics.transactions end,
    'previousGrossSalesCents',previous.gross,'refundCases',cases));
 end loop;
 select jsonb_build_object('machineCount',count(*),'salesMachineCount',count(*) filter(where (m->>'salesComplete')::boolean),
  'grossSalesCents',sum((m->>'grossSalesCents')::bigint),'refundAmountCents',sum((m->>'refundAmountCents')::bigint),
  'netSalesCents',sum((m->>'netSalesCents')::bigint),'transactionCount',sum((m->>'transactionCount')::bigint),
  'newRequestCount',(select count(*) from jsonb_array_elements(machines) mm cross join lateral jsonb_array_elements(mm->'refundCases') c where (mm->>'includedInPerformanceScope')::boolean and (c->>'isNew')::boolean),
  'openCount',(select count(*) from jsonb_array_elements(machines) mm cross join lateral jsonb_array_elements(mm->'refundCases') c where (mm->>'includedInPerformanceScope')::boolean and (c->>'isOpen')::boolean),
  'decisionCount',(select count(*) from jsonb_array_elements(machines) mm cross join lateral jsonb_array_elements(mm->'refundCases') c where (mm->>'includedInPerformanceScope')::boolean and (c->>'needsDecision')::boolean))
 into summary from jsonb_array_elements(machines) m where (m->>'includedInPerformanceScope')::boolean;
 return jsonb_build_object('schemaVersion','machine_email_alert_v1','category',p_category,'userId',p_user_id,'observedAt',p_observed_at,
  'dateFrom',p_date_from,'dateTo',p_date_to,'timezone',settings->>'timezone','reportCurrencyCode','USD','machines',machines,
  'summary',summary,'managerOpenCases',manager_projection,'managerCaseMachines',manager_map,'signal',signal,'payloadRedacted',true);
end $$;
revoke all on function private.email_alert_projection(uuid,text,timestamptz,date,date,uuid) from public,anon,authenticated;

create function private.email_alert_route_fingerprint(p_user_id uuid,p_category text,p_projection jsonb)
returns text language sql stable security definer set search_path='' as $$
 select private.email_alert_hash(jsonb_build_object('email',lower(btrim(u.email)),'context',private.email_alert_context(p_user_id),
   'category',p_category,'projection',p_projection)::text) from auth.users u where u.id=p_user_id and u.deleted_at is null;
$$;
revoke all on function private.email_alert_route_fingerprint(uuid,text,jsonb) from public,anon,authenticated;

create function private.email_alert_digest_schedule(p_user_id uuid,p_category text,p_observed_at timestamptz)
returns table(schedule_date date,due_at timestamptz,date_from date,date_to date)
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;day_value date;scheduled timestamp;effective timestamp;time_value time;quiet_start time;quiet_end time;
begin
 s:=private.email_alert_context(p_user_id)->'settings';
 time_value:=case when p_category='daily' then (s->>'dailyTime')::time else (s->>'weeklyTime')::time end;
 quiet_start:=(s->>'quietStart')::time;quiet_end:=(s->>'quietEnd')::time;
 for day_value in select ((p_observed_at at time zone (s->>'timezone'))::date-i) from generate_series(0,1) i loop
  if p_category='weekly' and extract(isodow from day_value)::int<>(s->>'weeklyDay')::int then continue;end if;
  scheduled:=day_value+time_value;effective:=scheduled;
  if (s->>'quietEnabled')::boolean and quiet_start<>quiet_end then
   if quiet_start<quiet_end and time_value>=quiet_start and time_value<quiet_end then effective:=day_value+quiet_end;
   elsif quiet_start>quiet_end and time_value>=quiet_start then effective:=day_value+1+quiet_end;
   elsif quiet_start>quiet_end and time_value<quiet_end then effective:=day_value+quiet_end;end if;
  end if;
  schedule_date:=day_value;due_at:=effective at time zone (s->>'timezone');
  date_to:=case when p_category='daily' then day_value-1 else date_trunc('week',day_value)::date-1 end;
  date_from:=case when p_category='daily' then date_to else date_to-6 end;return next;
 end loop;
end $$;
revoke all on function private.email_alert_digest_schedule(uuid,text,timestamptz) from public,anon,authenticated;

create function private.email_alert_due_candidates(p_observed_at timestamptz)
returns table(user_id uuid,category text,slot_key text,date_from date,date_to date,event_id uuid)
language plpgsql stable security definer set search_path='' as $$
declare u record; ctx jsonb; settings jsonb; a jsonb; local_now timestamp; quiet boolean; e record; local_day date; scheduled record;
begin
 for u in select id from auth.users where deleted_at is null and email is not null and (banned_until is null or banned_until<=p_observed_at) order by id loop
  if not exists(select 1 from private.email_alert_machine_scope(u.id)) then continue; end if;
  ctx:=private.email_alert_context(u.id);settings:=ctx->'settings';local_now:=p_observed_at at time zone (settings->>'timezone');local_day:=local_now::date;
  quiet:=coalesce((settings->>'quietEnabled')::boolean,true) and case
    when (settings->>'quietStart')::time<(settings->>'quietEnd')::time then local_now::time>=(settings->>'quietStart')::time and local_now::time<(settings->>'quietEnd')::time
    else local_now::time>=(settings->>'quietStart')::time or local_now::time<(settings->>'quietEnd')::time end;
  for a in select * from jsonb_array_elements(ctx->'alerts') loop
   if a->>'enabled'<>'true' or a->>'authorized'<>'true' or a->>'id'='decision-ready' then continue; end if;
   user_id:=u.id;category:=a->>'id';event_id:=null;
   if category in ('daily','weekly') then
    for scheduled in select * from private.email_alert_digest_schedule(u.id,category,p_observed_at) d
      where p_observed_at>=d.due_at and p_observed_at<d.due_at+interval '90 minutes' loop
      date_to:=scheduled.date_to;date_from:=scheduled.date_from;slot_key:=category||':'||date_to::text;return next;
    end loop;
   elsif category='new-refund' then
    if quiet or settings->>'newRefundDelivery'='daily' then continue; end if;
    for e in select c.id,c.customer_request_received_at from public.refund_cases c
      join private.email_alert_selected_scope(u.id,category) s on s.machine_id=c.reporting_machine_id
      join public.email_alert_preferences p on p.user_id=u.id and p.alert_id=category and p.enabled
      where coalesce(c.case_population,'customer')='customer' and c.duplicate_of_refund_case_id is null
       and c.customer_request_received_at>=p.enabled_since and c.customer_request_received_at>p_observed_at-interval '24 hours'
       and c.customer_request_received_at<=p_observed_at
       and not(exists(select 1 from private.email_alert_selected_scope(u.id,'decision-ready') r where r.machine_id=c.reporting_machine_id)
         and exists(select 1 from public.refund_manager_notification_actions n where n.refund_case_id=c.id and n.ready_manager_user_id=u.id
           and n.notice_reason='decision_ready' and n.delivery_state in ('ready_queued','reserved','sent','delivery_unknown')))
       order by c.customer_request_received_at,c.id loop
     event_id:=e.id;date_from:=local_day;date_to:=local_day;slot_key:='case:'||e.id;return next;
    end loop;
   else
    if quiet and not(category='device-offline' and (settings->>'offlineBypass')::boolean) then continue; end if;
    for e in select z.id from private.email_alert_signals z join private.email_alert_selected_scope(u.id,category) s on s.machine_id=z.machine_id
      join public.email_alert_preferences p on p.user_id=u.id and p.alert_id=category and p.enabled
      where z.alert_id=category and z.valid_until>p_observed_at and z.observed_at<=p_observed_at and z.observed_at>=p.enabled_since order by z.observed_at,z.id loop
     event_id:=e.id;date_from:=local_day;date_to:=local_day;slot_key:='signal:'||e.id;return next;
    end loop;
   end if;
  end loop;
 end loop;
end $$;
revoke all on function private.email_alert_due_candidates(timestamptz) from public,anon,authenticated;

create function public.service_preview_email_alerts(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare projections jsonb:='[]'; c record;
begin
 for c in select * from private.email_alert_due_candidates(p_observed_at) limit 30 loop
  projections:=projections||jsonb_build_array(private.email_alert_projection(c.user_id,c.category,p_observed_at,c.date_from,c.date_to,c.event_id));
 end loop;
 return jsonb_build_object('observedAt',p_observed_at,'deliveryEnabled',(select delivery_enabled from private.email_alert_delivery_settings),
  'projections',projections,'payloadRedacted',true);
end $$;
revoke all on function public.service_preview_email_alerts(timestamptz) from public,anon,authenticated;
grant execute on function public.service_preview_email_alerts(timestamptz) to service_role;

create function public.service_email_alert_readiness(p_observed_at timestamptz default statement_timestamp())
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('observedAt',p_observed_at,'deliveryEnabled',(select delivery_enabled from private.email_alert_delivery_settings),
 'eligibleUsers',(select count(*) from auth.users u where u.deleted_at is null and exists(select 1 from private.email_alert_machine_scope(u.id))),
 'dailyDefaultUsers',(select count(*) from auth.users u where u.deleted_at is null and exists(select 1 from private.email_alert_machine_scope(u.id))
   and not exists(select 1 from public.email_alert_preferences p where p.user_id=u.id and p.alert_id='daily')),
 'explicitOptOuts',(select count(*) from public.email_alert_preferences where alert_id='daily' and not enabled),
 'dueCategories',(select coalesce(jsonb_object_agg(category,n),'{}') from(select category,count(*) n from private.email_alert_due_candidates(p_observed_at) group by category) d),
 'sourceCapabilities',(select coalesce(jsonb_object_agg(alert_id,n),'{}') from(select alert_id,count(*) n from private.email_alert_signal_capabilities where verified_until>p_observed_at group by alert_id) d),
 'jobStates',(select coalesce(jsonb_object_agg(state,n),'{}') from(select state,count(*) n from private.email_alert_jobs group by state) d),
 'payloadRedacted',true);
$$;
revoke all on function public.service_email_alert_readiness(timestamptz) from public,anon,authenticated;
grant execute on function public.service_email_alert_readiness(timestamptz) to service_role;

create function public.service_claim_next_email_alert(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c record;j private.email_alert_jobs;projection jsonb;recipient text;route text;legacy public.refund_manager_digest_batches;
 legacy_settings public.refund_manager_digest_settings;legacy_date date;token uuid;manager_items jsonb;
begin
 if not(select delivery_enabled from private.email_alert_delivery_settings where singleton) then
  return jsonb_build_object('claimed',false,'reason','delivery_disabled','payloadRedacted',true);end if;
 for c in select * from private.email_alert_due_candidates(p_observed_at) loop
  -- One user lock serializes concurrent cron invocations, preferences and day slots.
  if not pg_try_advisory_xact_lock(hashtextextended('email_alert_user:'||c.user_id::text,0)) then continue;end if;
  select * into j from private.email_alert_jobs where user_id=c.user_id and category=c.category and slot_key=c.slot_key for update;
  if j.id is not null and (j.state in ('sent','delivery_unknown') or j.attempts>=3 or
    (j.state='reserved' and j.updated_at>p_observed_at-interval '10 minutes') or
    (j.state='known_not_sent' and j.updated_at>p_observed_at-interval '1 minute')) then continue;end if;
  select lower(btrim(email)) into recipient from auth.users where id=c.user_id and deleted_at is null and (banned_until is null or banned_until<=p_observed_at);
  if recipient is null or not public.refund_email_address_is_valid(recipient) then continue;end if;
  projection:=private.email_alert_projection(c.user_id,c.category,p_observed_at,c.date_from,c.date_to,c.event_id);
  if jsonb_array_length(projection->'machines')=0 then continue;end if;
  route:=private.email_alert_route_fingerprint(c.user_id,c.category,projection);token:=gen_random_uuid();legacy:=null;
  if c.category='daily' and exists(select 1 from private.email_alert_machine_scope(c.user_id) where is_manager) then
   select * into legacy_settings from public.refund_manager_digest_settings where singleton;
   legacy_date:=(p_observed_at at time zone legacy_settings.digest_timezone)::date;
   manager_items:=coalesce(projection#>'{managerOpenCases,items}','[]');
   if j.legacy_batch_id is not null then
    select * into legacy from public.refund_manager_digest_batches where id=j.legacy_batch_id for update;
    if legacy.status in ('sent','delivery_unknown') then continue;end if;
    delete from public.refund_manager_digest_items where batch_id=legacy.id;
    update public.refund_manager_digest_batches set status='reserved',claim_token=token,attempt_count=j.attempts+1,
      mapping_fingerprint=route,recipient_fingerprint=private.email_alert_hash(recipient),projection_fingerprint=private.email_alert_hash(manager_items::text),
      projection_observed_at=p_observed_at,item_count=jsonb_array_length(manager_items),provider_attempt_started_at=null,settled_at=null,updated_at=p_observed_at
      where id=legacy.id returning * into legacy;
   else
    insert into public.refund_manager_digest_batches(manager_user_id,digest_local_date,digest_timezone,status,claim_token,
      mapping_fingerprint,recipient_fingerprint,projection_fingerprint,projection_observed_at,item_count)
    values(c.user_id,legacy_date,legacy_settings.digest_timezone,'reserved',token,route,private.email_alert_hash(recipient),
      private.email_alert_hash(manager_items::text),p_observed_at,jsonb_array_length(manager_items))
    on conflict(manager_user_id,digest_local_date,digest_timezone) do nothing returning * into legacy;
    if legacy.id is null then continue;end if;
   end if;
   insert into public.refund_manager_digest_items(batch_id,manager_user_id,notification_action_id,refund_case_id,attention_version)
    select legacy.id,c.user_id,null,(x->>'caseId')::uuid,1 from jsonb_array_elements(manager_items) x;
  end if;
  if j.id is null then
   insert into private.email_alert_jobs(user_id,category,slot_key,observed_at,date_from,date_to,event_id,claim_token,
     route_fingerprint,projection_fingerprint,legacy_batch_id)
   values(c.user_id,c.category,c.slot_key,p_observed_at,c.date_from,c.date_to,c.event_id,token,route,
     private.email_alert_hash(projection::text),legacy.id) returning * into j;
  else
   update private.email_alert_jobs set state='reserved',attempts=attempts+1,observed_at=p_observed_at,claim_token=token,
     route_fingerprint=route,projection_fingerprint=private.email_alert_hash(projection::text),legacy_batch_id=legacy.id,
     error_code=null,updated_at=p_observed_at where id=j.id returning * into j;
  end if;
  return jsonb_build_object('claimed',true,'jobId',j.id,'claimToken',token,'recipient',recipient,'category',c.category,
    'idempotencyKey','machine_email_'||j.id::text,'routeFingerprint',route,'projection',projection,'payloadRedacted',true);
 end loop;
 return jsonb_build_object('claimed',false,'reason','empty_or_deferred','payloadRedacted',true);
end $$;
revoke all on function public.service_claim_next_email_alert(timestamptz) from public,anon,authenticated;
grant execute on function public.service_claim_next_email_alert(timestamptz) to service_role;

create function public.service_mark_email_alert_provider_started(p_job_id uuid,p_claim_token uuid,p_recipient text,p_route_fingerprint text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.email_alert_jobs;projection jsonb;recipient text;m record;
begin
 select * into j from private.email_alert_jobs where id=p_job_id for update;
 if j.id is null or j.claim_token is distinct from p_claim_token or j.state<>'reserved' or j.provider_started_at is not null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('email_alert_user:'||j.user_id::text,0));
 perform 1 from public.email_alert_profiles where user_id=j.user_id for update;
 for m in select machine_id from private.email_alert_machine_scope(j.user_id) order by machine_id loop
  perform pg_advisory_xact_lock(hashtext('machine_manager:'||m.machine_id::text));
  perform 1 from public.reporting_machines where id=m.machine_id for update;
 end loop;
 select lower(btrim(email)) into recipient from auth.users where id=j.user_id and deleted_at is null
   and (banned_until is null or banned_until<=statement_timestamp()) for share;
 if recipient is not null then projection:=private.email_alert_projection(j.user_id,j.category,j.observed_at,j.date_from,j.date_to,j.event_id);end if;
 if not(select delivery_enabled from private.email_alert_delivery_settings) or recipient is null
   or recipient is distinct from lower(btrim(p_recipient)) or j.route_fingerprint is distinct from p_route_fingerprint
   or not exists(select 1 from private.email_alert_selected_scope(j.user_id,j.category))
   or j.route_fingerprint is distinct from private.email_alert_route_fingerprint(j.user_id,j.category,projection)
   or j.projection_fingerprint is distinct from private.email_alert_hash(projection::text)
   or (j.category in ('sales-quiet','device-offline') and not exists(select 1 from private.email_alert_signals where id=j.event_id and valid_until>statement_timestamp())) then
  update private.email_alert_jobs set state='known_not_sent',error_code='stale_route_or_projection',updated_at=statement_timestamp() where id=j.id;
  if j.legacy_batch_id is not null then update public.refund_manager_digest_batches set status='known_not_sent',updated_at=statement_timestamp(),settled_at=statement_timestamp() where id=j.legacy_batch_id and provider_attempt_started_at is null;end if;
  return false;
 end if;
 update private.email_alert_jobs set state='delivery_unknown',provider_started_at=statement_timestamp(),updated_at=statement_timestamp() where id=j.id;
 if j.legacy_batch_id is not null then update public.refund_manager_digest_batches set status='delivery_unknown',provider_attempt_started_at=statement_timestamp(),updated_at=statement_timestamp() where id=j.legacy_batch_id;end if;
 return true;
end $$;
revoke all on function public.service_mark_email_alert_provider_started(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_mark_email_alert_provider_started(uuid,uuid,text,text) to service_role;

create function public.service_complete_email_alert(p_job_id uuid,p_claim_token uuid,p_outcome text,p_provider_id text default null,p_error_code text default null)
returns boolean language plpgsql volatile security definer set search_path='' as $$
declare j private.email_alert_jobs;
begin
 if p_outcome not in ('sent','known_not_sent','delivery_unknown') then raise exception 'Invalid outcome' using errcode='22023';end if;
 select * into j from private.email_alert_jobs where id=p_job_id for update;
 if j.id is null or j.claim_token is distinct from p_claim_token then return false;end if;
 if j.state='sent' then return p_outcome='sent';end if;
 if p_outcome='known_not_sent' and j.provider_started_at is not null then return false;end if;
 if p_outcome in ('sent','delivery_unknown') and j.provider_started_at is null then return false;end if;
 if p_outcome='sent' and nullif(btrim(p_provider_id),'') is null then raise exception 'Provider receipt required' using errcode='22023';end if;
 update private.email_alert_jobs set state=p_outcome,provider_id_digest=case when p_provider_id is not null then private.email_alert_hash(p_provider_id) end,
   error_code=case when p_error_code~'^[a-z0-9_:-]{1,80}$' then p_error_code else null end,updated_at=statement_timestamp() where id=j.id;
 if j.legacy_batch_id is not null then
  update public.refund_manager_digest_batches set status=p_outcome,provider_message_id_digest=case when p_provider_id is not null then private.email_alert_hash(p_provider_id) end,
    settled_at=statement_timestamp(),updated_at=statement_timestamp() where id=j.legacy_batch_id;
 end if;
 return true;
end $$;
revoke all on function public.service_complete_email_alert(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.service_complete_email_alert(uuid,uuid,text,text,text) to service_role;

-- Deploying schema does not seize delivery ownership. Explicit activation is
-- required after Edge secret/schedule/projection validation; rollback is one flag.
alter function public.service_begin_next_refund_manager_digest(timestamptz) rename to service_begin_refund_digest_pre_personal_alerts;
revoke all on function public.service_begin_refund_digest_pre_personal_alerts(timestamptz) from public,anon,authenticated,service_role;
create function public.service_begin_next_refund_manager_digest(p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if (select delivery_enabled from private.email_alert_delivery_settings) then
  return jsonb_build_object('claimed',false,'reason','personal_alert_sender_owns_daily','payloadRedacted',true);
 end if;
 return public.service_begin_refund_digest_pre_personal_alerts(p_observed_at);
end $$;
revoke all on function public.service_begin_next_refund_manager_digest(timestamptz) from public,anon,authenticated;
grant execute on function public.service_begin_next_refund_manager_digest(timestamptz) to service_role;

create function private.email_alert_ready_allowed(p_user_id uuid,p_machine_id uuid,p_observed_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select not(select delivery_enabled from private.email_alert_delivery_settings) or
 (exists(select 1 from private.email_alert_selected_scope(p_user_id,'decision-ready') s where s.machine_id=p_machine_id)
 and exists(select 1 from auth.users where id=p_user_id and deleted_at is null and (banned_until is null or banned_until<=p_observed_at))
 and not exists(select 1 from public.email_alert_profiles p where p.user_id=p_user_id and p.quiet_enabled and
   case when p.quiet_start<p.quiet_end then (p_observed_at at time zone p.timezone)::time>=p.quiet_start and (p_observed_at at time zone p.timezone)::time<p.quiet_end
   else (p_observed_at at time zone p.timezone)::time>=p.quiet_start or (p_observed_at at time zone p.timezone)::time<p.quiet_end end));
$$;
revoke all on function private.email_alert_ready_allowed(uuid,uuid,timestamptz) from public,anon,authenticated;
-- Preserve the mature ready-notice ledger and proof fingerprint, adding the
-- same personal opt-in and current-scope check at claim and provider boundary.
do $$ declare definition text; begin
 definition:=pg_get_functiondef('public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)'::regprocedure);
 if strpos(definition,'if case_row.id is null then continue; end if;')=0 then raise exception 'Ready claim boundary changed';end if;
 definition:=replace(definition,'if case_row.id is null then continue; end if;',
 'if case_row.id is null then continue; end if;
    if not private.email_alert_ready_allowed(action_row.ready_manager_user_id,case_row.reporting_machine_id,p_observed_at) then continue; end if;');
 execute definition;
 definition:=pg_get_functiondef('public.service_mark_refund_manager_ready_notice_provider_started(uuid,uuid,text,text)'::regprocedure);
 if strpos(definition,'snapshot_value')>0 then null;end if;
 -- The snapshot is the first point after both action and case have been loaded.
 if strpos(definition,'current_snapshot:=')=0 then raise exception 'Ready provider boundary changed';end if;
 definition:=replace(definition,'current_snapshot:=','if not private.email_alert_ready_allowed(action_row.ready_manager_user_id,case_row.reporting_machine_id,statement_timestamp()) then return false; end if;
  current_snapshot:=');
 execute definition;
end $$;
