-- Customer-initiated recovery reuses the delivered request, not another email
-- or follow-up cycle. Keep every original response and its receipt immutable.
alter table public.refund_wallet_correction_contexts
  add column correction_renewed_from_id uuid unique
    references public.refund_wallet_correction_contexts(id) on delete restrict;
drop index public.refund_correction_message_unique;
create unique index refund_correction_message_unique
  on public.refund_wallet_correction_contexts(correction_message_id)
  where correction_message_id is not null and correction_renewed_from_id is null;

create function public.refund_purchase_correction_can_renew(p_request_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1 from public.refund_wallet_correction_contexts r
    join public.refund_cases c on c.id=r.refund_case_id
    join public.refund_case_messages m on m.id=r.correction_message_id
    where r.id=p_request_id and r.correction_kind='purchase'
      and (r.status in ('submitted','expired') or (r.status='pending' and r.expires_at<=statement_timestamp()))
      and public.refund_purchase_correction_eligible(c)
      and c.deterministic_fact_version=case when r.status='submitted'
        then r.correction_resulting_fact_version else r.correction_fact_version end
      and m.refund_case_id=c.id and m.recipient_email=c.customer_email
      and m.status='sent' and m.sent_at is not null
      and m.delivery_state in ('accepted','delivered')
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m))
      -- A newer question owns its own delivered capability. Old links cannot
      -- bypass a manager replacement, queued transport, or revoked scope.
      and not exists(select 1 from public.refund_wallet_correction_contexts newer
        where newer.refund_case_id=c.id and newer.correction_message_id is distinct from r.correction_message_id
          and (newer.issued_at>r.issued_at or newer.version>r.version))
      and not exists(select 1 from public.refund_purchase_correction_revisions revision
        where revision.old_request_id=r.id)
      and not exists(select 1 from public.refund_case_messages pending
        where pending.refund_case_id=c.id and (pending.status='pending'
          or pending.manual_delivery_state in ('queued','claimed','delivery_unknown')))
      and not exists(select 1 from public.refund_follow_up_cycles cycle
        where cycle.refund_case_id=c.id and (cycle.status='claimed'
          or (cycle.reminder_claimed_at is not null and cycle.reminder_sent_at is null and cycle.status='waiting')))
      and not exists(select 1 from public.refund_payout_destination_follow_ups payout
        where payout.refund_case_id=c.id and payout.status='reminder_claimed')
  ),false);
$$;
revoke all on function public.refund_purchase_correction_can_renew(uuid)
  from public,anon,authenticated,service_role;

alter function public.service_get_refund_purchase_correction(text)
  rename to service_get_refund_purchase_correction_pre_renewal_v1;
revoke all on function public.service_get_refund_purchase_correction_pre_renewal_v1(text)
  from public,anon,authenticated,service_role;
