-- #1715: dedicated Vault-backed clock. Configuring it is inert by default.
alter table private.email_alert_delivery_settings add column last_dispatched_at timestamptz,
 add column last_request_id bigint;

create function private.dispatch_machine_email_alerts()
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare endpoint text;secret_value text;endpoint_count integer;secret_count integer;request_id bigint;
begin
 perform 1 from private.email_alert_delivery_settings where singleton for update;
 if not(select delivery_enabled from private.email_alert_delivery_settings) then
  return jsonb_build_object('dispatched',false,'reason','delivery_disabled','payloadRedacted',true);end if;
 select count(*),max(decrypted_secret) into endpoint_count,endpoint from vault.decrypted_secrets where name='email_alert_scheduler_url';
 select count(*),max(decrypted_secret) into secret_count,secret_value from vault.decrypted_secrets where name='email_alert_scheduler_secret';
 if endpoint_count<>1 or secret_count<>1 or endpoint!~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/email-alert-dispatch$'
  or secret_value!~'^[A-Za-z0-9_-]{32,255}$' then
  return jsonb_build_object('dispatched',false,'reason','configuration_unavailable','payloadRedacted',true);end if;
 request_id:=net.http_post(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||secret_value,'Content-Type','application/json'),
  body:='{}'::jsonb,timeout_milliseconds:=60000);
 update private.email_alert_delivery_settings set last_dispatched_at=statement_timestamp(),last_request_id=request_id where singleton;
 return jsonb_build_object('dispatched',true,'requestRecorded',request_id is not null,'payloadRedacted',true);
exception when others then
 return jsonb_build_object('dispatched',false,'reason','dispatch_unavailable','payloadRedacted',true);
end $$;
revoke all on function private.dispatch_machine_email_alerts() from public,anon,authenticated,service_role;

create function public.service_set_email_alert_delivery_enabled(p_enabled boolean)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare endpoint text;secret_value text;endpoint_count integer;secret_count integer;job_id bigint;
begin
 if p_enabled is null then raise exception 'An explicit enabled value is required' using errcode='22023';end if;
 perform 1 from private.email_alert_delivery_settings where singleton for update;
 select jobid into job_id from cron.job where jobname='email-alert-dispatch-v1';
 if p_enabled then
  select count(*),max(decrypted_secret) into endpoint_count,endpoint from vault.decrypted_secrets where name='email_alert_scheduler_url';
  select count(*),max(decrypted_secret) into secret_count,secret_value from vault.decrypted_secrets where name='email_alert_scheduler_secret';
  if endpoint_count<>1 or secret_count<>1 or endpoint!~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/email-alert-dispatch$'
    or secret_value!~'^[A-Za-z0-9_-]{32,255}$' or job_id is null or not exists(select 1 from cron.job
      where jobid=job_id and schedule='*/5 * * * *' and command='select private.dispatch_machine_email_alerts();') then
   raise exception 'Configure the dedicated email scheduler before activation' using errcode='22023';end if;
 end if;
 if job_id is not null then perform cron.alter_job(job_id,active:=p_enabled);end if;
 update private.email_alert_delivery_settings set delivery_enabled=p_enabled,
  activated_at=case when p_enabled then coalesce(activated_at,statement_timestamp()) else activated_at end where singleton;
 return public.service_email_alert_delivery_status();
end $$;
revoke all on function public.service_set_email_alert_delivery_enabled(boolean) from public,anon,authenticated;
grant execute on function public.service_set_email_alert_delivery_enabled(boolean) to service_role;

create function public.service_configure_email_alert_scheduler(p_url text,p_secret text,p_enabled boolean default false)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare url_id uuid;secret_id uuid;job_id bigint;existing_project_endpoint text;
begin
 if p_url is null or p_url!~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/email-alert-dispatch$'
  or p_secret is null or p_secret!~'^[A-Za-z0-9_-]{32,255}$' or p_enabled is null then
  raise exception 'A canonical email endpoint and dedicated strong secret are required' using errcode='22023';end if;
 select max(decrypted_secret) into existing_project_endpoint from vault.decrypted_secrets where name='refund_automation_scheduler_url';
 if existing_project_endpoint~'^https://[a-z0-9]{20}\.supabase\.co/functions/v1/'
  and split_part(existing_project_endpoint,'/',3)<>split_part(p_url,'/',3) then
  raise exception 'Email scheduler must use the configured Supabase project' using errcode='22023';end if;
 perform 1 from private.email_alert_delivery_settings where singleton for update;
 if (select count(*) from vault.secrets where name='email_alert_scheduler_url')>1 or
    (select count(*) from vault.secrets where name='email_alert_scheduler_secret')>1 then
  raise exception 'Duplicate dedicated scheduler configuration requires reconciliation' using errcode='22023';end if;
 select id into url_id from vault.secrets where name='email_alert_scheduler_url';
 select id into secret_id from vault.secrets where name='email_alert_scheduler_secret';
 if url_id is null then perform vault.create_secret(p_url,'email_alert_scheduler_url','Machine email alert dispatcher endpoint');
 else perform vault.update_secret(url_id,p_url);end if;
 if secret_id is null then perform vault.create_secret(p_secret,'email_alert_scheduler_secret','Dedicated email alert scheduler authorization');
 else perform vault.update_secret(secret_id,p_secret);end if;
 job_id:=cron.schedule('email-alert-dispatch-v1','*/5 * * * *','select private.dispatch_machine_email_alerts();');
 perform cron.alter_job(job_id,active:=false);
 return public.service_set_email_alert_delivery_enabled(p_enabled)||jsonb_build_object('configured',true,'schedule','Every 5 minutes');
