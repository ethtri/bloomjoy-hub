-- #1946, owner decision 2026-10-15: required Manager work is not a personal
-- subscription. Reuse the ready outbox for one initial notice and one reminder
-- on the next business-day anniversary of its successful initial send.
create or replace function private.email_alert_current_ready_scope(p_observed_at timestamptz)
returns table(user_id uuid,machine_id uuid)
language sql stable security definer set search_path='' as $$
 select distinct m.manager_user_id,m.reporting_machine_id
 from public.reporting_machine_refund_managers m
 join auth.users u on u.id=m.manager_user_id and u.deleted_at is null
  and (u.banned_until is null or u.banned_until<=p_observed_at)
 join public.reporting_machines machine on machine.id=m.reporting_machine_id
 join public.reporting_locations location on location.id=machine.location_id
 where m.status='active' and m.revoked_at is null
  and not private.email_alert_in_quiet_hours(m.manager_user_id,p_observed_at);
$$;
revoke all on function private.email_alert_current_ready_scope(timestamptz)
 from public,anon,authenticated,service_role;

create or replace function private.email_alert_ready_allowed(
 p_user_id uuid,p_machine_id uuid,p_observed_at timestamptz
)
returns boolean language sql stable security definer set search_path='' as $$
 select (select activated_at is null from private.email_alert_delivery_settings) or
 ((select delivery_enabled from private.email_alert_delivery_settings)
  and exists(select 1 from public.reporting_machine_refund_managers m
   where m.manager_user_id=p_user_id and m.reporting_machine_id=p_machine_id
    and m.status='active' and m.revoked_at is null)
  and exists(select 1 from auth.users where id=p_user_id and deleted_at is null
   and (banned_until is null or banned_until<=p_observed_at))
  and not private.email_alert_in_quiet_hours(p_user_id,p_observed_at));
$$;
revoke all on function private.email_alert_ready_allowed(uuid,uuid,timestamptz)
 from public,anon,authenticated;

alter table public.refund_manager_notification_actions add column ready_notice_stage text
 not null default 'initial' check(ready_notice_stage in ('initial','reminder'));
alter table public.refund_manager_notification_actions add constraint refund_ready_stage_check
 check(ready_notice_stage='initial' or notice_reason='decision_ready');
drop index public.refund_manager_notification_ready_unique;
create unique index refund_manager_notification_ready_unique
 on public.refund_manager_notification_actions
 (refund_case_id,ready_manager_user_id,ready_decision_fingerprint,ready_notice_stage)
 where notice_reason='decision_ready';
alter table private.email_alert_delivery_settings add column ready_reminder_after_action_id uuid;

-- Delivery recovery is a distinct operational purpose, never another decision.
-- Canonical retry readiness excludes queued, unknown and complaint-review work.
alter function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
 rename to service_refund_ready_snapshot_pre_required_v1;
revoke all on function public.service_refund_ready_snapshot_pre_required_v1(uuid,uuid,timestamptz)
 from public,anon,authenticated,service_role;
