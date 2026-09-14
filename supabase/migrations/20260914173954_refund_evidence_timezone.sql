-- Keep provider evidence time independent from the case worker's browser.
-- The existing eight-argument routine remains an internal implementation only;
-- authenticated callers must use the timezone-explicit wrapper below.

alter table public.refund_nayax_system_success_evidence
  add column if not exists source_timezone text
    check(source_timezone is null or source_timezone~'^[A-Za-z0-9_+./-]{1,80}$');
alter table public.refund_nayax_no_refund_proofs
  add column if not exists source_timezone text
    check(source_timezone is null or source_timezone~'^[A-Za-z0-9_+./-]{1,80}$');

comment on column public.refund_nayax_system_success_evidence.source_timezone is
  'IANA timezone printed by the provider source for evidence_occurred_at; null only for evidence predating this column.';
comment on column public.refund_nayax_no_refund_proofs.source_timezone is
  'IANA timezone printed by the provider source for evidence_occurred_at; null only for evidence predating this column.';

create or replace function public.stamp_refund_nayax_evidence_timezone_v1()
returns trigger language plpgsql set search_path='' as $$
declare source_timezone text:=nullif(pg_catalog.current_setting(
  'bloomjoy.refund_evidence_source_timezone',true),'');
begin
  if source_timezone is null or not exists(
    select 1 from pg_catalog.pg_timezone_names zone where zone.name=source_timezone
  ) then
    raise exception 'A valid provider evidence timezone is required' using errcode='P4661';
  end if;
  new.source_timezone:=source_timezone;
  return new;
end;
$$;
revoke all on function public.stamp_refund_nayax_evidence_timezone_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists refund_nayax_system_success_evidence_timezone_v1
  on public.refund_nayax_system_success_evidence;
create trigger refund_nayax_system_success_evidence_timezone_v1
before insert on public.refund_nayax_system_success_evidence for each row
execute function public.stamp_refund_nayax_evidence_timezone_v1();

drop trigger if exists refund_nayax_no_refund_proof_timezone_v1
  on public.refund_nayax_no_refund_proofs;
create trigger refund_nayax_no_refund_proof_timezone_v1
before insert on public.refund_nayax_no_refund_proofs for each row
execute function public.stamp_refund_nayax_evidence_timezone_v1();

create or replace function public.stamp_refund_nayax_event_timezone_v1()
returns trigger language plpgsql set search_path='' as $$
declare source_timezone text:=nullif(pg_catalog.current_setting(
  'bloomjoy.refund_evidence_source_timezone',true),'');
begin
  if new.event_type in (
      'nayax_system_outcome_evidence_recorded',
      'nayax_no_refund_evidence_requeued',
      'nayax_support_resolution_completed'
    ) then
    if source_timezone is null or not exists(
      select 1 from pg_catalog.pg_timezone_names zone where zone.name=source_timezone
    ) then
      raise exception 'A valid provider evidence timezone is required' using errcode='P4661';
    end if;
    new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
      'evidence_source_timezone',source_timezone
    );
  end if;
  return new;
end;
$$;
revoke all on function public.stamp_refund_nayax_event_timezone_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists refund_nayax_event_timezone_v1 on public.refund_case_events;
create trigger refund_nayax_event_timezone_v1
before insert on public.refund_case_events for each row
execute function public.stamp_refund_nayax_event_timezone_v1();

alter function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) rename to internal_record_refund_nayax_system_outcome_evidence_v1;
revoke all on function public.internal_record_refund_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,bigint
) from public,anon,authenticated,service_role;

create or replace function public.admin_record_nayax_system_outcome_evidence_v1(
  p_case_id uuid,p_attempt_id uuid,p_resolution_result text,p_evidence_type text,
  p_evidence_reference text,p_evidence_occurred_at timestamptz,
  p_evidence_source_timezone text,p_reason_code text,p_expected_case_version bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare source_timezone text:=btrim(coalesce(p_evidence_source_timezone,''));
  result jsonb; stored_timezone text;
begin
  if source_timezone='' or not exists(
    select 1 from pg_catalog.pg_timezone_names zone where zone.name=source_timezone
  ) then
    raise exception 'Choose the timezone shown by Nayax' using errcode='P4661';
  end if;
  perform pg_catalog.set_config(
    'bloomjoy.refund_evidence_source_timezone',source_timezone,true
  );
  result:=public.internal_record_refund_nayax_system_outcome_evidence_v1(
    p_case_id,p_attempt_id,p_resolution_result,p_evidence_type,
    p_evidence_reference,p_evidence_occurred_at,p_reason_code,p_expected_case_version
  );
  if result->>'result'='provider_confirmed_success' then
    select evidence.source_timezone into stored_timezone
    from public.refund_nayax_system_success_evidence evidence
    where evidence.refund_case_id=p_case_id
      and evidence.nayax_refund_attempt_id=p_attempt_id;
    if stored_timezone is distinct from source_timezone then
      raise exception 'The saved provider evidence uses a different timezone'
        using errcode='P4661';
    end if;
  end if;
  return result||jsonb_build_object('evidenceSourceTimezone',source_timezone);
end;
$$;
revoke all on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,text,bigint
) from public,anon,service_role;
grant execute on function public.admin_record_nayax_system_outcome_evidence_v1(
  uuid,uuid,text,text,text,timestamptz,text,text,bigint
) to authenticated;
