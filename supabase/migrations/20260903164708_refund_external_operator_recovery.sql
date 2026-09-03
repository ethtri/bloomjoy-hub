-- #1117: a current operator can record an already-refunded, misrouted case
-- together with its existing SENT notice. This creates no payment or mail.
create table public.refund_external_operator_recoveries (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id),
  receipt_id uuid not null unique references public.refund_authoritative_receipts(id),
  old_machine_id uuid not null references public.reporting_machines(id),
  new_machine_id uuid not null references public.reporting_machines(id),
  inventory_id uuid not null references public.refund_nayax_machine_inventory(id),
  inventory_evidence_digest text not null check(inventory_evidence_digest ~ '^[a-f0-9]{64}$'),
  prior_case_version bigint not null,
  original_intake_selection jsonb not null,
  original_reported_amount_cents integer,
  original_correlation_status text,
  provider_site_id integer not null check(provider_site_id>=0),
  provider_machine_time_raw text not null check(length(provider_machine_time_raw) between 19 and 80),
  mailbox_hash text not null check(mailbox_hash ~ '^[a-f0-9]{64}$'),
  sender_email text not null check(sender_email='info@bloomjoysweets.com'),
  recipient_email text not null,
  cc_emails text[] not null,
  provider_message_id text not null check(provider_message_id ~ '^[a-f0-9]{8,64}$'),
  provider_thread_id text not null check(provider_thread_id ~ '^[a-f0-9]{8,64}$'),
  rfc_message_id text not null check(length(rfc_message_id) between 5 and 998),
  provider_message_digest text not null unique check(provider_message_digest ~ '^[a-f0-9]{64}$'),
  reviewed_message_digest text not null check(reviewed_message_digest ~ '^[a-f0-9]{64}$'),
  request_digest text not null check(request_digest ~ '^[a-f0-9]{64}$'),
  sent_at timestamptz not null check(isfinite(sent_at)),
  observed_by uuid not null references auth.users(id),
  observed_at timestamptz not null default statement_timestamp(),
  verification text not null default 'operator_observed_gmail_sent' check(verification='operator_observed_gmail_sent'),
  delivery_verification text not null default 'unknown' check(delivery_verification='unknown'),
  check(old_machine_id<>new_machine_id),
  unique(id,receipt_id,refund_case_id),
  unique(id,refund_case_id,new_machine_id)
);
alter table public.refund_external_operator_recoveries enable row level security;
revoke all on public.refund_external_operator_recoveries from public,anon,authenticated,service_role;
create index refund_operator_recovery_old_machine_idx on public.refund_external_operator_recoveries(old_machine_id);
create index refund_operator_recovery_new_machine_idx on public.refund_external_operator_recoveries(new_machine_id);
create index refund_operator_recovery_inventory_idx on public.refund_external_operator_recoveries(inventory_id);
create index refund_operator_recovery_actor_idx on public.refund_external_operator_recoveries(observed_by);
create trigger refund_external_operator_recoveries_immutable before update or delete
  on public.refund_external_operator_recoveries for each row execute function public.refund_receipt_immutable();

-- The submitted selection remains historical evidence. An exception to its
-- current-machine constraint must reference this exact case's immutable repair.
alter table public.refund_cases add column external_refund_recovery_id uuid unique,
  add constraint refund_case_external_recovery_exact_machine_fk
    foreign key(external_refund_recovery_id,id,reporting_machine_id)
    references public.refund_external_operator_recoveries(id,refund_case_id,new_machine_id) deferrable initially deferred,
  drop constraint refund_cases_resolved_machine_in_scope_check,
  add constraint refund_cases_resolved_machine_in_scope_check check(
    reporting_machine_id is null or intake_selection_machine_ids is null
    or reporting_machine_id=any(intake_selection_machine_ids) or external_refund_recovery_id is not null);