create function public.service_refund_manager_ready_notice_snapshot(
 p_refund_case_id uuid,p_manager_user_id uuid,p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare c public.refund_cases; latest public.refund_case_messages; root_id uuid; context jsonb;
 machine_label text; location_label text; fingerprint text;
 original_claims text:=current_setting('request.jwt.claims',true);
 original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 select * into c from public.refund_cases where id=p_refund_case_id;
 if c.id is not null and (coalesce(c.case_population,'customer')<>'customer'
   or c.duplicate_of_refund_case_id is not null) then return null; end if;
 if c.resolution_method is distinct from 'gift_card' or c.gift_card_state is distinct from 'denied' then
  return public.service_refund_ready_snapshot_pre_required_v1(p_refund_case_id,p_manager_user_id,p_observed_at);
 end if;
 if c.case_population<>'customer' or c.duplicate_of_refund_case_id is not null
  or not exists(select 1 from auth.users where id=p_manager_user_id and deleted_at is null
    and (banned_until is null or banned_until<=p_observed_at))
  or not exists(select 1 from public.reporting_machine_refund_managers where reporting_machine_id=c.reporting_machine_id
    and manager_user_id=p_manager_user_id and status='active' and revoked_at is null)
  or private.refund_gift_denial_recovery(c.id)<>'ready' then return null; end if;
 perform set_config('request.jwt.claim.sub',p_manager_user_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_manager_user_id,'role','authenticated','is_anonymous',false)::text,true);
 context:=public.get_refund_gift_card_case(c.id);
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 if context->>'can_retry_denial' is distinct from 'true'
  or context->>'denial_delivery_recovery_state' is distinct from 'ready' then return null; end if;
 select * into latest from public.refund_case_messages m where m.refund_case_id=c.id
  and private.is_refund_gift_denial_notice(to_jsonb(m)) order by m.created_at desc,m.id desc limit 1;
 -- Let the existing bounded automatic pre-provider retries finish first.
 if latest.manual_delivery_provider_attempted_at is null and latest.delivery_transport is null
  and latest.manual_delivery_attempt_count<3 then return null; end if;
 select id into root_id from public.refund_case_messages where refund_case_id=c.id
  and manual_delivery_intent_id=md5('gift-card-denial:'||c.id::text)::uuid;
 if root_id is null or latest.id is null then return null; end if;
 fingerprint:=private.email_alert_hash(jsonb_build_array('gift_denial_delivery_recovery',
  c.reporting_machine_id,root_id,latest.id)::text);
 select private.reporting_machine_display_name(machine),location.name into machine_label,location_label
  from public.reporting_machines machine join public.reporting_locations location on location.id=c.reporting_location_id
  where machine.id=c.reporting_machine_id;
 return jsonb_build_object('schemaVersion','refund_manager_ready_notice_v2','caseId',c.id,
  'managerUserId',p_manager_user_id,'decisionFingerprint',fingerprint,'proofId',null,
  'officialActionVersion',c.official_action_version,'deterministicFactVersion',c.deterministic_fact_version,
  'actionCode','retry_customer_notice','recommendationKind',null,'recommendationReasonCode',null,
  'evidenceBasis','gift_denial_delivery_recovery',
  'preparationSummary','The decision is saved. Review the customer email and retry the saved notice.',
  'publicReference',c.public_reference,'amountCents',null,'currencyCode',null,
  'machineLabel',coalesce(nullif(btrim(machine_label),''),'Machine not recorded'),
  'locationName',coalesce(nullif(btrim(location_label),''),'Location not recorded'),'payloadRedacted',true);
exception when others then
 perform set_config('request.jwt.claims',coalesce(original_claims,''),true);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 raise;
end $$;
revoke all on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz)
 from public,anon,authenticated;
grant execute on function public.service_refund_manager_ready_notice_snapshot(uuid,uuid,timestamptz) to service_role;

alter table public.refund_manager_notification_actions
 drop constraint refund_manager_notification_ready_identity_check,
 add constraint refund_manager_notification_ready_identity_check check(
  (notice_reason<>'decision_ready' and ready_manager_user_id is null and ready_decision_fingerprint is null
   and ready_proof_id is null and ready_action_code is null and ready_official_action_version is null
   and ready_fact_version is null and ready_legacy_action_id is null and ready_evidence_basis is null)
  or (notice_reason='decision_ready' and ready_manager_user_id is not null and ready_decision_fingerprint ~ '^[a-f0-9]{64}$'
   and ((ready_evidence_basis is null and (ready_proof_id is not null
      or ready_action_code in ('send_cash_refund_and_confirm','reject_request')))
    or (coalesce(ready_evidence_basis='gift_card_manager_review',false) and ready_proof_id is null
      and ready_action_code='approve_or_deny_request')
    or (coalesce(ready_evidence_basis='gift_denial_delivery_recovery',false) and ready_proof_id is null
      and ready_action_code='retry_customer_notice'))
   and ready_action_code in ('approve_or_deny_request','reject_request','send_cash_refund_and_confirm','retry_customer_notice')
   and ready_official_action_version>=1 and ready_fact_version>=1 and channel='immediate' and urgency='actionable'));

