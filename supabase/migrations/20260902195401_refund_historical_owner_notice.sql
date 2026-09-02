-- Historical evidence only. This is not another sender, Gmail ingestion path,
-- provider-delivery verification, payment action, or accounting finalization.
create table public.refund_external_notice_observations (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null unique references public.refund_authoritative_receipts(id),
  refund_case_id uuid not null unique references public.refund_cases(id),
  source_kind text not null default 'historical_owner_mailbox' check(source_kind='historical_owner_mailbox'),
  verification text not null default 'operator_observed_gmail_sent' check(verification='operator_observed_gmail_sent'),
  sender_email text not null check(length(sender_email) between 3 and 320),
  recipient_email text not null check(length(recipient_email) between 3 and 320),
  mailbox_hash text not null check(mailbox_hash ~ '^[a-f0-9]{64}$'),
  provider_message_id text not null check(provider_message_id ~ '^[a-f0-9]{8,64}$'),
  provider_thread_id text not null check(provider_thread_id ~ '^[a-f0-9]{8,64}$'),
  provider_message_digest text not null unique check(provider_message_digest ~ '^[a-f0-9]{64}$'),
  reviewed_message_digest text not null check(reviewed_message_digest ~ '^[a-f0-9]{64}$'),
  evidence_reference text not null check(evidence_reference='GMAIL-SENT:'||provider_message_id),
  evidence_snapshot_digest text not null check(evidence_snapshot_digest ~ '^[a-f0-9]{64}$'),
  sent_at timestamptz not null check(isfinite(sent_at) and sent_at<='2026-09-02T19:51:58Z'::timestamptz),
  observed_at timestamptz not null default statement_timestamp(),
  observed_by uuid not null references auth.users(id),
  customer_only_no_cc_reviewed boolean not null check(customer_only_no_cc_reviewed),
  exact_case_amount_reviewed boolean not null check(exact_case_amount_reviewed),
  owned_mailbox_sent_reviewed boolean not null check(owned_mailbox_sent_reviewed),
  manager_cc_verified boolean not null default false check(manager_cc_verified is false),
  support_thread boolean not null default false check(support_thread is false),
  delivery_verification text not null default 'unknown' check(delivery_verification='unknown'),
  unique(id,receipt_id,refund_case_id)
);
alter table public.refund_external_notice_observations enable row level security;
revoke all on public.refund_external_notice_observations from public,anon,authenticated,service_role;
create index refund_external_notice_observations_actor_idx on public.refund_external_notice_observations(observed_by);
create trigger refund_external_notice_observations_immutable before update or delete
  on public.refund_external_notice_observations for each row execute function public.refund_receipt_immutable();

alter table public.refund_completion_notice_adoptions
  add column source_kind text not null default 'support_gmail',
  add column external_notice_observation_id uuid unique,
  alter column gmail_message_id drop not null,
  alter column gmail_thread_id drop not null,
  add constraint refund_completion_notice_adoptions_exact_source check(
    (source_kind='support_gmail' and gmail_message_id is not null and gmail_thread_id is not null
      and external_notice_observation_id is null)
    or (source_kind='historical_owner_mailbox' and external_notice_observation_id is not null
      and gmail_message_id is null and gmail_thread_id is null and manager_cc_verified is false)
  ),
  add constraint refund_completion_notice_adoptions_external_exact_case_fk
    foreign key(external_notice_observation_id,receipt_id,refund_case_id)
    references public.refund_external_notice_observations(id,receipt_id,refund_case_id);

-- Opaque review identity, not authority and not a token. The public reader/write
-- validate current authority separately; checked reviews cannot cross sessions.
create function public.refund_owner_notice_review_binding()
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_array(u.id,
    auth.jwt()->>'session_id',lower(btrim(u.email)))::text,'UTF8'),'sha256'),'hex')
  from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
    and nullif(btrim(u.email),'') is not null and auth.role()='authenticated'
    and nullif(auth.jwt()->>'session_id','') is not null;
$$;
revoke all on function public.refund_owner_notice_review_binding() from public,anon,authenticated,service_role;