create function public.service_get_refund_purchase_correction(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; r public.refund_wallet_correction_contexts; c public.refund_cases;
begin
  result:=public.service_get_refund_purchase_correction_pre_renewal_v1(p_token_hash);
  select * into r from public.refund_wallet_correction_contexts where token_hash=p_token_hash and correction_kind='purchase';
  if r.id is not null and public.refund_purchase_correction_can_renew(r.id) then
    select * into c from public.refund_cases where id=r.refund_case_id;
    result:=result||jsonb_build_object('canRenew',true,'publicReference',c.public_reference,
      'locale',case when c.intake_meta->>'customer_locale'='es' then 'es' else 'en' end);
  end if;
  return result;
end;
$$;
revoke all on function public.service_get_refund_purchase_correction(text) from public,anon,authenticated;
grant execute on function public.service_get_refund_purchase_correction(text) to service_role;

create function public.service_renew_refund_purchase_correction(p_token_hash text,p_renewed_token_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts; child public.refund_wallet_correction_contexts;
  fields text[];
begin
  -- Same parent-first locking order as the retained issuer and atomic submit.
  select c0.* into c from public.refund_cases c0
    join public.refund_wallet_correction_contexts r0 on r0.refund_case_id=c0.id
    where r0.token_hash=p_token_hash and r0.correction_kind='purchase' for update of c0;
  select * into r from public.refund_wallet_correction_contexts
    where token_hash=p_token_hash and correction_kind='purchase' for update;
  if r.id is null or not public.refund_purchase_correction_can_renew(r.id)
    or coalesce(p_renewed_token_hash,'') !~ '^[a-f0-9]{64}$'
    or p_renewed_token_hash=p_token_hash then return jsonb_build_object('state','unavailable'); end if;
  select * into child from public.refund_wallet_correction_contexts where correction_renewed_from_id=r.id;
  if child.id is not null then
    if child.token_hash is distinct from p_renewed_token_hash then return jsonb_build_object('state','unavailable'); end if;
    return public.service_get_refund_purchase_correction(child.token_hash);
  end if;
  if exists(select 1 from public.refund_wallet_correction_contexts other
    where other.refund_case_id=c.id and other.status='pending' and other.id<>r.id) then
    return jsonb_build_object('state','unavailable');
  end if;
  fields:=public.refund_purchase_correction_request_fields(c.id);
  if r.correction_requested_fields=array['zelle_payment_contact']::text[] then
    -- This delivered capability never expands into purchase edits, especially
    -- on the protected historical approved-cash destination path.
    fields:=array['zelle_payment_contact']::text[];
  end if;
  if r.status='pending' then
    update public.refund_wallet_correction_contexts set status='expired',updated_at=statement_timestamp() where id=r.id;
  end if;
  insert into public.refund_wallet_correction_contexts(refund_case_id,token_hash,version,expires_at,
    correction_kind,correction_message_id,correction_fact_version,correction_requested_fields,
    correction_snapshot,correction_renewed_from_id)
  values(c.id,p_renewed_token_hash,r.version,statement_timestamp()+interval '48 hours',
    'purchase',r.correction_message_id,c.deterministic_fact_version,fields,
    public.refund_purchase_correction_values(c),r.id) returning * into child;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values(c.id,'purchase_correction_access_renewed','Customer opened a fresh same-case update; prior answers remain saved.',
    jsonb_build_object('request_id',child.id,'previous_request_id',r.id,'fact_version',c.deterministic_fact_version,
      'requested_fields',fields,'payload_redacted',true));
  return public.service_get_refund_purchase_correction(child.token_hash);
end;
$$;
revoke all on function public.service_renew_refund_purchase_correction(text,text) from public,anon,authenticated;
grant execute on function public.service_renew_refund_purchase_correction(text,text) to service_role;

-- Existing message retry selects the original issuance, never a recovery child.
-- A customer clicking Update does not spend an unsolicited contact or reopen
-- the initial-question/reminder budget. Preserve the entire revision wrapper.
do $migration$
declare source text;
begin
  source:=pg_get_functiondef('public.service_issue_refund_purchase_correction_pre_revision(uuid,text,bigint)'::regprocedure);
  if strpos(source,'where correction_message_id=m.id;')=0
    or strpos(source,'where ctx.refund_case_id=c.id and not exists(')=0 then
    raise exception 'Correction issuance recovery anchors changed';
  end if;
  source:=replace(source,'where correction_message_id=m.id;',
    'where correction_message_id=m.id and correction_renewed_from_id is null;');
  source:=replace(source,'where ctx.refund_case_id=c.id and not exists(',
    'where ctx.refund_case_id=c.id and ctx.correction_renewed_from_id is null and not exists(');
  execute source;
  source:=pg_get_functiondef('public.refund_correction_revision_reason(uuid,uuid,uuid)'::regprocedure);
  if strpos(source,'where ctx.refund_case_id=c.id and not exists(')=0 then
    raise exception 'Correction contact count anchor changed';
  end if;
  source:=replace(source,'where ctx.refund_case_id=c.id and not exists(',
    'where ctx.refund_case_id=c.id and ctx.correction_renewed_from_id is null and not exists(');
  execute source;
end;
$migration$;

-- Optional customer review is not a changed matching fact. Do not erase a valid
-- prepared purchase merely because the customer confirmed one saved answer.
-- Patch the current writer in place, preserving its approved-cash composition.
do $migration$
declare source text; anchor text;
begin
  source:=replace(pg_get_functiondef('public.service_submit_refund_purchase_correction(text,bigint,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:='  if jsonb_typeof(p_answers) is distinct from ''object'' then raise exception ''Requested answers required''; end if;';
  if strpos(source,anchor)=0 then raise exception 'Correction response shape anchor changed'; end if;
  source:=replace(source,anchor,anchor||E'\n  if r.correction_renewed_from_id is not null and p_answers=''{}''::jsonb then raise exception ''Requested answers required''; end if;');
  anchor:=E'  update public.refund_cases set\n    reporting_machine_id=next_case.reporting_machine_id';
  if strpos(source,anchor)=0 then raise exception 'Correction purchase write anchor changed'; end if;
  source:=replace(source,anchor,E'  if r.correction_renewed_from_id is null or cardinality(changed_fields)>0 then\n'||anchor);
  anchor:='  delete from public.refund_nayax_lookup_candidates where refund_case_id=c.id;';
  if strpos(source,anchor)=0 then raise exception 'Correction candidate invalidation anchor changed'; end if;
  source:=replace(source,anchor,anchor||E'\n  end if;');
  execute source;
end;
$migration$;
select pg_notify('pgrst','reload schema');