-- Keep initial semantic identities, bounded rotating scans and proof checks.
-- Exclude historical/duplicate/internal cases before the existing five-case bound.
do $$ declare d text; old_fragment text; begin
 d:=pg_get_functiondef('public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)'::regprocedure);
 old_fragment:='and exists(select 1 from jsonb_array_elements(ready_scope) s where (s->>''machine_id'')::uuid=c.reporting_machine_id)';
 if strpos(d,old_fragment)=0 then raise exception 'Ready case admission changed'; end if;
 d:=replace(d,old_fragment,old_fragment||$patch$
       and coalesce(c.case_population,'customer')='customer'
       and c.duplicate_of_refund_case_id is null
       and ((c.resolution_method='gift_card' and (c.gift_card_state='manager_review'
           or (c.gift_card_state='denied' and private.refund_gift_denial_recovery(c.id)='ready')))
         or (c.resolution_method='original_payment' and c.status in
           ('submitted','needs_review','correlated','approved','card_refund_pending','cash_zelle_pending')))$patch$);
 old_fragment:='and action.ready_decision_fingerprint=snapshot_value->>''decisionFingerprint'';';
 if strpos(d,old_fragment)=0 then raise exception 'Initial ready identity changed'; end if;
 d:=replace(d,old_fragment,replace(old_fragment,';',E'\n        and action.ready_notice_stage=''initial'';'));
 old_fragment:='on conflict (refund_case_id,ready_manager_user_id,ready_decision_fingerprint)';
 if strpos(d,old_fragment)=0 then raise exception 'Ready uniqueness changed'; end if;
 d:=replace(d,old_fragment,'on conflict (refund_case_id,ready_manager_user_id,ready_decision_fingerprint,ready_notice_stage)');
 old_fragment:='case when snapshot_value->>''evidenceBasis''=''gift_card_manager_review'' then ''gift_card_manager_review'' end';
 if strpos(d,old_fragment)=0 then raise exception 'Ready evidence basis changed'; end if;
 d:=replace(d,old_fragment,'case when snapshot_value->>''evidenceBasis'' in (''gift_card_manager_review'',''gift_denial_delivery_recovery'') then snapshot_value->>''evidenceBasis'' end');
 d:=replace(d,'and old_action.notice_reason=''wallet_match_ready''',
  'and old_action.notice_reason=''wallet_match_ready'' and snapshot_value->>''evidenceBasis'' is distinct from ''gift_denial_delivery_recovery''');
 old_fragment:='recipient_value:=lower(btrim(mapping_row.manager_email));';
 if strpos(d,old_fragment)=0 then raise exception 'Ready enqueue recipient changed'; end if;
 d:=replace(d,old_fragment,$patch$recipient_value:=case when adopted then
        (select lower(btrim(email)) from auth.users where id=mapping_row.manager_user_id)
        else lower(btrim(mapping_row.manager_email)) end;$patch$);
 execute d;
end $$;

create function private.enqueue_refund_ready_reminders(p_refund_case_id uuid,p_observed_at timestamptz)
returns integer language plpgsql volatile security definer set search_path='' as $$
declare a public.refund_manager_notification_actions; snapshot_value jsonb;
 cursor_id uuid; next_cursor uuid; inserted_count integer:=0; existing_state text;