create function public.guard_refund_external_recovery_intake()
returns trigger language plpgsql set search_path='' as $$
begin
  if (new.external_refund_recovery_id is not null or old.external_refund_recovery_id is not null) and
    (row(new.intake_selection_kind,new.intake_selection_key,new.intake_selection_machine_ids,new.intake_meta,
      new.payment_amount_cents,new.card_last4,new.incident_at,new.incident_timezone,new.customer_email,
      new.incident_local_datetime,new.incident_time_resolution,new.incident_time_confidence,new.card_network,
      new.card_wallet_used,new.card_last4_provenance,new.payment_interaction,new.wallet_provider,
      new.refund_qr_claim_context_id,new.reporting_location_id,new.customer_name,new.customer_phone,new.issue_summary)
    is distinct from row(old.intake_selection_kind,old.intake_selection_key,old.intake_selection_machine_ids,old.intake_meta,
      old.payment_amount_cents,old.card_last4,old.incident_at,old.incident_timezone,old.customer_email,
      old.incident_local_datetime,old.incident_time_resolution,old.incident_time_confidence,old.card_network,
      old.card_wallet_used,old.card_last4_provenance,old.payment_interaction,old.wallet_provider,
      old.refund_qr_claim_context_id,old.reporting_location_id,old.customer_name,old.customer_phone,old.issue_summary)
    or (old.external_refund_recovery_id is not null and new.external_refund_recovery_id is distinct from old.external_refund_recovery_id)) then
    raise exception 'An external refund recovery preserves the original intake and customer facts' using errcode='P4667';
  end if;
  if old.external_refund_recovery_id is not null and row(new.correlation_status,new.correlation_summary,
    new.nayax_recommendation_state,new.nayax_recommendation_policy_version,new.nayax_lookup_status)
    is distinct from row(old.correlation_status,old.correlation_summary,
      old.nayax_recommendation_state,old.nayax_recommendation_policy_version,old.nayax_lookup_status) then
    raise exception 'A confirmed external refund cannot be overwritten by stale matching work' using errcode='P4667';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_refund_external_recovery_intake() from public,anon,authenticated,service_role;
create trigger aa_refund_external_recovery_intake_guard before update on public.refund_cases
  for each row execute function public.guard_refund_external_recovery_intake();

alter table public.refund_authoritative_receipts drop constraint refund_authoritative_receipts_attempt_binding_kind_check;
alter table public.refund_authoritative_receipts add constraint refund_authoritative_receipts_attempt_binding_kind_check
  check(attempt_binding_kind in ('modern_authorized_manual','legacy_manual_portal_observation','no_attempt_integrity_hold',
    'verified_authorized_api','external_operator_observation'));
alter table public.refund_completion_notice_adoptions
  add column operator_recovery_id uuid unique,
  drop constraint refund_completion_notice_adoptions_exact_source,
  add constraint refund_completion_notice_adoptions_exact_source check(
    (source_kind='support_gmail' and gmail_message_id is not null and gmail_thread_id is not null
      and external_notice_observation_id is null and operator_recovery_id is null)
    or (source_kind='historical_owner_mailbox' and external_notice_observation_id is not null
      and gmail_message_id is null and gmail_thread_id is null and manager_cc_verified is false and operator_recovery_id is null)
    or (source_kind='current_operator_mailbox' and operator_recovery_id is not null
      and gmail_message_id is null and gmail_thread_id is null and external_notice_observation_id is null and manager_cc_verified)
  ),
  add constraint refund_notice_operator_recovery_exact_case_fk foreign key(operator_recovery_id,receipt_id,refund_case_id)
    references public.refund_external_operator_recoveries(id,receipt_id,refund_case_id);

