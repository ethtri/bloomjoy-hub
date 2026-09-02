-- #628: recording an observed, fully refunded original is not inventing its
-- settlement time, a payment attempt, an accounting period, or a customer send.
-- These receipts remain separate from the dated completion/adjustment contract.
create table public.refund_authoritative_receipts (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id),
  nayax_refund_attempt_id uuid unique references public.refund_case_nayax_refund_attempts(id),
  reporting_machine_id uuid not null references public.reporting_machines(id),
  account_scope text not null check (length(account_scope) between 1 and 100),
  provider_machine_id text not null check (length(provider_machine_id) between 1 and 120),
  original_transaction_id text not null check (length(original_transaction_id) between 1 and 120),
  original_amount_cents integer not null check (original_amount_cents > 0),
  refunded_amount_cents integer not null,
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  provider_status integer not null check (provider_status = 62),
  evidence_reference_digest text not null unique check (evidence_reference_digest ~ '^[a-f0-9]{64}$'),
  settlement_time_precision text not null default 'unknown' check (settlement_time_precision = 'unknown'),
  settled_at timestamptz check (settled_at is null),
  observed_at timestamptz not null default statement_timestamp(),
  recorded_by uuid not null references auth.users(id),
  attempt_binding_kind text not null check (attempt_binding_kind in ('modern_authorized_manual','legacy_manual_portal_observation','no_attempt_integrity_hold')),
  historical_provenance_event_id uuid references public.refund_case_events(id),
  current_provider_observation_reviewed boolean not null,
  evidence_policy text not null default 'ops_exact_full_refund_v1'
    check (evidence_policy = 'ops_exact_full_refund_v1'),
  check (refunded_amount_cents = original_amount_cents),
  check ((attempt_binding_kind='legacy_manual_portal_observation') = (historical_provenance_event_id is not null)),
  check (attempt_binding_kind<>'legacy_manual_portal_observation' or current_provider_observation_reviewed),
  unique (account_scope, original_transaction_id)
);

create table public.refund_completion_notice_adoptions (
  receipt_id uuid primary key references public.refund_authoritative_receipts(id),
  refund_case_id uuid not null unique references public.refund_cases(id),
  gmail_message_id uuid not null unique references public.refund_gmail_messages(id),
  gmail_thread_id uuid not null references public.refund_gmail_threads(id),
  -- Snapshot digests preserve the reviewed evidence without copying its content,
  -- identities, or CC list into audit metadata or the public projection.
  message_evidence_digest text not null check (message_evidence_digest ~ '^[a-f0-9]{64}$'),
  provider_message_digest text not null unique check (provider_message_digest ~ '^[a-f0-9]{64}$'),
  sent_at timestamptz not null,
  manager_cc_verified boolean not null,
  reviewed_by uuid not null references auth.users(id),
  reviewed_at timestamptz not null default statement_timestamp(),
  review_policy text not null default 'ops_exact_case_completion_notice_v1'
    check (review_policy = 'ops_exact_case_completion_notice_v1')
);

alter table public.refund_authoritative_receipts enable row level security;
alter table public.refund_completion_notice_adoptions enable row level security;
revoke all on public.refund_authoritative_receipts,
  public.refund_completion_notice_adoptions from public, anon, authenticated, service_role;
create index refund_authoritative_receipts_machine_idx on public.refund_authoritative_receipts(reporting_machine_id);
create index refund_authoritative_receipts_actor_idx on public.refund_authoritative_receipts(recorded_by);
create index refund_authoritative_receipts_provenance_idx on public.refund_authoritative_receipts(historical_provenance_event_id);
create index refund_completion_notice_adoptions_thread_idx on public.refund_completion_notice_adoptions(gmail_thread_id);
create index refund_completion_notice_adoptions_actor_idx on public.refund_completion_notice_adoptions(reviewed_by);

create function public.refund_receipt_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Authoritative receipts and notice evidence are immutable' using errcode = 'P4660';
end;
$$;
revoke all on function public.refund_receipt_immutable() from public, anon, authenticated, service_role;
create trigger refund_authoritative_receipts_immutable before update or delete
  on public.refund_authoritative_receipts for each row execute function public.refund_receipt_immutable();
create trigger refund_completion_notice_adoptions_immutable before update or delete
  on public.refund_completion_notice_adoptions for each row execute function public.refund_receipt_immutable();