begin
 if not(select activated_at is not null and delivery_enabled
   from private.email_alert_delivery_settings where singleton) then return 0; end if;
 if not pg_try_advisory_xact_lock(hashtextextended('email_alert_ready_reminder_scan',0)) then return 0; end if;
 select ready_reminder_after_action_id into cursor_id from private.email_alert_delivery_settings where singleton;
 for a in select initial.* from public.refund_manager_notification_actions initial
  join public.refund_cases c on c.id=initial.refund_case_id
  left join public.email_alert_profiles profile on profile.user_id=initial.ready_manager_user_id
  where initial.notice_reason='decision_ready' and initial.ready_notice_stage='initial'
   and initial.delivery_state='sent' and initial.settled_at is not null
   and (p_refund_case_id is null or initial.refund_case_id=p_refund_case_id)
   and coalesce(c.case_population,'customer')='customer' and c.duplicate_of_refund_case_id is null
   and ((c.resolution_method='gift_card' and (c.gift_card_state='manager_review'
     or (c.gift_card_state='denied' and private.refund_gift_denial_recovery(c.id)='ready')))
    or (c.resolution_method='original_payment' and c.status in
      ('submitted','needs_review','correlated','approved','card_refund_pending','cash_zelle_pending')))
   and exists(select 1 from private.email_alert_current_ready_scope(p_observed_at) s
    where s.user_id=initial.ready_manager_user_id and s.machine_id=c.reporting_machine_id)
   and public.service_refund_business_days_elapsed(initial.settled_at,p_observed_at,
    coalesce(profile.timezone,'America/Los_Angeles'))>=1
   and not exists(select 1 from public.refund_manager_notification_actions other
    where other.notice_reason='decision_ready' and other.refund_case_id=initial.refund_case_id
     and other.ready_manager_user_id=initial.ready_manager_user_id
     and other.ready_decision_fingerprint=initial.ready_decision_fingerprint
     and (other.delivery_state in ('delivery_unknown','reserved')
      or (other.ready_notice_stage='reminder' and other.delivery_state in ('sent','ready_legacy_review'))))
  order by coalesce(initial.id>cursor_id,true) desc,initial.id limit 5
 loop
  next_cursor:=a.id;
  perform 1 from public.refund_cases where id=a.refund_case_id for update;
  snapshot_value:=public.service_refund_manager_ready_notice_snapshot(a.refund_case_id,a.ready_manager_user_id,p_observed_at);
  if snapshot_value is null or snapshot_value->>'decisionFingerprint' is distinct from a.ready_decision_fingerprint then continue; end if;
  select delivery_state into existing_state from public.refund_manager_notification_actions
   where notice_reason='decision_ready' and refund_case_id=a.refund_case_id
    and ready_manager_user_id=a.ready_manager_user_id and ready_decision_fingerprint=a.ready_decision_fingerprint
    and ready_notice_stage='reminder';
  insert into public.refund_manager_notification_actions(
   refund_case_id,attention_version,notice_reason,channel,urgency,delivery_state,
   ready_manager_user_id,ready_decision_fingerprint,ready_proof_id,ready_action_code,
   ready_official_action_version,ready_fact_version,ready_evidence_basis,ready_notice_stage)
  values(a.refund_case_id,a.attention_version,'decision_ready','immediate','actionable','ready_queued',
   a.ready_manager_user_id,a.ready_decision_fingerprint,(snapshot_value->>'proofId')::uuid,
   snapshot_value->>'actionCode',(snapshot_value->>'officialActionVersion')::bigint,
   (snapshot_value->>'deterministicFactVersion')::bigint,
   case when snapshot_value->>'evidenceBasis' in ('gift_card_manager_review','gift_denial_delivery_recovery')
    then snapshot_value->>'evidenceBasis' end,'reminder')
  on conflict (refund_case_id,ready_manager_user_id,ready_decision_fingerprint,ready_notice_stage)
   where notice_reason='decision_ready'
  do update set ready_proof_id=excluded.ready_proof_id,
   ready_action_code=excluded.ready_action_code,ready_official_action_version=excluded.ready_official_action_version,
   ready_fact_version=excluded.ready_fact_version,ready_evidence_basis=excluded.ready_evidence_basis,
   delivery_state=case when refund_manager_notification_actions.delivery_state='ready_obsolete'
    then 'ready_queued' else refund_manager_notification_actions.delivery_state end
  where refund_manager_notification_actions.provider_attempt_started_at is null
   and refund_manager_notification_actions.delivery_state in ('ready_queued','known_not_sent','ready_obsolete');
  if found and (existing_state is null or existing_state='ready_obsolete') then inserted_count:=inserted_count+1; end if;
 end loop;
 if next_cursor is not null and p_refund_case_id is null then
  update private.email_alert_delivery_settings set ready_reminder_after_action_id=next_cursor where singleton;
 end if;
 return inserted_count;
end $$;
revoke all on function private.enqueue_refund_ready_reminders(uuid,timestamptz)
 from public,anon,authenticated,service_role;

create function private.refund_ready_stage_allowed(p_action_id uuid,p_observed_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from public.refund_manager_notification_actions sibling
   where sibling.id<>a.id and sibling.notice_reason='decision_ready'
    and sibling.refund_case_id=a.refund_case_id and sibling.ready_manager_user_id=a.ready_manager_user_id
    and sibling.ready_decision_fingerprint=a.ready_decision_fingerprint
    and sibling.delivery_state in ('reserved','delivery_unknown'))
  and (a.ready_notice_stage='initial' or exists(
   select 1 from public.refund_manager_notification_actions initial
   left join public.email_alert_profiles profile on profile.user_id=initial.ready_manager_user_id
   where initial.notice_reason='decision_ready' and initial.ready_notice_stage='initial'
    and initial.refund_case_id=a.refund_case_id and initial.ready_manager_user_id=a.ready_manager_user_id
    and initial.ready_decision_fingerprint=a.ready_decision_fingerprint
    and initial.delivery_state='sent' and initial.settled_at is not null
    and public.service_refund_business_days_elapsed(initial.settled_at,p_observed_at,
     coalesce(profile.timezone,'America/Los_Angeles'))>=1))
 from public.refund_manager_notification_actions a where a.id=p_action_id and a.notice_reason='decision_ready';
$$;
revoke all on function private.refund_ready_stage_allowed(uuid,timestamptz) from public,anon,authenticated,service_role;

alter function public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz)
 rename to service_enqueue_refund_ready_initial_v1;
revoke all on function public.service_enqueue_refund_ready_initial_v1(uuid,timestamptz)
 from public,anon,authenticated,service_role;
create function public.service_enqueue_refund_manager_ready_notices(
 p_refund_case_id uuid default null,p_observed_at timestamptz default statement_timestamp())
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare initial_result jsonb; reminders integer;
begin
 initial_result:=public.service_enqueue_refund_ready_initial_v1(p_refund_case_id,p_observed_at);
 reminders:=private.enqueue_refund_ready_reminders(p_refund_case_id,p_observed_at);
 return initial_result||jsonb_build_object('queuedCount',(initial_result->>'queuedCount')::integer+reminders,
  'reminderCount',reminders);