create function public.admin_record_refund_historical_owner_notice(
  p_case_id uuid,p_receipt_id uuid,p_expected_case_version bigint,
  p_completion_case_reference text,p_completion_original_transaction_id text,
  p_completion_amount_cents integer,p_currency_code text,
  p_provider_message_id text,p_provider_thread_id text,p_original_sent_at timestamptz,
  p_recipient_email text,p_reviewed_message_digest text,p_evidence_reference text,
  p_reviewed_owned_mailbox_sent boolean,p_reviewed_customer_only_no_cc boolean,p_reviewed_exact_case_amount boolean,
  p_expected_owner_review_binding text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  r public.refund_authoritative_receipts%rowtype;
  n public.refund_completion_notice_adoptions%rowtype;
  e public.refund_external_notice_observations%rowtype;
  sender_value text;
  mailbox_digest text;
  provider_digest text;
  snapshot_digest text;
begin
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Current Refund Operations session required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  perform public.assert_refund_receipt_operator(p_case_id);
  select lower(btrim(u.email)) into sender_value from auth.users u
    where u.id=auth.uid() and u.email_confirmed_at is not null
      and nullif(btrim(u.email),'') is not null for share;
  if sender_value is null or sender_value='info@bloomjoysweets.com'
    or sender_value !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' then
    raise exception 'A current verified owner-mailbox identity is required' using errcode='42501';
  end if;
  select * into r from public.refund_authoritative_receipts where id=p_receipt_id and refund_case_id=c.id for share;
  if p_expected_owner_review_binding is null
    or p_expected_owner_review_binding is distinct from public.refund_owner_notice_review_binding()
    or r.id is null or c.official_action_version is distinct from p_expected_case_version
    or c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card'
    or c.status is distinct from 'card_refund_pending' or c.duplicate_of_refund_case_id is not null
    or r.provider_status is distinct from 62 or r.refunded_amount_cents is distinct from r.original_amount_cents
    or r.reporting_machine_id is distinct from c.reporting_machine_id
    or r.original_transaction_id is distinct from c.matched_nayax_transaction_id
    or r.original_amount_cents is distinct from c.refund_amount_cents
    or r.currency_code is distinct from c.matched_nayax_currency_code
    or p_completion_case_reference is distinct from c.public_reference
    or p_completion_original_transaction_id is distinct from r.original_transaction_id
    or p_completion_amount_cents is distinct from r.refunded_amount_cents
    or p_currency_code is distinct from r.currency_code
    or p_recipient_email is distinct from lower(btrim(c.customer_email))
    or nullif(p_recipient_email,'') is null
    or p_reviewed_owned_mailbox_sent is distinct from true
    or p_reviewed_customer_only_no_cc is distinct from true
    or p_reviewed_exact_case_amount is distinct from true
    or p_provider_message_id is null or p_provider_message_id !~ '^[a-f0-9]{8,64}$'
    or p_provider_thread_id is null or p_provider_thread_id !~ '^[a-f0-9]{8,64}$'
    or p_reviewed_message_digest is null or p_reviewed_message_digest !~ '^[a-f0-9]{64}$'
    or p_evidence_reference is distinct from 'GMAIL-SENT:'||p_provider_message_id
    or p_original_sent_at is null or not isfinite(p_original_sent_at)
    or p_original_sent_at>'2026-09-02T19:51:58Z'::timestamptz
    or p_original_sent_at>statement_timestamp() then
    raise exception 'Review the exact historical owned-mailbox notice and current confirmed receipt' using errcode='P4664';
  end if;
  -- Identical mailbox/provider-message namespace to support-Gmail adoption.
  -- No source-kind prefix that could let one message be adopted twice.
  mailbox_digest:=encode(extensions.digest(convert_to(sender_value,'UTF8'),'sha256'),'hex');
  provider_digest:=encode(extensions.digest(convert_to(mailbox_digest||'|'||p_provider_message_id,'UTF8'),'sha256'),'hex');
  snapshot_digest:=encode(extensions.digest(convert_to(jsonb_build_array(
    c.id,r.id,c.public_reference,r.original_transaction_id,r.account_scope,r.provider_machine_id,
    r.refunded_amount_cents,r.currency_code,auth.uid(),sender_value,p_recipient_email,
    p_provider_message_id,p_provider_thread_id,p_original_sent_at,p_reviewed_message_digest,p_evidence_reference,
    'operator_observed_gmail_sent',true,true,true,false,false)::text,'UTF8'),'sha256'),'hex');
  select * into n from public.refund_completion_notice_adoptions where receipt_id=r.id;
  if n.receipt_id is not null then
    select * into e from public.refund_external_notice_observations where id=n.external_notice_observation_id;
    if n.source_kind is distinct from 'historical_owner_mailbox' or e.id is null
      or e.evidence_snapshot_digest is distinct from snapshot_digest
      or n.provider_message_digest is distinct from provider_digest then
      raise exception 'A different completion notice is already recorded' using errcode='P4664';
    end if;
    return jsonb_build_object('status','already_adopted','noticeSource','historical_owner_mailbox',
      'noticeVerification','operator_observed','supportThread',false,'managerCcVerified',false,
      'customerMessageSent',false,'payloadRedacted',true);
  end if;
  if exists(select 1 from public.refund_completion_notice_adoptions where provider_message_digest=provider_digest) then
    raise exception 'This historical message is already associated with another claim' using errcode='P4664';
  end if;
  insert into public.refund_external_notice_observations(receipt_id,refund_case_id,sender_email,recipient_email,
    mailbox_hash,provider_message_id,provider_thread_id,provider_message_digest,reviewed_message_digest,
    evidence_reference,evidence_snapshot_digest,sent_at,observed_by,
    customer_only_no_cc_reviewed,exact_case_amount_reviewed,owned_mailbox_sent_reviewed)
  values(r.id,c.id,sender_value,p_recipient_email,mailbox_digest,p_provider_message_id,p_provider_thread_id,
    provider_digest,p_reviewed_message_digest,p_evidence_reference,snapshot_digest,p_original_sent_at,auth.uid(),true,true,true)
  returning * into e;
  insert into public.refund_completion_notice_adoptions(receipt_id,refund_case_id,source_kind,
    external_notice_observation_id,gmail_message_id,gmail_thread_id,message_evidence_digest,
    provider_message_digest,sent_at,manager_cc_verified,reviewed_by)
  values(r.id,c.id,'historical_owner_mailbox',e.id,null,null,snapshot_digest,provider_digest,p_original_sent_at,false,auth.uid());
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,auth.uid(),'historical_owner_completion_notice_observed',
    'Historical owned-mailbox SENT notice reviewed for this exact claim. No provider delivery or manager CC was verified; nothing was sent.',
    jsonb_build_object('notice_source','historical_owner_mailbox','verification','operator_observed',
      'support_thread',false,'manager_cc_verified',false,'customer_message_sent',false,'payload_redacted',true));
  update public.refund_cases set lifecycle_revision=lifecycle_revision+1,updated_at=statement_timestamp() where id=c.id;
  return jsonb_build_object('status','adopted','noticeSource','historical_owner_mailbox',
    'noticeVerification','operator_observed','supportThread',false,'managerCcVerified',false,
    'customerMessageSent',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_record_refund_historical_owner_notice(uuid,uuid,bigint,text,text,integer,text,text,text,timestamptz,text,text,text,boolean,boolean,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_record_refund_historical_owner_notice(uuid,uuid,bigint,text,text,integer,text,text,text,timestamptz,text,text,text,boolean,boolean,boolean,text) to authenticated;

-- Keep the original reader and support-mailbox choices untouched. The extension
-- labels provenance explicitly and never masquerades as a support-thread choice.
alter function public.admin_get_refund_authoritative_receipt_overview(uuid) rename to admin_get_refund_receipt_overview_pre_owner_notice_v1;
revoke all on function public.admin_get_refund_receipt_overview_pre_owner_notice_v1(uuid) from public,anon,authenticated,service_role;
create function public.admin_get_refund_authoritative_receipt_overview(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb; n public.refund_completion_notice_adoptions%rowtype; owner_available boolean;
begin
  base:=public.admin_get_refund_receipt_overview_pre_owner_notice_v1(p_case_id);
  if base->>'visible' is distinct from 'true' then return base; end if;
  select * into n from public.refund_completion_notice_adoptions where refund_case_id=p_case_id;
  select exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null
    and nullif(btrim(u.email),'') is not null and lower(btrim(u.email))<>'info@bloomjoysweets.com') into owner_available;
  if base->'receipt'<>'null'::jsonb then
    base:=jsonb_set(base,'{receipt}',base->'receipt'||jsonb_build_object(
      'noticeSource',n.source_kind,'noticeVerification',case when n.source_kind='historical_owner_mailbox'
        then 'operator_observed' when n.source_kind='support_gmail' then 'support_gmail_sent' else null end,
      'supportThread',case when n.receipt_id is null then null else n.source_kind='support_gmail' end));
  end if;
  owner_available:=owner_available and base->'receipt'<>'null'::jsonb and n.receipt_id is null;
  return base||jsonb_build_object('historicalOwnerNoticeAvailable',owner_available,
    'historicalOwnerReviewBinding',case when owner_available then public.refund_owner_notice_review_binding() else null end,
    'historicalOwnerNoticeCutoff','2026-09-02T19:51:58Z');
end;
$$;
revoke all on function public.admin_get_refund_authoritative_receipt_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_authoritative_receipt_overview(uuid) to authenticated;

comment on table public.refund_external_notice_observations is
  'Private immutable operator observations of owned-mailbox SENT notices at or before 2026-09-02T19:51:58Z. Not support ingestion, provider delivery verification, or sender permission.';