create function public.admin_get_refund_external_recovery_options(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases%rowtype; targets jsonb; r public.refund_external_operator_recoveries%rowtype;
begin
  perform public.assert_refund_receipt_operator(p_case_id);
  select * into c from public.refund_cases where id=p_case_id;
  select * into r from public.refund_external_operator_recoveries where refund_case_id=c.id;
  if r.id is not null then return jsonb_build_object('schemaVersion','refund_external_recovery_v1','available',false,
    'recorded',true,'caseId',c.id,'receiptId',r.receipt_id,'noticeSentAt',r.sent_at,'payloadRedacted',true); end if;
  if c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card'
    or c.status is distinct from 'needs_review' or c.matched_nayax_transaction_id is not null
    or c.decision is not null or c.duplicate_of_refund_case_id is not null
    or exists(select 1 from public.refund_case_nayax_refund_attempts where refund_case_id=c.id)
    or exists(select 1 from public.refund_authoritative_receipts where refund_case_id=c.id)
  then return jsonb_build_object('schemaVersion','refund_external_recovery_v1','available',false,'recorded',false,'payloadRedacted',true); end if;
  select coalesce(jsonb_agg(jsonb_build_object('machineId',m.id,'machineLabel',m.machine_label,
    'inventoryId',i.id,'inventoryDigest',public.refund_machine_correction_inventory_digest(i.id),
    'accountScope',i.account_key,'providerMachineId',i.nayax_machine_id,'machineNumber',i.machine_number) order by m.id),'[]'::jsonb)
    into targets from public.refund_nayax_machine_inventory i join public.reporting_machines m on m.id=i.reporting_machine_id
    join public.reporting_machines old on old.id=c.reporting_machine_id
    where m.id<>old.id and m.account_id=old.account_id and m.location_id=c.reporting_location_id
      and m.nayax_account_key=old.nayax_account_key and m.nayax_account_key=i.account_key and m.nayax_machine_id=i.nayax_machine_id
      and m.status='active' and not m.nayax_manual_portal_enabled and i.provider_is_active
      and i.reconciliation_state='published' and i.missing_successful_snapshots=0 and nullif(i.machine_number,'') is not null
      and exists(select 1 from public.reporting_machine_refund_managers mm where mm.reporting_machine_id=m.id
        and mm.manager_user_id=auth.uid() and mm.status='active' and mm.revoked_at is null);
  return jsonb_build_object('schemaVersion','refund_external_recovery_v1','available',jsonb_array_length(targets)>0,
    'recorded',false,'caseId',c.id,'caseReference',c.public_reference,'expectedCaseVersion',c.official_action_version,
    'oldMachineId',c.reporting_machine_id,'customerEmail',lower(btrim(c.customer_email)),
    'reportedAmountCents',c.payment_amount_cents,'cardLast4',c.card_last4,'incidentAt',c.incident_at,
    'reviewBinding',public.refund_owner_notice_review_binding(),'targets',targets,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_get_refund_external_recovery_options(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_external_recovery_options(uuid) to authenticated;

create function public.admin_reconcile_external_refund_and_notice(p_case_id uuid,p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype; old_m public.reporting_machines%rowtype; m public.reporting_machines%rowtype;
  i public.refund_nayax_machine_inventory%rowtype; l public.reporting_locations%rowtype;
  prior public.refund_external_operator_recoveries%rowtype; receipt_id uuid; recovery_id uuid; machine_id uuid;
  target_id uuid; mailbox text; request_digest text; provider_digest text; mailbox_digest text; notice_digest text;
  cc text[]; managers text[]; sent_at timestamptz; auth_at timestamptz; amount_cents integer; site_id integer;
  txn text; e jsonb:=p_evidence; mail jsonb:=p_evidence->'notice'; raw_time text;
begin
  if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(mail) is distinct from 'object'
    or pg_column_size(e)>100000 then raise exception 'Review the exact provider and sent-message evidence' using errcode='P4667'; end if;
  if auth.role() is distinct from 'authenticated' or auth.uid() is null or not public.is_super_admin(auth.uid()) then
    raise exception 'Current Refund Operations session required' using errcode='42501'; end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  target_id:=(e->>'targetMachineId')::uuid;
  for machine_id in select id from public.reporting_machines
    where id in (c.reporting_machine_id,target_id,(e->>'oldMachineId')::uuid) order by id loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('machine_manager:'||machine_id::text));
  end loop;
  perform public.assert_refund_receipt_operator(p_case_id);
  select lower(btrim(email)) into mailbox from auth.users where id=auth.uid() and email_confirmed_at is not null for share;
  if mailbox is null or e->>'reviewBinding' is distinct from public.refund_owner_notice_review_binding()
    or e->'reviewedRefund' is distinct from 'true'::jsonb or e->'reviewedMatch' is distinct from 'true'::jsonb
    or e->'reviewedSentNotice' is distinct from 'true'::jsonb then
    raise exception 'Review evidence in the current mapped operator session' using errcode='42501'; end if;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_array(c.id,auth.uid(),e)::text,'UTF8'),'sha256'),'hex');
  select * into prior from public.refund_external_operator_recoveries where refund_case_id=c.id;
  if prior.id is not null then
    if prior.request_digest is distinct from request_digest then raise exception 'Recovery replay conflicts with saved evidence' using errcode='P4667'; end if;
    return jsonb_build_object('status','already_recorded','receiptId',prior.receipt_id,'paymentConfirmed',true,
      'noticeAdopted',true,'customerMessageSent',false,'providerCallMade',false,'payloadRedacted',true);
  end if;
  perform 1 from public.admin_roles where user_id=auth.uid() and role='super_admin' and active for share;
  if not found then raise exception 'Current Refund Operations authority required' using errcode='42501'; end if;
  perform 1 from public.reporting_machine_refund_managers where reporting_machine_id=target_id
    and manager_user_id=auth.uid() and status='active' and revoked_at is null for share;
  if not found then raise exception 'Current authority over both machines required' using errcode='42501'; end if;
  select * into i from public.refund_nayax_machine_inventory where id=(e->>'inventoryId')::uuid for share;
  perform 1 from public.reporting_machines where id in (c.reporting_machine_id,target_id) order by id for share;
  select * into old_m from public.reporting_machines where id=c.reporting_machine_id;
  select * into m from public.reporting_machines where id=target_id;
  select * into l from public.reporting_locations where id=c.reporting_location_id for share;
  if c.case_population is distinct from 'customer' or c.payment_method is distinct from 'card'
    or c.status is distinct from 'needs_review' or c.decision is not null or c.duplicate_of_refund_case_id is not null
    or c.official_action_version is distinct from (e->>'expectedCaseVersion')::bigint
    or c.reporting_machine_id is distinct from (e->>'oldMachineId')::uuid or target_id=c.reporting_machine_id
    or c.matched_nayax_transaction_id is not null or c.refund_completed_at is not null or c.reporting_adjustment_id is not null
    or exists(select 1 from public.refund_case_nayax_refund_attempts where refund_case_id=c.id)
    or exists(select 1 from public.refund_case_official_action_authorizations where refund_case_id=c.id)
    or exists(select 1 from public.refund_authoritative_receipts where refund_case_id=c.id)
    or exists(select 1 from public.sales_adjustment_facts where refund_case_id=c.id)
    or i.id is null or m.id is null or i.reporting_machine_id is distinct from m.id
    or e->>'inventoryDigest' is distinct from public.refund_machine_correction_inventory_digest(i.id)
    or i.reconciliation_state is distinct from 'published' or not i.provider_is_active or i.missing_successful_snapshots<>0
    or e->>'accountScope' is distinct from i.account_key or e->>'providerMachineId' is distinct from i.nayax_machine_id
    or e->>'machineNumber' is distinct from i.machine_number or nullif(i.machine_number,'') is null
    or i.account_key is distinct from m.nayax_account_key or i.nayax_machine_id is distinct from m.nayax_machine_id
    or m.account_id is distinct from old_m.account_id or m.nayax_account_key is distinct from old_m.nayax_account_key
    or m.location_id is distinct from l.id or old_m.location_id is distinct from l.id
    or m.status is distinct from 'active' or old_m.status is distinct from 'active' or l.status is distinct from 'active'
    or m.nayax_manual_portal_enabled or old_m.nayax_manual_portal_enabled
  then raise exception 'Reload the current unrefunded case and verified machine mapping' using errcode='P4667'; end if;
  amount_cents:=(e->>'originalAmountCents')::integer; site_id:=(e->>'siteId')::integer;
  txn:=e->>'originalTransactionId'; raw_time:=e->>'machineAuthorizationTime';
  if amount_cents is null or amount_cents<=0 or (e->>'refundedAmountCents')::integer is distinct from amount_cents
    or e->>'currencyCode' is distinct from 'USD' or e->>'providerStatus' is distinct from '62'
    or site_id is null or site_id<0 or txn is null or txn !~ '^[0-9]{1,30}$'
    or e->>'evidenceReference' is distinct from 'DTM:NAYAX-'||txn
    or e->>'cardLast4' is distinct from c.card_last4 or c.card_last4 !~ '^[0-9]{4}$'
    or c.card_last4 is null or c.card_wallet_used is distinct from false or c.payment_amount_cents is null or c.payment_amount_cents<=0
    or c.incident_time_resolution is distinct from 'exact' or c.incident_timezone is distinct from l.timezone
    or abs(amount_cents-c.payment_amount_cents)>300 or c.incident_at is null
    or raw_time is null or raw_time !~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,9})?$'
  then raise exception 'Exact full-refund status, original sale, card and amount are required' using errcode='P4667'; end if;
  auth_at:=raw_time::timestamp at time zone l.timezone;
  if not isfinite(auth_at) or abs(extract(epoch from(auth_at-c.incident_at)))>3600
    or (auth_at at time zone l.timezone) is distinct from raw_time::timestamp
    or ((auth_at-interval '1 hour') at time zone l.timezone)=raw_time::timestamp
    or ((auth_at+interval '1 hour') at time zone l.timezone)=raw_time::timestamp
  then raise exception 'Provider purchase time requires a clear local-time match' using errcode='P4667'; end if;
  if exists(select 1 from public.refund_case_messages msg where msg.refund_case_id=c.id
      and (msg.status='pending' or msg.manual_delivery_state in ('queued','claimed','delivery_unknown')
        or (msg.delivery_transport='resend' and msg.delivery_state='unknown'
          and (msg.status is distinct from 'sent' or msg.sent_at is null or msg.provider_message_id is not null
            or msg.delivery_state_updated_at is distinct from msg.sent_at))))
    or exists(select 1 from public.refund_gmail_messages where refund_case_id=c.id and direction='outbound'
      and status in ('pending_send','delivery_unknown'))
  then raise exception 'Reconcile the existing customer delivery before adopting a notice' using errcode='P4667'; end if;
  if jsonb_typeof(mail->'ccEmails') is distinct from 'array' or jsonb_array_length(mail->'ccEmails')>20 then
    raise exception 'Review the actual sent recipients' using errcode='P4667'; end if;
  select array_agg(distinct lower(btrim(value)) order by lower(btrim(value))) into cc from jsonb_array_elements_text(mail->'ccEmails');
  select array_agg(distinct lower(btrim(manager_email)) order by lower(btrim(manager_email))) into managers
    from public.reporting_machine_refund_managers where reporting_machine_id=m.id and status='active' and revoked_at is null;
  sent_at:=(mail->>'sentAt')::timestamptz;
  if mail->>'senderEmail' is distinct from 'info@bloomjoysweets.com' or mail->>'replyToEmail' is distinct from 'info@bloomjoysweets.com'
    or mail->>'recipientEmail' is distinct from lower(btrim(c.customer_email))
    or managers is null or cardinality(managers) not between 1 and 3 or cc is null or not(managers<@cc)
    or exists(select 1 from unnest(cc) address where address !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$')
    or mail->>'providerMessageId' is null or mail->>'providerMessageId' !~ '^[a-f0-9]{8,64}$'
    or mail->>'providerThreadId' is null or mail->>'providerThreadId' !~ '^[a-f0-9]{8,64}$'
    or mail->>'rfcMessageId' is null or length(mail->>'rfcMessageId') not between 5 and 998
    or mail->>'rfcMessageId' !~ '^<[^<>[:space:]]+>$'
    or mail->>'subject' is null or length(mail->>'subject')>998
    or mail->>'plainBody' is null or length(mail->>'plainBody') not between 20 and 60000
    or position(c.public_reference in mail->>'plainBody')=0
    or position('$'||to_char(amount_cents::numeric/100,'FM999999990.00') in mail->>'plainBody')=0
    or lower(mail->>'plainBody') not like '%refund%'
    or sent_at is null or not isfinite(sent_at) or sent_at>statement_timestamp() or sent_at<c.created_at or sent_at<auth_at
  then raise exception 'Review the original SENT notice for this customer, full amount and all current manager CCs' using errcode='P4667'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(i.account_key||'|'||txn,4661));
  if exists(select 1 from public.refund_cases where id<>c.id and matched_nayax_transaction_id=txn)
    or exists(select 1 from public.refund_authoritative_receipts where account_scope=i.account_key and original_transaction_id=txn)
  then raise exception 'This original sale is already associated with another case' using errcode='P4667'; end if;
  mailbox_digest:=encode(extensions.digest(convert_to(mailbox,'UTF8'),'sha256'),'hex');
  provider_digest:=encode(extensions.digest(convert_to(mailbox_digest||'|'||(mail->>'providerMessageId'),'UTF8'),'sha256'),'hex');
  notice_digest:=encode(extensions.digest(convert_to(mail::text,'UTF8'),'sha256'),'hex');
  if exists(select 1 from public.refund_completion_notice_adoptions where provider_message_digest=provider_digest) then
    raise exception 'This sent message is already associated with a refund' using errcode='P4667'; end if;
  -- Preserve every original customer fact and the base decision/payment state.
  recovery_id:=gen_random_uuid();
  update public.refund_cases set external_refund_recovery_id=recovery_id,reporting_machine_id=m.id,correlation_status='matched',correlation_source='nayax',
    correlation_summary='Verified current provider observation of an already-issued full refund.',
    matched_nayax_transaction_id=txn,matched_nayax_site_id=site_id,matched_nayax_machine_auth_time=auth_at,
    matched_nayax_amount_cents=amount_cents,matched_nayax_currency_code='USD',matched_nayax_card_last4=c.card_last4,
    refund_amount_cents=amount_cents,nayax_match_execution_eligible=false,updated_at=statement_timestamp() where id=c.id;
  insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,provider_machine_id,
    original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
    recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
  values(c.id,m.id,i.account_key,i.nayax_machine_id,txn,amount_cents,amount_cents,'USD',62,
    public.refund_nayax_resolution_reference_digest(i.account_key||'|'||(e->>'evidenceReference')),auth.uid(),'external_operator_observation',true)
    returning id into receipt_id;
  insert into public.refund_external_operator_recoveries(id,refund_case_id,receipt_id,old_machine_id,new_machine_id,inventory_id,
    inventory_evidence_digest,prior_case_version,original_intake_selection,original_reported_amount_cents,original_correlation_status,
    provider_site_id,provider_machine_time_raw,mailbox_hash,sender_email,recipient_email,cc_emails,
    provider_message_id,provider_thread_id,rfc_message_id,provider_message_digest,reviewed_message_digest,request_digest,sent_at,observed_by)
  values(recovery_id,c.id,receipt_id,old_m.id,m.id,i.id,e->>'inventoryDigest',c.official_action_version,
    jsonb_build_object('kind',c.intake_selection_kind,'key',c.intake_selection_key,'machineIds',c.intake_selection_machine_ids),
    c.payment_amount_cents,c.correlation_status,site_id,raw_time,mailbox_digest,mail->>'senderEmail',mail->>'recipientEmail',cc,
    mail->>'providerMessageId',mail->>'providerThreadId',mail->>'rfcMessageId',provider_digest,notice_digest,request_digest,sent_at,auth.uid())
    returning id into recovery_id;
  insert into public.refund_completion_notice_adoptions(receipt_id,refund_case_id,source_kind,operator_recovery_id,
    message_evidence_digest,provider_message_digest,sent_at,manager_cc_verified,reviewed_by)
  values(receipt_id,c.id,'current_operator_mailbox',recovery_id,notice_digest,provider_digest,sent_at,true,auth.uid());
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
  values(c.id,auth.uid(),'external_refund_and_notice_reconciled','Already-issued full refund and existing operator-mailbox SENT notice recorded; current machine corrected.',
    jsonb_build_object('receipt_id',receipt_id,'recovery_id',recovery_id,'provider_call_made',false,'customer_message_sent',false,
      'notice_source','current_operator_mailbox','manager_cc_verified',true,'settlement_time_precision','unknown','payload_redacted',true));
  update public.refund_cases set lifecycle_revision=lifecycle_revision+1,updated_at=statement_timestamp() where id=c.id;
  return jsonb_build_object('status','recorded','receiptId',receipt_id,'paymentConfirmed',true,'noticeAdopted',true,
    'customerMessageSent',false,'providerCallMade',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.admin_reconcile_external_refund_and_notice(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.admin_reconcile_external_refund_and_notice(uuid,jsonb) to authenticated;

alter function public.admin_get_refund_authoritative_receipt_overview(uuid) rename to admin_get_refund_receipt_overview_pre_external_recovery_v1;
revoke all on function public.admin_get_refund_receipt_overview_pre_external_recovery_v1(uuid) from public,anon,authenticated,service_role;
create function public.admin_get_refund_authoritative_receipt_overview(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=public.admin_get_refund_receipt_overview_pre_external_recovery_v1(p_case_id);
  if result->'receipt'->>'noticeSource'='current_operator_mailbox' then
    result:=jsonb_set(result,'{receipt,noticeVerification}','"operator_observed"'::jsonb);
  end if;
  return result;
end;
$$;
revoke all on function public.admin_get_refund_authoritative_receipt_overview(uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_authoritative_receipt_overview(uuid) to authenticated;
select pg_notify('pgrst','reload schema');