end $$;
revoke all on function public.service_configure_email_alert_scheduler(text,text,boolean) from public,anon,authenticated;
grant execute on function public.service_configure_email_alert_scheduler(text,text,boolean) to service_role;

-- A legacy batch reserved just before cutover cannot cross the provider boundary
-- afterwards. Generic delivery uses its own current-scope provider-start RPC.
alter function public.service_mark_refund_manager_digest_provider_started(uuid,uuid,text,text)
 rename to service_mark_refund_digest_pre_personal_alerts;
revoke all on function public.service_mark_refund_digest_pre_personal_alerts(uuid,uuid,text,text) from public,anon,authenticated,service_role;
create function public.service_mark_refund_manager_digest_provider_started(p_batch_id uuid,p_claim_token uuid,p_mapping_fingerprint text,p_recipient text)
returns boolean language plpgsql volatile security definer set search_path='' as $$
begin
 if (select activated_at is not null from private.email_alert_delivery_settings) then return false;end if;
 return public.service_mark_refund_digest_pre_personal_alerts(p_batch_id,p_claim_token,p_mapping_fingerprint,p_recipient);
end $$;
revoke all on function public.service_mark_refund_manager_digest_provider_started(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.service_mark_refund_manager_digest_provider_started(uuid,uuid,text,text) to service_role;

-- Once adopted, the dedicated delivery flag controls the optional ready lane.
-- Its existing outbox and proof identities continue to prevent duplicate mail.
do $$ declare definition text;begin
 definition:=pg_get_functiondef('public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)'::regprocedure);
 definition:=replace(definition,'if not (select delivery_enabled from public.refund_manager_ready_notice_settings
      where singleton) then',
  'if not (case when (select activated_at is not null from private.email_alert_delivery_settings)
    then (select delivery_enabled from private.email_alert_delivery_settings)
    else (select delivery_enabled from public.refund_manager_ready_notice_settings where singleton) end) then');
 definition:=replace(definition,'recipient_value:=lower(btrim(mapping_row.manager_email));',
  'recipient_value:=case when (select activated_at is not null from private.email_alert_delivery_settings)
    then (select lower(btrim(email)) from auth.users where id=mapping_row.manager_user_id and deleted_at is null and (banned_until is null or banned_until<=p_observed_at))
    else lower(btrim(mapping_row.manager_email)) end;');
 execute definition;
 definition:=pg_get_functiondef('public.service_mark_refund_manager_ready_notice_provider_started(uuid,uuid,text,text)'::regprocedure);
 definition:=replace(definition,'recipient_value:=lower(btrim(mapping_row.manager_email));',
  'recipient_value:=case when (select activated_at is not null from private.email_alert_delivery_settings)
    then (select lower(btrim(email)) from auth.users where id=mapping_row.manager_user_id and deleted_at is null and (banned_until is null or banned_until<=statement_timestamp()))
    else lower(btrim(mapping_row.manager_email)) end;');
 execute definition;
 definition:=pg_get_functiondef('public.service_get_refund_manager_ready_notice_health()'::regprocedure);
 definition:=replace(definition,'''deliveryEnabled'',(select delivery_enabled from public.refund_manager_ready_notice_settings
      where singleton)',
  '''deliveryEnabled'',(case when (select activated_at is not null from private.email_alert_delivery_settings)
    then (select delivery_enabled from private.email_alert_delivery_settings)
    else (select delivery_enabled from public.refund_manager_ready_notice_settings where singleton) end)');
 execute definition;
end $$;

select pg_notify('pgrst','reload schema');