end $$;
revoke all on function public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.service_enqueue_refund_manager_ready_notices(uuid,timestamptz) to service_role;

-- Stage is an additive claim property, leaving the strict financial snapshot
-- unchanged. Both stages use the same final authority/proof/quiet-hours check.
do $$ declare d text; anchor text; begin
 d:=pg_get_functiondef('public.service_claim_next_refund_manager_ready_notice(uuid,timestamptz)'::regprocedure);
 anchor:='''projection'',snapshot_value,''payloadRedacted'',true';
 if strpos(d,anchor)=0 then raise exception 'Ready claim response changed'; end if;
 d:=replace(d,anchor,'''projection'',snapshot_value,''noticeStage'',action_row.ready_notice_stage,''requiredRefundActionsVersion'',case when (select activated_at is not null from private.email_alert_delivery_settings where singleton) then 1 end,''payloadRedacted'',true');
 d:=replace(d,'and old_action.notice_reason=''wallet_match_ready''',
  'and old_action.notice_reason=''wallet_match_ready'' and action_row.ready_evidence_basis is distinct from ''gift_denial_delivery_recovery''');
 anchor:='    snapshot_value:=public.service_refund_manager_ready_notice_snapshot(';
 if strpos(d,anchor)=0 then raise exception 'Ready claim snapshot changed'; end if;
 execute replace(d,anchor,E'    if not private.refund_ready_stage_allowed(action_row.id,p_observed_at) then continue; end if;\n'||anchor);
 d:=pg_get_functiondef('public.service_mark_refund_manager_ready_notice_provider_started(uuid,uuid,text,text)'::regprocedure);
 anchor:='  current_snapshot:=';
 if strpos(d,anchor)=0 then raise exception 'Ready provider snapshot changed'; end if;
 execute replace(d,anchor,E'  if not private.refund_ready_stage_allowed(action_row.id,statement_timestamp()) then return false; end if;\n'||anchor);
 -- This sender replaces legacy digest-only reminders and same-recipient day-five
 -- pings. Other operational incident and routing-exception controls are intact.
 d:=pg_get_functiondef('public.service_list_due_refund_manager_aging_notices(timestamptz,text,integer,integer,text,integer)'::regprocedure);
 anchor:=E'begin\r\n';
 if strpos(d,anchor)=0 then anchor:=E'begin\n'; end if;
 if strpos(d,anchor)=0 then raise exception 'Legacy aging entry changed'; end if;
 execute overlay(d placing anchor||E'  if (select activated_at is not null from private.email_alert_delivery_settings where singleton) then return; end if;\n'
  from strpos(d,anchor) for length(anchor));
 d:=pg_get_functiondef('public.service_mark_refund_manager_notification_provider_started(uuid,uuid)'::regprocedure);
 anchor:='  if action_row.notice_reason=''wallet_match_ready'' then';
 if strpos(d,anchor)=0 then raise exception 'Legacy notice provider boundary changed'; end if;
 execute replace(d,anchor,$patch$  if action_row.notice_reason in ('manager_reminder','manager_escalation')
    and (select activated_at is not null from private.email_alert_delivery_settings where singleton) then return false; end if;
$patch$||anchor);
 -- Old clients may still submit the retained category. Ignore that field rather
 -- than mutate a former opt-out or let it control operational responsibility.
 d:=pg_get_functiondef('public.save_my_email_alert_preferences(jsonb,integer)'::regprocedure);
 anchor:='  for alert in select * from jsonb_array_elements(p_preferences->''alerts'') loop';
 if strpos(d,anchor)=0 then raise exception 'Preference category loop changed'; end if;
 execute replace(d,anchor,anchor||E'\n    if alert->>''id''=''decision-ready'' and (select activated_at is not null from private.email_alert_delivery_settings where singleton) then continue; end if;');
end $$;

-- Getter and save share this response. New UI keeps legacy enrollment until
-- this exact backend policy exists and the personal sender owns delivery.
do $$ declare d text; anchor text:='  return result;'; begin
 d:=pg_get_functiondef('private.email_alert_context(uuid)'::regprocedure);
 if strpos(d,anchor)=0 then raise exception 'Preference response changed'; end if;
 execute replace(d,anchor,$patch$  return result||jsonb_build_object('requiredRefundActionsVersion',
   case when (select activated_at is not null from private.email_alert_delivery_settings where singleton) then 1 end);$patch$);
end $$;

select pg_notify('pgrst','reload schema');