create function public.assert_refund_receipt_operator(p_case_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare session_id_text text := auth.jwt() ->> 'session_id';
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null
    or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
    or not public.is_super_admin(auth.uid())
    or session_id_text is null
    or session_id_text !~ '^[0-9a-fA-F-]{36}$' then
    raise exception 'Current Refund Operations session required' using errcode = '42501';
  end if;
  perform 1 from auth.sessions s where s.id=session_id_text::uuid and s.user_id=auth.uid()
    and (s.not_after is null or s.not_after > statement_timestamp()) for share;
  if not found then
    raise exception 'Current mapped Refund Operations session required' using errcode = '42501';
  end if;
  perform 1 from public.refund_cases c
    join public.reporting_machine_refund_managers m on m.reporting_machine_id = c.reporting_machine_id
    where c.id = p_case_id and m.manager_user_id = auth.uid()
      and m.status = 'active' and m.revoked_at is null for share of m;
  if not found then
    raise exception 'Current mapped Refund Operations session required' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.assert_refund_receipt_operator(uuid) from public, anon, authenticated, service_role;

-- Recognize only the documented historical batch. This proves a historical
-- case/original/amount link, NOT historical account approval or provider success.
-- Current account/machine observation is independently attested in the receipt.
create function public.refund_receipt_legacy_provenance(p_case_id uuid,p_attempt_id uuid)
returns uuid language sql stable security definer set search_path='' as $$
  select event.id from public.refund_cases c
    join public.reporting_machines m on m.id=c.reporting_machine_id
    join public.refund_case_nayax_refund_attempts a on a.refund_case_id=c.id and a.id=p_attempt_id
    join public.refund_case_events event on event.refund_case_id=c.id
      and event.event_type='manual_nayax_refund_reconciliation_created'
      and event.actor_user_id=a.actor_user_id and event.metadata->>'attempt_id'=a.id::text
    where c.id=p_case_id and m.nayax_manual_portal_enabled is false
      and nullif(m.nayax_account_key,'') is not null and nullif(m.nayax_machine_id,'') is not null
      and a.official_action_authorization_id is null and a.actor_user_id is not null
      and a.execution_mode='manual_portal' and a.status='manual_review' and a.provider_outcome='unknown'
      and a.provider_status='request_accepted' and a.reconciliation_required is true
      and a.safe_transport_stage='confirmation_hold' and a.safe_failure_class='provider_unknown'
      and a.provider_reference=c.matched_nayax_transaction_id
      and a.amount_cents=c.matched_nayax_amount_cents and a.amount_cents=c.refund_amount_cents
      and a.currency_code='USD' and c.matched_nayax_currency_code='USD'
      and a.idempotency_key='manual-nayax-portal-20260901-'||c.public_reference
      and a.request_fingerprint=encode(extensions.digest(convert_to(
        c.id::text||'|'||c.matched_nayax_transaction_id||'|'||a.amount_cents::text,'UTF8'),'sha256'),'hex')
      and a.created_at>='2026-09-01 00:00:00+00'::timestamptz and a.created_at<'2026-09-02 00:00:00+00'::timestamptz
      and event.created_at>=a.created_at and event.created_at<=a.created_at+interval '1 minute'
      and event.metadata->>'provider_outcome'='unknown'
      and event.metadata->'provider_call_made'='true'::jsonb
      and event.metadata->'settlement_confirmation_required'='true'::jsonb
    order by event.created_at,event.id limit 1;
$$;
revoke all on function public.refund_receipt_legacy_provenance(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_record_refund_authoritative_receipt(
  p_case_id uuid, p_attempt_id uuid, p_expected_case_version bigint,
  p_account_scope text, p_provider_machine_id text, p_original_transaction_id text,
  p_original_amount_cents integer, p_refunded_amount_cents integer,
  p_currency_code text, p_provider_status integer, p_evidence_reference text,
  p_reviewed_current_provider_observation boolean default false
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.refund_cases%rowtype;
  a public.refund_case_nayax_refund_attempts%rowtype;
  m public.reporting_machines%rowtype;
  e public.refund_manual_nayax_evidence%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  scope_value text;
  machine_value text;
  reference_digest text;
  legacy_event_id uuid;
  binding_kind text:='modern_authorized_manual';
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Current Refund Operations session required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id = p_case_id for update;
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into m from public.reporting_machines where id = c.reporting_machine_id for share;
  select * into e from public.refund_manual_nayax_evidence
    where refund_case_id = c.id and selected_at is not null for share;
  scope_value := case when m.nayax_manual_portal_enabled then e.account_scope else m.nayax_account_key end;
  machine_value := case when m.nayax_manual_portal_enabled then e.portal_machine_reference else m.nayax_machine_id end;
  if c.id is null or c.case_population <> 'customer' or c.payment_method <> 'card'
    or c.duplicate_of_refund_case_id is not null
    or c.correlation_status is distinct from 'matched' or c.correlation_source is distinct from 'nayax'
    or nullif(scope_value, '') is null or nullif(machine_value, '') is null
    or p_account_scope is distinct from scope_value
    or p_provider_machine_id is distinct from machine_value
    or (m.nayax_manual_portal_enabled and (e.account_scope is distinct from m.nayax_manual_account_scope
      or e.provider_transaction_id is distinct from c.matched_nayax_transaction_id
      or e.amount_cents is distinct from c.matched_nayax_amount_cents
      or e.currency_code is distinct from c.matched_nayax_currency_code))
    or nullif(c.matched_nayax_transaction_id, '') is null
    or p_original_transaction_id is distinct from c.matched_nayax_transaction_id
    or p_original_amount_cents is distinct from c.matched_nayax_amount_cents
    or p_original_amount_cents is distinct from c.refund_amount_cents
    or p_refunded_amount_cents is distinct from p_original_amount_cents
    or p_original_amount_cents is null or p_original_amount_cents <= 0
    or p_currency_code is distinct from c.matched_nayax_currency_code
    or p_currency_code is null or p_currency_code !~ '^[A-Z]{3}$'
    or p_provider_status is distinct from 62
    or not public.refund_nayax_resolution_reference_is_safe(p_evidence_reference, 'nayax_dtm_transaction')
    or p_evidence_reference is distinct from 'DTM:NAYAX-' || p_original_transaction_id then
    raise exception 'Exact original, account, machine, full amount and authoritative Refunded evidence required' using errcode = 'P4661';
  end if;
  reference_digest := public.refund_nayax_resolution_reference_digest(scope_value||'|'||p_evidence_reference);
  select * into r from public.refund_authoritative_receipts where refund_case_id = c.id;
  if r.id is not null then
    if r.nayax_refund_attempt_id is distinct from p_attempt_id
      or r.evidence_reference_digest is distinct from reference_digest then
      raise exception 'Receipt replay conflicts with recorded evidence' using errcode = 'P4661';
    end if;
    return jsonb_build_object('schemaVersion', 'refund_authoritative_receipt_v1',
      'receiptId', r.id, 'status', 'already_recorded', 'settlementTimePrecision', 'unknown',
      'paymentConfirmed', true, 'accountingPending', true, 'customerMessageSent', false, 'payloadRedacted', true);
  end if;
  if c.official_action_version is distinct from p_expected_case_version
    or c.status <> 'card_refund_pending' or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null then
    raise exception 'Current unresolved case required; reload before recording evidence' using errcode = 'P4661';
  end if;
  if exists(select 1 from public.refund_case_messages msg where msg.refund_case_id=c.id
      and (msg.status='pending' or msg.manual_delivery_state in ('queued','claimed','delivery_unknown')
        or (msg.delivery_transport='resend' and msg.delivery_state='unknown')))
    or exists(select 1 from public.refund_gmail_messages msg where msg.refund_case_id=c.id
      and msg.direction='outbound' and msg.status in ('pending_send','delivery_unknown')) then
    raise exception 'Reconcile the existing in-flight customer delivery before recording this receipt' using errcode='P4661';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(scope_value||'|'||p_original_transaction_id,4661));
  if exists(select 1 from public.refund_nayax_outcome_resolutions resolution
      where resolution.resolution_result='provider_confirmed_success'
        and resolution.evidence_reference_digest=public.refund_nayax_resolution_reference_digest(p_evidence_reference))
    or exists(select 1 from public.refund_cases other_case
      join public.reporting_machines other_machine on other_machine.id=other_case.reporting_machine_id
      join public.refund_case_nayax_refund_attempts other_attempt on other_attempt.refund_case_id=other_case.id
      where other_case.id<>c.id and other_case.matched_nayax_transaction_id=p_original_transaction_id
        and (case when other_machine.nayax_manual_portal_enabled then other_machine.nayax_manual_account_scope
          else other_machine.nayax_account_key end)=scope_value
        and (other_attempt.status in ('succeeded','in_progress','requested','approved','manual_review','ambiguous')
          or other_attempt.reconciliation_required)) then
    raise exception 'Conflicting exact-original evidence must be reconciled before recording this receipt' using errcode='P4661';
  end if;
  select * into a from public.refund_case_nayax_refund_attempts
    where refund_case_id = c.id order by created_at desc, id desc limit 1 for update;
  legacy_event_id:=public.refund_receipt_legacy_provenance(c.id,a.id);
  if p_attempt_id is null then
    if a.id is not null or c.lifecycle_integrity_status is distinct from 'hold'
      or c.lifecycle_integrity_code is distinct from 'card_payment_state_without_attempt' then
      raise exception 'A missing attempt requires the explicit legacy integrity hold' using errcode = 'P4661';
    end if;
    binding_kind:='no_attempt_integrity_hold';
  elsif a.id is distinct from p_attempt_id or a.amount_cents is distinct from p_original_amount_cents
    or a.currency_code is distinct from p_currency_code
    or a.status not in ('manual_review', 'ambiguous', 'failed', 'declined')
    or coalesce(a.provider_outcome,'') not in ('unknown', 'timeout', 'rejected')
    or a.support_resolution_id is not null or a.reporting_adjustment_id is not null
    or a.case_finalization_committed_at is not null then
    raise exception 'Exact latest unresolved attempt required' using errcode = 'P4661';
  elsif legacy_event_id is not null then
    if p_reviewed_current_provider_observation is distinct from true then
      raise exception 'Separately review the current provider account, machine and exact full refund' using errcode='P4661';
    end if;
    binding_kind:='legacy_manual_portal_observation';
  elsif
    -- Modern authorization validation remains unchanged. A legacy receipt is a
    -- separate observation and never backfills an approval into the old attempt.
    a.execution_mode is distinct from 'manual_portal'
    or a.idempotency_key is distinct from 'manual-nayax-' || encode(extensions.digest(
      convert_to(c.id::text||'|'||upper(btrim(scope_value))||'|'||p_original_transaction_id,'UTF8'),'sha256'),'hex')
    or a.official_action_authorization_id is null
    or a.request_fingerprint is distinct from encode(extensions.digest(convert_to(
      a.official_action_authorization_id::text||'|'||a.idempotency_key||'|'||p_currency_code||'|'||p_original_amount_cents::text,
      'UTF8'),'sha256'),'hex')
    or not exists(select 1 from public.refund_case_official_action_authorizations authz
      join public.reporting_machine_refund_managers mapping on mapping.id=authz.manager_mapping_id
      where authz.id=a.official_action_authorization_id and authz.refund_case_id=c.id
        and authz.action='approve' and authz.status='consumed'
        and mapping.reporting_machine_id=c.reporting_machine_id)
    then
    raise exception 'Exact latest unresolved attempt required' using errcode = 'P4661';
  end if;
  -- Case lock serializes receipt/old resolver. No mutation of the old attempt,
  -- successful-resolution journal, completion time, or reporting ledger occurs.
  insert into public.refund_authoritative_receipts (
    refund_case_id, nayax_refund_attempt_id, reporting_machine_id, account_scope,
    provider_machine_id, original_transaction_id, original_amount_cents,
    refunded_amount_cents, currency_code, provider_status, evidence_reference_digest, recorded_by,
    attempt_binding_kind,historical_provenance_event_id,current_provider_observation_reviewed
  ) values (c.id, a.id, m.id, scope_value, machine_value, p_original_transaction_id,
    p_original_amount_cents, p_refunded_amount_cents, p_currency_code, p_provider_status,
    reference_digest, auth.uid(),binding_kind,legacy_event_id,coalesce(p_reviewed_current_provider_observation,false)) returning * into r;
  insert into public.refund_case_events(refund_case_id, actor_user_id, event_type, message, metadata)
  values(c.id, auth.uid(), 'authoritative_refund_receipt_recorded',
    'Authoritative full-refund evidence recorded. Settlement time remains unknown; no payment, dated adjustment or customer message was created.',
    jsonb_build_object('schema_version','refund_authoritative_receipt_v1','settlement_time_precision','unknown',
      'payment_confirmed',true,'accounting_pending',true,'attempt_present',a.id is not null,
      'attempt_binding_kind',binding_kind,'current_provider_observation_reviewed',r.current_provider_observation_reviewed,'payload_redacted',true));
  update public.refund_cases set lifecycle_revision = lifecycle_revision + 1,
    updated_at = statement_timestamp() where id = c.id;
  return jsonb_build_object('schemaVersion', 'refund_authoritative_receipt_v1',
    'receiptId', r.id, 'status', 'recorded', 'settlementTimePrecision', 'unknown',
    'paymentConfirmed', true, 'accountingPending', true, 'customerMessageSent', false, 'payloadRedacted', true);
end;
$$;
revoke all on function public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_record_refund_authoritative_receipt(uuid,uuid,bigint,text,text,text,integer,integer,text,integer,text,boolean) to authenticated;

create function public.refund_receipt_notice_matches_case(p_case_id uuid,p_message_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_gmail_messages g
    join public.refund_gmail_threads t on t.id=g.gmail_thread_id
    join public.refund_cases target on target.id=p_case_id
    join public.refund_cases primary_case on primary_case.id=t.refund_case_id
    where g.id=p_message_id and g.refund_case_id=t.refund_case_id
      and lower(btrim(g.recipient_email))=lower(btrim(target.customer_email))
      and lower(btrim(primary_case.customer_email))=lower(btrim(target.customer_email))
      and (t.refund_case_id=target.id or exists(
        select 1 from public.refund_gmail_contact_case_associations association
        join public.refund_gmail_case_link_reviews review on review.id=association.review_id
        join public.refund_gmail_intake_contacts contact on contact.id=association.contact_id
        where association.refund_case_id=target.id and association.relationship='related'
          and review.contact_id=contact.id and review.status='resolved'
          and review.primary_refund_case_id=t.refund_case_id and review.resolved_by is not null
          and review.resolved_at is not null and contact.status='linked'
          and contact.linked_refund_case_id=t.refund_case_id
          and contact.mailbox_hash=t.mailbox_hash and contact.provider_thread_id=t.provider_thread_id
          and lower(btrim(contact.customer_email))=lower(btrim(target.customer_email))
      )));
$$;
revoke all on function public.refund_receipt_notice_matches_case(uuid,uuid) from public,anon,authenticated,service_role;

create function public.admin_adopt_refund_completion_notice(
  p_case_id uuid, p_receipt_id uuid, p_gmail_message_id uuid,
  p_expected_case_version bigint, p_completion_case_reference text,
  p_completion_original_transaction_id text, p_completion_amount_cents integer,
  p_reviewed_full_refund_notice boolean
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.refund_cases%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  g public.refund_gmail_messages%rowtype;
  t public.refund_gmail_threads%rowtype;
  prior public.refund_completion_notice_adoptions%rowtype;
  cc_verified boolean;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Current Refund Operations session required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into r from public.refund_authoritative_receipts where id=p_receipt_id and refund_case_id=c.id for share;
  if r.id is null or p_completion_case_reference is distinct from c.public_reference
    or p_completion_original_transaction_id is distinct from r.original_transaction_id
    or p_completion_amount_cents is distinct from r.refunded_amount_cents
    or p_reviewed_full_refund_notice is distinct from true then
    raise exception 'Review the completion notice for this exact case and original transaction' using errcode='P4662';
  end if;
  select * into prior from public.refund_completion_notice_adoptions where receipt_id=r.id;
  if prior.receipt_id is not null then
    if prior.gmail_message_id is distinct from p_gmail_message_id then
      raise exception 'A different completion notice is already recorded' using errcode='P4662';
    end if;
    return jsonb_build_object('status','already_adopted','customerMessageSent',false,'payloadRedacted',true);
  end if;
  if c.official_action_version is distinct from p_expected_case_version then
    raise exception 'Case changed; review the exact notice again' using errcode='P4662';
  end if;
  select * into g from public.refund_gmail_messages where id=p_gmail_message_id for share;
  select * into t from public.refund_gmail_threads where id=g.gmail_thread_id for share;
  if g.id is null or not public.refund_receipt_notice_matches_case(c.id,g.id)
    or g.direction <> 'outbound' or g.message_kind <> 'message' or g.status <> 'sent'
    or g.sent_at is null or g.sent_at > statement_timestamp()+interval '30 seconds'
    or nullif(g.provider_message_id,'') is null or nullif(t.provider_thread_id,'') is null
    or lower(btrim(g.sender_email)) is distinct from 'info@bloomjoysweets.com'
    or lower(btrim(g.recipient_email)) is distinct from lower(btrim(c.customer_email))
    or nullif(btrim(g.plain_body),'') is null or g.content_deleted_at is not null then
    raise exception 'Verified sent original-thread evidence for this exact case is required' using errcode='P4662';
  end if;
  -- A reviewed notice may distinguish one completed claim from another pending
  -- claim in the same thread. Never infer completion for every case in a thread.
  select exists(select 1 from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=c.reporting_machine_id and m.status='active' and m.revoked_at is null)
    and not exists(select 1 from public.reporting_machine_refund_managers m
      where m.reporting_machine_id=c.reporting_machine_id and m.status='active' and m.revoked_at is null
        and not (lower(m.manager_email)=any(coalesce(g.recipient_cc_emails,'{}'::text[]))))
    into cc_verified;
  insert into public.refund_completion_notice_adoptions(
    receipt_id,refund_case_id,gmail_message_id,gmail_thread_id,message_evidence_digest,
    provider_message_digest,sent_at,manager_cc_verified,reviewed_by
  ) values(r.id,c.id,g.id,t.id,
    encode(extensions.digest(convert_to(jsonb_build_array(g.provider_message_id,t.provider_thread_id,
      g.sender_email,g.recipient_email,g.recipient_cc_emails,g.subject,g.plain_body,g.sent_at)::text,'UTF8'),'sha256'),'hex'),
    encode(extensions.digest(convert_to(t.mailbox_hash||'|'||g.provider_message_id,'UTF8'),'sha256'),'hex'),
    g.sent_at,cc_verified,auth.uid());
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,auth.uid(),'existing_completion_notice_adopted',
    'Reviewed existing sent completion notice linked to this exact claim. No customer email was sent or rewritten.',
    jsonb_build_object('review_policy','ops_exact_case_completion_notice_v1','manager_cc_verified',cc_verified,
      'customer_message_sent',false,'payload_redacted',true));
  update public.refund_cases set lifecycle_revision=lifecycle_revision+1,updated_at=statement_timestamp() where id=c.id;
  return jsonb_build_object('status','adopted','managerCcVerified',cc_verified,'customerMessageSent',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_adopt_refund_completion_notice(uuid,uuid,uuid,bigint,text,text,integer,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_adopt_refund_completion_notice(uuid,uuid,uuid,bigint,text,text,integer,boolean) to authenticated;

-- Central storage guards close old resolver, payment, dated reporting and send
-- paths. This slice deliberately does not implement an accounting-date policy.
create function public.guard_refund_authoritative_receipt_effects()
returns trigger language plpgsql security definer set search_path='' as $$
declare case_id uuid;
begin
  if tg_table_name='refund_cases' then case_id:=new.id; else case_id:=new.refund_case_id; end if;
  if not exists(select 1 from public.refund_authoritative_receipts where refund_case_id=case_id) then return new; end if;
  if tg_table_name='refund_cases' then
    if row(new.status,new.decision,new.refund_completed_at,new.reporting_adjustment_id,
      new.reporting_machine_id,new.matched_nayax_transaction_id,new.matched_nayax_amount_cents,
      new.matched_nayax_currency_code,new.refund_amount_cents,new.nayax_refund_attempt_generation,
      new.nayax_refund_execution_status,new.case_population,new.nayax_match_execution_eligible,
      new.customer_email,new.matched_nayax_site_id,new.matched_nayax_machine_auth_time,new.correlation_source)
      is not distinct from row(old.status,old.decision,old.refund_completed_at,old.reporting_adjustment_id,
      old.reporting_machine_id,old.matched_nayax_transaction_id,old.matched_nayax_amount_cents,
      old.matched_nayax_currency_code,old.refund_amount_cents,old.nayax_refund_attempt_generation,
      old.nayax_refund_execution_status,old.case_population,old.nayax_match_execution_eligible,
      old.customer_email,old.matched_nayax_site_id,old.matched_nayax_machine_auth_time,old.correlation_source) then return new; end if;
  elsif tg_table_name='refund_case_messages' then
    if new.message_type='manual_note' then return new; end if;
    if tg_op='UPDATE' and new.status is distinct from 'pending'
      and new.manual_delivery_state is distinct from 'claimed'
      and new.manual_delivery_state is distinct from 'queued' then return new; end if;
  end if;
  raise exception 'Confirmed refund receipt requires accounting review; no payment, dated completion or customer resend is allowed' using errcode='P4663';
end;
$$;
revoke all on function public.guard_refund_authoritative_receipt_effects() from public,anon,authenticated,service_role;
create trigger aa_refund_receipt_case_effect_guard before update on public.refund_cases
  for each row execute function public.guard_refund_authoritative_receipt_effects();
create trigger aa_refund_receipt_attempt_effect_guard before insert or update on public.refund_case_nayax_refund_attempts
  for each row execute function public.guard_refund_authoritative_receipt_effects();
create trigger aa_refund_receipt_adjustment_effect_guard before insert or update on public.sales_adjustment_facts
  for each row execute function public.guard_refund_authoritative_receipt_effects();
create trigger aa_refund_receipt_message_effect_guard before insert or update on public.refund_case_messages
  for each row execute function public.guard_refund_authoritative_receipt_effects();

create function public.guard_refund_receipt_exact_original()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; scope_value text;
begin
  select * into c from public.refund_cases where id=new.refund_case_id;
  select case when m.nayax_manual_portal_enabled then m.nayax_manual_account_scope else m.nayax_account_key end
    into scope_value from public.reporting_machines m where m.id=c.reporting_machine_id;
  if scope_value is not null and c.matched_nayax_transaction_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(scope_value||'|'||c.matched_nayax_transaction_id,4661));
    if exists(select 1 from public.refund_authoritative_receipts r
      where r.account_scope=scope_value and r.original_transaction_id=c.matched_nayax_transaction_id) then
      raise exception 'This exact original already has authoritative full-refund evidence; payment is not retryable' using errcode='P4663';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_receipt_exact_original() from public,anon,authenticated,service_role;
create trigger refund_receipt_exact_original_guard before insert on public.refund_case_nayax_refund_attempts
  for each row execute function public.guard_refund_receipt_exact_original();

alter function public.can_perform_refund_official_action(uuid,uuid) rename to can_perform_refund_official_action_pre_receipt_v1;
revoke all on function public.can_perform_refund_official_action_pre_receipt_v1(uuid,uuid) from public,anon,authenticated,service_role;
create function public.can_perform_refund_official_action(p_user_id uuid,p_refund_case_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id)
    and public.can_perform_refund_official_action_pre_receipt_v1(p_user_id,p_refund_case_id);
$$;
revoke all on function public.can_perform_refund_official_action(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.can_perform_refund_official_action(uuid,uuid) to service_role;

-- Claims serialize on the case before any provider access. Existing imported
-- SENT rows remain ingestible; a claimed/uncertain send prevents receipt entry.
alter function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  rename to service_claim_refund_gmail_outbound_pre_receipt_v1;
revoke all on function public.service_claim_refund_gmail_outbound_pre_receipt_v1(uuid,uuid,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated,service_role;
create function public.service_claim_refund_gmail_outbound_v3(
  p_refund_case_id uuid,p_refund_case_message_id uuid,p_operation_key text,p_sender_email text,
  p_recipient_email text,p_plain_body text,p_mailbox_identities text[],p_delivery_kind text,p_target_gmail_thread_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.refund_cases where id=p_refund_case_id for update;
  if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id) then
    raise exception 'Authoritative receipt forbids customer resend; adopt existing sent evidence' using errcode='P4663';
  end if;
  return public.service_claim_refund_gmail_outbound_pre_receipt_v1(p_refund_case_id,p_refund_case_message_id,
    p_operation_key,p_sender_email,p_recipient_email,p_plain_body,p_mailbox_identities,p_delivery_kind,p_target_gmail_thread_id);
end;
$$;
revoke all on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid) to service_role;

alter function public.service_mark_refund_transactional_delivery_attempt(uuid)
  rename to service_mark_refund_delivery_pre_receipt_v1;
revoke all on function public.service_mark_refund_delivery_pre_receipt_v1(uuid)
  from public,anon,authenticated,service_role;
create function public.service_mark_refund_transactional_delivery_attempt(p_refund_case_message_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare case_id uuid;
begin
  select refund_case_id into case_id from public.refund_case_messages where id=p_refund_case_message_id;
  perform 1 from public.refund_cases where id=case_id for update;
  if exists(select 1 from public.refund_authoritative_receipts where refund_case_id=case_id) then
    raise exception 'Authoritative receipt forbids customer resend; adopt existing sent evidence' using errcode='P4663';
  end if;
  return public.service_mark_refund_delivery_pre_receipt_v1(p_refund_case_message_id);
end;
$$;
revoke all on function public.service_mark_refund_transactional_delivery_attempt(uuid) from public,anon,authenticated,service_role;
grant execute on function public.service_mark_refund_transactional_delivery_attempt(uuid) to service_role;

alter function public.refund_lifecycle_contract(uuid) rename to refund_lifecycle_contract_pre_authoritative_receipt_v1;
revoke all on function public.refund_lifecycle_contract_pre_authoritative_receipt_v1(uuid) from public,anon,authenticated,service_role;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb;
  r public.refund_authoritative_receipts%rowtype;
  n public.refund_completion_notice_adoptions%rowtype;
begin
  base:=public.refund_lifecycle_contract_pre_authoritative_receipt_v1(p_refund_case_id);
  select * into r from public.refund_authoritative_receipts where refund_case_id=p_refund_case_id;
  if r.id is null then return base; end if;
  select * into n from public.refund_completion_notice_adoptions where receipt_id=r.id;
  return base || jsonb_build_object(
    'stage',case when n.receipt_id is null then 'refund_confirmed' else 'customer_notified' end,
    'stageRank',case when n.receipt_id is null then 70 else 80 end,'reasonCode','settlement_time_unknown',
    'paymentState','confirmed','evidenceState','provider_confirmed_time_unknown',
    'publicCopyKey','refund_confirmed_bank_pending','terminal',false,'refreshAfterSeconds',5,
    'safeRetryEligible',false,'definitiveNoRefund',false,'managerNextAction','review_accounting_date',
    'customerAction',jsonb_build_object('action','none','required',false,'requestedFields','[]'::jsonb,'payloadRedacted',true),
    'managerAction',jsonb_build_object('action','review_accounting_date','owner','Refund Operations','safeRetryEligible',false,'payloadRedacted',true),
    'messageState',jsonb_build_object('state',case when n.receipt_id is null then 'none' else 'sent' end,
      'messageType',case when n.receipt_id is null then null else 'completed' end,
      'lastUpdatedAt',n.sent_at,'payloadRedacted',true),
    'lookup',(base->'lookup')||jsonb_build_object('safeRetryEligible',false),
    'operations',jsonb_build_object('required',true,'queue','Refund Operations','owner','Refund Operations',
      'slaMinutes',60,'ageMinutes',greatest(0,floor(extract(epoch from(statement_timestamp()-r.observed_at))/60)::integer),
      'dueAt',r.observed_at+interval '60 minutes','slaBreached',r.observed_at+interval '60 minutes'<=statement_timestamp(),
      'safeStage','payment_confirmed_accounting_pending','failureClass','settlement_time_unknown',
      'nextStep','Refund confirmed. Resolve the accounting date internally; do not retry payment or resend the customer notice.'),
    'managerQueue',jsonb_build_object('schemaVersion','refund_manager_queue_v2','bucket','provider_hold',
      'label','Refund confirmed · accounting review','nextAction','review_accounting_date','safeRetryEligible',false,
      'customerActionFields','[]'::jsonb,'payloadRedacted',true));
end;
$$;
revoke all on function public.refund_lifecycle_contract(uuid) from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

comment on table public.refund_authoritative_receipts is
  'Private append-only observations of an exact original fully refunded by Nayax; observed_at is never a settlement timestamp. No dated accounting or payment effects.';
comment on table public.refund_completion_notice_adoptions is
  'Private exact-case, human-reviewed adoption of pre-existing provider SENT evidence. Does not rewrite mail, fabricate CC, or send anything.';

-- Narrow authenticated reader: no raw Gmail provider IDs, digest or customer
-- address is returned. Actual plain-text notice content is visible only to the
-- current mapped operator who must review it before exact-case adoption.
create function public.admin_get_refund_authoritative_receipt_overview(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  m public.reporting_machines%rowtype;
  e public.refund_manual_nayax_evidence%rowtype;
  a public.refund_case_nayax_refund_attempts%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  n public.refund_completion_notice_adoptions%rowtype;
  choices jsonb:='[]'::jsonb;
  eligible boolean;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Current Refund Operations session required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for share;
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into r from public.refund_authoritative_receipts where refund_case_id=c.id;
  if c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card' or c.correlation_status is distinct from 'matched'
    or c.correlation_source is distinct from 'nayax' or c.duplicate_of_refund_case_id is not null then
    return jsonb_build_object('schemaVersion','refund_receipt_overview_v1','visible',false);
  end if;
  select * into m from public.reporting_machines where id=c.reporting_machine_id;
  select * into e from public.refund_manual_nayax_evidence where refund_case_id=c.id and selected_at is not null;
  select * into a from public.refund_case_nayax_refund_attempts where refund_case_id=c.id
    order by created_at desc,id desc limit 1;
  select * into n from public.refund_completion_notice_adoptions where receipt_id=r.id;
  eligible:=c.status='card_refund_pending' and c.refund_completed_at is null and c.reporting_adjustment_id is null
    and ((a.id is null and c.lifecycle_integrity_status='hold' and c.lifecycle_integrity_code='card_payment_state_without_attempt')
      or (a.id is not null and a.execution_mode='manual_portal' and a.status in ('manual_review','ambiguous','failed','declined')
        and a.provider_outcome in ('unknown','timeout','rejected') and a.support_resolution_id is null));
  if r.id is not null and n.receipt_id is null then
    select coalesce(jsonb_agg(choice order by sent_at desc,id),'[]'::jsonb) into choices from (
      select g.id,g.sent_at,jsonb_build_object('id',g.id,'sentAt',g.sent_at,
        'subject',g.subject,'plainBody',g.plain_body) choice
      from public.refund_gmail_messages g join public.refund_gmail_threads t on t.id=g.gmail_thread_id
      where public.refund_receipt_notice_matches_case(c.id,g.id) and g.direction='outbound'
        and g.message_kind='message' and g.status='sent' and g.sent_at is not null
        and g.sent_at<=statement_timestamp()+interval '30 seconds'
        and nullif(g.provider_message_id,'') is not null and nullif(t.provider_thread_id,'') is not null
        and lower(btrim(g.sender_email))='info@bloomjoysweets.com'
        and lower(btrim(g.recipient_email))=lower(btrim(c.customer_email))
        and nullif(btrim(g.plain_body),'') is not null and g.content_deleted_at is null
        and not exists(select 1 from public.refund_completion_notice_adoptions adopted where adopted.gmail_message_id=g.id)
      order by g.sent_at desc,g.id limit 20
    ) messages;
  end if;
  return jsonb_build_object('schemaVersion','refund_receipt_overview_v1','visible',r.id is not null or coalesce(eligible,false),
    'caseId',c.id,'caseReference',c.public_reference,'expectedCaseVersion',c.official_action_version,
    'canRecord',r.id is null and coalesce(eligible,false),'attemptId',a.id,
    'attemptBindingKind',coalesce(r.attempt_binding_kind,case when a.id is null then 'no_attempt_integrity_hold'
      when public.refund_receipt_legacy_provenance(c.id,a.id) is not null then 'legacy_manual_portal_observation'
      when a.official_action_authorization_id is not null then 'modern_authorized_manual' else 'unverified_attempt' end),
    'accountScope',coalesce(r.account_scope,case when m.nayax_manual_portal_enabled then e.account_scope else m.nayax_account_key end),
    'providerMachineId',coalesce(r.provider_machine_id,case when m.nayax_manual_portal_enabled then e.portal_machine_reference else m.nayax_machine_id end),
    'originalTransactionId',coalesce(r.original_transaction_id,c.matched_nayax_transaction_id),
    'originalAmountCents',coalesce(r.original_amount_cents,c.matched_nayax_amount_cents),
    'currencyCode',coalesce(r.currency_code,c.matched_nayax_currency_code),
    'receipt',case when r.id is null then null else jsonb_build_object('id',r.id,'observedAt',r.observed_at,
      'settlementTimePrecision','unknown','noticeAdopted',n.receipt_id is not null,
      'noticeSentAt',n.sent_at,'managerCcVerified',n.manager_cc_verified) end,
    'noticeChoices',choices);
end;
$$;
revoke all on function public.admin_get_refund_authoritative_receipt_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_authoritative_receipt_overview(uuid) to authenticated;
