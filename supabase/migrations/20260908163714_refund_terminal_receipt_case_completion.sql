-- #971/#973/#990: make immutable provider confirmation the payment terminal
-- fact, independently of customer-notice delivery and accounting date.

alter table public.refund_authoritative_receipts
  add column confirmation_source text not null default 'dtm_observation';
alter table public.refund_authoritative_receipts
  alter column provider_status drop not null,
  drop constraint refund_authoritative_receipts_provider_status_check,
  add constraint refund_authoritative_receipts_provider_status_source_check check (
    (confirmation_source='dtm_observation'
      and provider_status is not distinct from 62)
    or (confirmation_source='api_stage_contract' and provider_status is null)
  ),
  drop constraint refund_authoritative_receipts_attempt_binding_kind_check,
  add constraint refund_authoritative_receipts_attempt_binding_kind_check check (
    attempt_binding_kind in (
      'modern_authorized_manual','legacy_manual_portal_observation',
      'no_attempt_integrity_hold','verified_authorized_api',
      'external_operator_observation','proved_terminal_api'
    )
  ),
  add constraint refund_authoritative_receipts_confirmation_source_shape check (
    (confirmation_source='api_stage_contract')=(attempt_binding_kind='proved_terminal_api')
    and (confirmation_source<>'api_stage_contract' or (
      nayax_refund_attempt_id is not null
      and not current_provider_observation_reviewed
    ))
  );

-- This predicate recognizes only the exact current request-and-approve contract.
-- Reports, amount signs, blank statuses and approximate times are not evidence.
create function public.refund_nayax_api_terminal_evidence_proved(
  p_case_id uuid,p_attempt_id uuid
)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.refund_cases c
    join public.reporting_machines machine on machine.id=c.reporting_machine_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=p_attempt_id and attempt.refund_case_id=c.id
    join public.refund_nayax_execution_contexts saved on saved.attempt_id=attempt.id
    cross join lateral jsonb_to_record(saved.context) as context(
      "caseId" uuid,"reportingMachineId" uuid,"attemptGeneration" integer,
      "accountScope" text,"providerMachineId" text,"transactionId" text,
      "siteId" integer,"originalAmountCents" integer,"currencyCode" text
    )
    join public.refund_nayax_provider_stage_journal request_journal
      on request_journal.nayax_refund_attempt_id=attempt.id
      and request_journal.pending_approval_recovery_id is null
      and request_journal.stage='request' and request_journal.event='result'
    join public.refund_nayax_provider_business_outcomes request_outcome
      on request_outcome.provider_stage_journal_id=request_journal.id
      and request_outcome.nayax_refund_attempt_id=attempt.id
      and request_outcome.stage='request'
    join public.refund_nayax_provider_stage_journal approve_journal
      on approve_journal.nayax_refund_attempt_id=attempt.id
      and approve_journal.pending_approval_recovery_id is null
      and approve_journal.stage='approve' and approve_journal.event='result'
    join public.refund_nayax_provider_business_outcomes approve_outcome
      on approve_outcome.provider_stage_journal_id=approve_journal.id
      and approve_outcome.nayax_refund_attempt_id=attempt.id
      and approve_outcome.stage='approve'
    where c.id=p_case_id and c.case_population='customer' and c.payment_method='card'
      and c.decision='approved' and c.status='completed'
      and c.reporting_adjustment_id is not null
      and c.nayax_refund_execution_status='approved'
      and attempt.execution_mode='request_and_approve'
      and attempt.status='succeeded' and attempt.provider_outcome='success'
      and attempt.provider_status='approve_succeeded_contract_match'
      and not attempt.reconciliation_required
      and attempt.reporting_adjustment_id=c.reporting_adjustment_id
      and attempt.provider_outcome_recorded_at is not null
      and attempt.case_finalization_committed_at is not null
      and attempt.actor_user_id is not null
      and context."caseId"=c.id and context."reportingMachineId"=machine.id
      and context."attemptGeneration"=c.nayax_refund_attempt_generation
      and context."accountScope"=machine.nayax_account_key
      and context."providerMachineId"=machine.nayax_machine_id
      and context."transactionId"=c.matched_nayax_transaction_id
      and context."siteId"=c.matched_nayax_site_id
      and context."originalAmountCents"=c.refund_amount_cents
      and context."originalAmountCents"=c.matched_nayax_amount_cents
      and context."originalAmountCents"=attempt.amount_cents
      and context."currencyCode"='USD'
      and context."currencyCode"=c.matched_nayax_currency_code
      and context."currencyCode"=attempt.currency_code
      and request_journal.http_status=200 and request_journal.http_accepted
      and request_journal.outcome='accepted' and request_journal.contract_matched
      and request_journal.approval_authorized and request_journal.schema_matched
      and request_journal.semantic_pair_matched
      and request_journal.journal_contract_version='nayax-provider-journal-v3'
      and request_journal.provider_contract_version='nayax-production-account-contract-v2'
      and approve_journal.http_status=200 and approve_journal.http_accepted
      and approve_journal.outcome='succeeded' and approve_journal.contract_matched
      and approve_journal.schema_matched and approve_journal.semantic_pair_matched
      and approve_journal.journal_contract_version='nayax-provider-journal-v3'
      and approve_journal.provider_contract_version='nayax-production-account-contract-v2'
      and request_outcome.business_pair_retained
      and request_outcome.observed_scalar_pair_retained
      and approve_outcome.business_pair_retained
      and approve_outcome.observed_scalar_pair_retained
      and request_outcome.business_result=
        'Refund status updated successfully, but the email could not be sent'
      and request_outcome.business_status='Partial success'
      and request_outcome.observed_result_scalar=request_outcome.business_result
      and request_outcome.observed_status_scalar=request_outcome.business_status
      and approve_outcome.business_result=request_outcome.business_result
      and approve_outcome.business_status=request_outcome.business_status
      and approve_outcome.observed_result_scalar=approve_outcome.business_result
      and approve_outcome.observed_status_scalar=approve_outcome.business_status
      and exists(select 1 from public.sales_adjustment_facts adjustment
        where adjustment.id=c.reporting_adjustment_id
          and adjustment.refund_case_id=c.id
          and adjustment.reporting_machine_id=c.reporting_machine_id
          and adjustment.reporting_location_id=c.reporting_location_id
          and adjustment.amount_cents=c.refund_amount_cents)
  );
$$;
revoke all on function public.refund_nayax_api_terminal_evidence_proved(uuid,uuid)
  from public,anon,authenticated,service_role;

create function public.refund_ensure_proved_nayax_api_terminal_receipt(
  p_case_id uuid,p_attempt_id uuid
)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  machine public.reporting_machines%rowtype;
  request_journal public.refund_nayax_provider_stage_journal%rowtype;
  approve_journal public.refund_nayax_provider_stage_journal%rowtype;
  receipt public.refund_authoritative_receipts%rowtype;
  evidence_digest text;
begin
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=c.id for share;
  select * into machine from public.reporting_machines
    where id=c.reporting_machine_id for share;
  select * into request_journal from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=attempt.id and pending_approval_recovery_id is null
      and stage='request' and event='result';
  select * into approve_journal from public.refund_nayax_provider_stage_journal
    where nayax_refund_attempt_id=attempt.id and pending_approval_recovery_id is null
      and stage='approve' and event='result';
  select * into receipt from public.refund_authoritative_receipts
    where refund_case_id=c.id;
  if receipt.id is not null then
    if receipt.nayax_refund_attempt_id is distinct from attempt.id
      or receipt.confirmation_source is distinct from 'api_stage_contract' then
      raise exception 'A different authoritative receipt already owns this case'
        using errcode='P4670';
    end if;
    return receipt.id;
  end if;
  if c.id is null or attempt.id is null or machine.id is null
    or not public.refund_nayax_api_terminal_evidence_proved(c.id,attempt.id) then
    raise exception 'Exact successful request-and-approval journal evidence required'
      using errcode='P4670';
  end if;
  evidence_digest:=encode(extensions.digest(convert_to(
    'nayax-api-terminal-v1|'||c.id::text||'|'||attempt.id::text||'|'
      ||request_journal.id::text||'|'||request_journal.classification_digest||'|'
      ||approve_journal.id::text||'|'||approve_journal.classification_digest,
    'UTF8'),'sha256'),'hex');
  insert into public.refund_authoritative_receipts(
    refund_case_id,nayax_refund_attempt_id,reporting_machine_id,account_scope,
    provider_machine_id,original_transaction_id,original_amount_cents,
    refunded_amount_cents,currency_code,provider_status,evidence_reference_digest,
    observed_at,recorded_by,attempt_binding_kind,current_provider_observation_reviewed,
    confirmation_source
  ) values (
    c.id,attempt.id,machine.id,machine.nayax_account_key,machine.nayax_machine_id,
    c.matched_nayax_transaction_id,c.refund_amount_cents,c.refund_amount_cents,
    'USD',null,evidence_digest,attempt.provider_outcome_recorded_at,attempt.actor_user_id,
    'proved_terminal_api',false,'api_stage_contract'
  ) returning * into receipt;
  insert into public.refund_case_events(
    refund_case_id,actor_user_id,event_type,message,metadata
  ) values (
    c.id,attempt.actor_user_id,'authoritative_refund_receipt_recorded',
    'Exact request-and-approval journal evidence recorded payment completion independently of notice delivery.',
    jsonb_build_object('schema_version','refund_api_terminal_receipt_v1',
      'attempt_id',attempt.id,'confirmation_source','api_stage_contract',
      'settlement_time_precision','unknown','customer_message_sent',false,
      'provider_call_made',false,'payload_redacted',true)
  );
  return receipt.id;
end;
$$;
revoke all on function public.refund_ensure_proved_nayax_api_terminal_receipt(uuid,uuid)
  from public,anon,authenticated,service_role;

-- An API receipt must not disable the one completion message already owned by
-- the succeeded attempt. It cannot authorize any other customer message.
create function public.is_refund_terminal_api_completion_message(p_message jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from jsonb_to_record(p_message) as message(
      id uuid,refund_case_id uuid,nayax_refund_attempt_id uuid,message_type text,
      status text,recipient_email text,template_key text,content_source text,
      delivery_kind text,template_version text,requested_fields text[]
    )
    join public.refund_authoritative_receipts receipt
      on receipt.refund_case_id=message.refund_case_id
      and receipt.nayax_refund_attempt_id=message.nayax_refund_attempt_id
      and receipt.confirmation_source='api_stage_contract'
    join public.refund_cases c on c.id=message.refund_case_id
    join public.refund_case_nayax_refund_attempts attempt
      on attempt.id=message.nayax_refund_attempt_id and attempt.refund_case_id=c.id
    where message.id is not null and message.message_type='completed'
      and message.template_version='refund_nayax_completion_v2'
      and message.template_key='refund_nayax_completed_v2'
      and message.content_source='deterministic_template'
      and message.delivery_kind='manual'
      and cardinality(coalesce(message.requested_fields,'{}'::text[]))=0
      and message.status in ('pending','sent','failed')
      and lower(btrim(message.recipient_email))=lower(btrim(c.customer_email))
      and c.status='completed' and attempt.status='succeeded'
      and attempt.provider_outcome='success' and not attempt.reconciliation_required
      and attempt.reporting_adjustment_id=c.reporting_adjustment_id
      and (attempt.completion_message_id is null
        or attempt.completion_message_id=message.id)
      and not exists(select 1 from public.refund_case_messages other_message
        where other_message.refund_case_id=c.id
          and other_message.message_type='completed'
          and other_message.id<>message.id)
  );
$$;
revoke all on function public.is_refund_terminal_api_completion_message(jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_terminal_api_completion_message_change_allowed(
  p_old jsonb,p_new jsonb
)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    public.is_refund_terminal_api_completion_message(p_old)
    and public.is_refund_terminal_api_completion_message(p_new)
    and case p_old->>'status'
      when 'pending' then p_new->>'status' in ('pending','sent','failed')
      when 'failed' then p_new->>'status' in ('failed','pending')
      when 'sent' then p_new->>'status'='sent'
      else false end
    and jsonb_build_array(
      p_new->'id',p_new->'refund_case_id',p_new->'nayax_refund_attempt_id',
      p_new->'message_type',p_new->'recipient_email',p_new->'subject',p_new->'body',
      p_new->'template_key',p_new->'created_by',p_new->'content_source',
      p_new->'delivery_kind',p_new->'template_version',p_new->'requested_fields',
      p_new->'created_at')
      is not distinct from
      jsonb_build_array(
        p_old->'id',p_old->'refund_case_id',p_old->'nayax_refund_attempt_id',
        p_old->'message_type',p_old->'recipient_email',p_old->'subject',p_old->'body',
        p_old->'template_key',p_old->'created_by',p_old->'content_source',
        p_old->'delivery_kind',p_old->'template_version',p_old->'requested_fields',
        p_old->'created_at'),
    false
  );
$$;
revoke all on function public.refund_terminal_api_completion_message_change_allowed(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_terminal_api_completion_has_sent_gmail_proof(
  p_attempt jsonb
)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(exists(
    select 1
    from jsonb_to_record(p_attempt) as attempt(
      id uuid,refund_case_id uuid,completion_message_id uuid,
      completion_gmail_thread_id uuid,completion_manager_cc_count integer
    )
    join public.refund_case_messages message
      on message.id=attempt.completion_message_id
      and message.refund_case_id=attempt.refund_case_id
      and message.nayax_refund_attempt_id=attempt.id
    join public.refund_cases c on c.id=attempt.refund_case_id
    join public.refund_gmail_messages outbound
      on outbound.operation_key='refund-case-message:'||message.id::text
      and outbound.refund_case_id=c.id
      and outbound.refund_case_message_id=message.id
      and outbound.gmail_thread_id=attempt.completion_gmail_thread_id
    where public.is_refund_terminal_api_completion_message(to_jsonb(message))
      and message.status='sent' and message.sent_at is not null
      and outbound.direction='outbound' and outbound.message_kind='message'
      and outbound.status='sent' and outbound.sent_at is not null
      and nullif(btrim(outbound.provider_message_id),'') is not null
      and outbound.delivery_kind='manual'
      and outbound.recipient_resolution_status='resolved'
      and lower(btrim(outbound.recipient_email))=lower(btrim(message.recipient_email))
      and outbound.plain_body=message.body
      and outbound.subject=message.subject
      and outbound.recipient_cc_count between 1 and 3
      and cardinality(outbound.recipient_cc_emails)=outbound.recipient_cc_count
      and attempt.completion_manager_cc_count=outbound.recipient_cc_count
      and outbound.recipient_cc_count=(select count(distinct lower(btrim(manager.manager_email)))::integer
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id=c.reporting_machine_id
          and manager.status='active' and manager.revoked_at is null)
      and not exists(select 1
        from public.reporting_machine_refund_managers manager
        where manager.reporting_machine_id=c.reporting_machine_id
          and manager.status='active' and manager.revoked_at is null
          and not (lower(btrim(manager.manager_email))=any(outbound.recipient_cc_emails)))
      and not exists(select 1 from unnest(outbound.recipient_cc_emails) cc(email)
        where not exists(select 1
          from public.reporting_machine_refund_managers manager
          where manager.reporting_machine_id=c.reporting_machine_id
            and manager.status='active' and manager.revoked_at is null
            and lower(btrim(manager.manager_email))=lower(btrim(cc.email))))
  ),false);
$$;
revoke all on function public.refund_terminal_api_completion_has_sent_gmail_proof(jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_terminal_api_completion_attempt_change_allowed(
  p_old jsonb,p_new jsonb
)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    p_old->>'id'=p_new->>'id'
    and exists(select 1 from public.refund_authoritative_receipts receipt
      where receipt.nayax_refund_attempt_id=(p_old->>'id')::uuid
        and receipt.refund_case_id=(p_old->>'refund_case_id')::uuid
        and receipt.confirmation_source='api_stage_contract')
    and p_old->>'status'='succeeded' and p_new->>'status'='succeeded'
    and p_old->>'provider_outcome'='success' and p_new->>'provider_outcome'='success'
    and coalesce((p_old->>'reconciliation_required')::boolean,false)=false
    and coalesce((p_new->>'reconciliation_required')::boolean,false)=false
    and case p_old->>'completion_delivery_status'
      when 'not_claimed' then p_new->>'completion_delivery_status'='pending'
      when 'pending' then p_new->>'completion_delivery_status'
        in ('pending','sent','failed','delivery_unknown')
      when 'failed' then p_new->>'completion_delivery_status' in ('failed','pending')
      when 'sent' then p_new->>'completion_delivery_status'='sent'
      when 'delivery_unknown' then p_new->>'completion_delivery_status'='delivery_unknown'
        or (p_new->>'completion_delivery_status'='sent'
          and public.refund_terminal_api_completion_has_sent_gmail_proof(p_new))
      else false end
    and (p_new->>'completion_delivery_retry_count')::integer
      between (p_old->>'completion_delivery_retry_count')::integer and 1
    and nullif(p_new->>'completion_message_id','') is not null
    and exists(select 1 from public.refund_case_messages message
      where message.id=(p_new->>'completion_message_id')::uuid
        and public.is_refund_terminal_api_completion_message(to_jsonb(message)))
    and (p_new - array['completion_message_id','completion_gmail_thread_id',
      'completion_delivery_status','completion_delivery_attempted_at',
      'completion_delivery_retry_count','completion_manager_cc_count']::text[])
      is not distinct from
      (p_old - array['completion_message_id','completion_gmail_thread_id',
        'completion_delivery_status','completion_delivery_attempted_at',
        'completion_delivery_retry_count','completion_manager_cc_count']::text[]),
    false
  );
$$;
revoke all on function public.refund_terminal_api_completion_attempt_change_allowed(jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function public.refund_terminal_receipt_case_change_allowed(
  p_old jsonb,p_new jsonb
)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    nullif(current_setting('bloomjoy.refund_terminal_receipt_case_id',true),'')
      is not null
    and p_old->>'id'=p_new->>'id'
    and exists(select 1
      from public.refund_authoritative_receipts receipt
      join public.refund_case_nayax_refund_attempts attempt
        on attempt.id=receipt.nayax_refund_attempt_id
        and attempt.refund_case_id=receipt.refund_case_id
      where receipt.id=nullif(current_setting(
          'bloomjoy.refund_terminal_receipt_case_id',true),'')::uuid
        and receipt.refund_case_id=(p_old->>'id')::uuid
        and receipt.confirmation_source='dtm_observation'
        and receipt.provider_status=62
        and receipt.current_provider_observation_reviewed
        and receipt.settlement_time_precision='unknown'
        and receipt.settled_at is null
        and receipt.recorded_by=(p_new->>'refund_completed_by')::uuid)
    and p_old->>'status'='card_refund_pending' and p_new->>'status'='completed'
    and p_old->>'decision'='approved' and p_new->>'decision'='approved'
    and nullif(p_old->>'refund_completed_at','') is null
    and nullif(p_new->>'refund_completed_at','') is null
    and nullif(p_old->>'reporting_adjustment_id','') is null
    and nullif(p_new->>'reporting_adjustment_id','') is null
    and p_new->>'automation_state'='completed'
    and p_new->>'nayax_refund_execution_status'='approved'
    and coalesce((p_new->>'nayax_match_execution_eligible')::boolean,false)=false
    and (p_new - array['status','automation_state','automation_follow_up_due_at',
      'refund_completed_by','nayax_refund_execution_status',
      'nayax_match_execution_eligible','official_action_version',
      'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code',
      'lifecycle_integrity_detected_at','updated_at']::text[])
      is not distinct from
      (p_old - array['status','automation_state','automation_follow_up_due_at',
        'refund_completed_by','nayax_refund_execution_status',
        'nayax_match_execution_eligible','official_action_version',
        'lifecycle_revision','lifecycle_integrity_status','lifecycle_integrity_code',
        'lifecycle_integrity_detected_at','updated_at']::text[]),
    false
  );
$$;
revoke all on function public.refund_terminal_receipt_case_change_allowed(jsonb,jsonb)
  from public,anon,authenticated,service_role;

-- Extend only the receipt guard seams needed for terminal case projection and
-- the succeeded attempt's one independent completion delivery.
do $migration$
declare body text; anchor text; replacement text;
begin
  body:=replace(pg_get_functiondef(
    'public.guard_refund_authoritative_receipt_effects()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  if tg_table_name=';
  replacement:=E'begin\n  if tg_table_name=''refund_cases''\n'
    ||E'    and public.refund_terminal_receipt_case_change_allowed(to_jsonb(old),to_jsonb(new)) then\n'
    ||E'    return new;\n  end if;\n'
    ||E'  if tg_table_name=''refund_case_nayax_refund_attempts'' and tg_op=''UPDATE''\n'
    ||E'    and public.refund_terminal_api_completion_attempt_change_allowed(to_jsonb(old),to_jsonb(new)) then\n'
    ||E'    return new;\n  end if;\n'
    ||E'  if tg_table_name=''refund_case_messages'' and tg_op=''INSERT''\n'
    ||E'    and public.is_refund_terminal_api_completion_message(to_jsonb(new)) then\n'
    ||E'    return new;\n  end if;\n'
    ||E'  if tg_table_name=''refund_case_messages'' and tg_op=''UPDATE''\n'
    ||E'    and public.is_refund_terminal_api_completion_message(to_jsonb(old)) then\n'
    ||E'    if public.refund_terminal_api_completion_message_change_allowed(\n'
    ||E'      to_jsonb(old),to_jsonb(new)) then return new; end if;\n'
    ||E'    raise exception ''Confirmed API completion message cannot move backward or change identity''\n'
    ||E'      using errcode=''P4663'';\n  end if;\n  if tg_table_name=';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected authoritative receipt guard shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.guard_refund_case_active_nayax_attempt()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  select pg_get_userbyid(database.datdba)';
  replacement:=E'begin\n  if public.refund_terminal_receipt_case_change_allowed(to_jsonb(old),to_jsonb(new)) then\n'
    ||E'    return new;\n  end if;\n  select pg_get_userbyid(database.datdba)';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected active Nayax attempt guard shape';
  end if;
  execute replace(body,anchor,replacement);

  body:=replace(pg_get_functiondef(
    'public.guard_refund_provider_hold_case_update()'::regprocedure),E'\r\n',E'\n');
  anchor:=E'begin\n  select pg_catalog.pg_get_userbyid(database.datdba)';
  replacement:=E'begin\n  if public.refund_terminal_receipt_case_change_allowed(to_jsonb(old),to_jsonb(new)) then\n'
    ||E'    return new;\n  end if;\n  select pg_catalog.pg_get_userbyid(database.datdba)';
  if cardinality(string_to_array(body,anchor))<>2 then
    raise exception 'Unexpected provider hold case guard shape';
  end if;
  execute replace(body,anchor,replacement);
end;
$migration$;

-- Exact-ID, provider-free recovery for an existing DTM receipt. Payment
-- completion does not depend on an email address or notice-delivery state.
create function public.service_reconcile_terminal_refund_receipt(
  p_case_id uuid,p_receipt_id uuid,p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  c public.refund_cases%rowtype;
  receipt public.refund_authoritative_receipts%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  notice_state text:='not_queued';
  transitioned boolean:=false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id for update;
  select * into receipt from public.refund_authoritative_receipts
    where id=p_receipt_id and refund_case_id=c.id;
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id=p_attempt_id and refund_case_id=c.id for share;
  if c.id is null or receipt.id is null or attempt.id is null
    or receipt.nayax_refund_attempt_id is distinct from attempt.id
    or receipt.reporting_machine_id is distinct from c.reporting_machine_id
    or receipt.original_transaction_id is distinct from c.matched_nayax_transaction_id
    or receipt.original_amount_cents is distinct from c.refund_amount_cents
    or receipt.refunded_amount_cents is distinct from c.refund_amount_cents
    or receipt.currency_code is distinct from 'USD'
    or receipt.provider_status is distinct from 62
    or receipt.confirmation_source is distinct from 'dtm_observation'
    or not receipt.current_provider_observation_reviewed
    or receipt.settlement_time_precision is distinct from 'unknown'
    or receipt.settled_at is not null then
    raise exception 'Exact immutable terminal receipt required' using errcode='P4671';
  end if;
  if c.status='completed' and c.decision='approved'
    and c.refund_completed_at is null and c.reporting_adjustment_id is null then
    null;
  elsif c.status='card_refund_pending' and c.decision='approved'
    and c.refund_completed_at is null and c.reporting_adjustment_id is null then
    perform set_config('bloomjoy.refund_terminal_receipt_case_id',
      receipt.id::text,true);
    update public.refund_cases set
      status='completed',automation_state='completed',automation_follow_up_due_at=null,
      refund_completed_by=receipt.recorded_by,refund_completed_at=null,
      nayax_refund_execution_status='approved',nayax_match_execution_eligible=false
    where id=c.id;
    transitioned:=true;
    insert into public.refund_case_events(
      refund_case_id,actor_user_id,event_type,message,metadata
    ) values (
      c.id,receipt.recorded_by,'terminal_refund_receipt_reconciled',
      'Payment confirmation completed the case; settlement time and accounting date remain unknown.',
      jsonb_build_object('receipt_id',receipt.id,'attempt_id',attempt.id,
        'confirmation_source','dtm_observation','accounting_state','pending',
        'provider_call_made',false,'customer_message_sent',false,
        'payload_redacted',true)
    );
  else
    raise exception 'Receipt does not match a supported terminal case state'
      using errcode='P4671';
  end if;
  select case
    when exists(select 1 from public.refund_completion_notice_adoptions adoption
      where adoption.receipt_id=receipt.id) then 'sent'
    when exists(select 1 from public.refund_external_notice_observations observation
      where observation.receipt_id=receipt.id) then 'sent'
    else coalesce((
      select case
        when message.delivery_transport='resend' then message.delivery_state
        when message.manual_delivery_state='sent' then 'sent'
        when message.manual_delivery_state in ('queued','claimed') then 'pending'
        else message.manual_delivery_state end
      from public.refund_receipt_completion_intents intent
      join public.refund_case_messages message on message.id=intent.message_id
      where intent.receipt_id=receipt.id
    ),'not_queued') end
  into notice_state;
  return jsonb_build_object(
    'status',case when transitioned then 'reconciled' else 'already_reconciled' end,
    'caseCompleted',true,'accountingState','pending','noticeState',notice_state,
    'providerCallMade',false,'customerMessageSent',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reconcile_terminal_refund_receipt(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_reconcile_terminal_refund_receipt(uuid,uuid,uuid)
  to service_role;

-- Exact successful request-and-approve journal evidence can be adopted after
-- an integration interruption. This records only the receipt and never calls
-- Nayax, creates an adjustment, or sends/duplicates a customer notice.
create function public.service_reconcile_proved_nayax_api_terminal(
  p_case_id uuid,p_attempt_id uuid
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  receipt_id:=public.refund_ensure_proved_nayax_api_terminal_receipt(
    p_case_id,p_attempt_id);
  return jsonb_build_object('status','receipt_recorded','caseCompleted',true,
    'accountingState','applied','receiptId',receipt_id,
    'providerCallMade',false,'customerMessageSent',false,'payloadRedacted',true);
end;
$$;
revoke all on function public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.service_reconcile_proved_nayax_api_terminal(uuid,uuid)
  to service_role;

-- Record exact API payment truth at settlement. A receipt integration failure
-- cannot roll back an already-recorded provider outcome; the exact recovery RPC
-- can replay the immutable evidence without payment access.
alter function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) rename to service_settle_nayax_refund_attempt_pre_terminal_receipt_v1;
revoke all on function public.service_settle_nayax_refund_attempt_pre_terminal_receipt_v1(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
create function public.service_settle_nayax_refund_attempt(
  p_executor_assertion text,p_attempt_id uuid,p_authorization_id uuid,p_case_id uuid,
  p_idempotency_key text,p_amount_cents integer,p_currency_code text,
  p_provider_claim_token text,p_provider_outcome text,p_provider_reference text,
  p_provider_status text,p_error_code text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; receipt_id uuid;
begin
  result:=public.service_settle_nayax_refund_attempt_pre_terminal_receipt_v1(
    p_executor_assertion,p_attempt_id,p_authorization_id,p_case_id,p_idempotency_key,
    p_amount_cents,p_currency_code,p_provider_claim_token,p_provider_outcome,
    p_provider_reference,p_provider_status,p_error_code);
  if public.refund_nayax_api_terminal_evidence_proved(p_case_id,p_attempt_id) then
    begin
      receipt_id:=public.refund_ensure_proved_nayax_api_terminal_receipt(
        p_case_id,p_attempt_id);
      result:=result||jsonb_build_object('terminalReceiptRecorded',true);
    exception when others then
      insert into public.refund_case_events(
        refund_case_id,event_type,message,metadata
      ) values (
        p_case_id,'terminal_refund_receipt_recording_deferred',
        'Exact API payment outcome remains final; terminal receipt recording requires provider-free reconciliation.',
        jsonb_build_object('attempt_id',p_attempt_id,'provider_call_made',false,
          'payload_redacted',true)
      );
      result:=result||jsonb_build_object('terminalReceiptRecorded',false,
        'terminalReceiptRecording','deferred');
    end;
  end if;
  return result;
end;
$$;
revoke all on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.service_settle_nayax_refund_attempt(
  text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text
) to service_role;

-- Permit only the API receipt's exact v2 completion through the existing Gmail
-- claim. The canonical receipt-v1 path retains its version and identity checks.
create or replace function public.service_claim_refund_gmail_outbound_v3(
  p_refund_case_id uuid,p_refund_case_message_id uuid,p_operation_key text,p_sender_email text,
  p_recipient_email text,p_plain_body text,p_mailbox_identities text[],p_delivery_kind text,
  p_target_gmail_thread_id uuid default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.refund_case_messages%rowtype; case_version bigint;
  receipt_message boolean:=false; api_message boolean:=false;
begin
  select official_action_version into case_version from public.refund_cases
    where id=p_refund_case_id for update;
  perform public.assert_no_active_refund_owner_resolution(p_refund_case_id);
  if exists(select 1 from public.refund_authoritative_receipts
    where refund_case_id=p_refund_case_id) then
    select * into m from public.refund_case_messages
      where id=p_refund_case_message_id and refund_case_id=p_refund_case_id;
    receipt_message:=m.id is not null
      and public.is_refund_receipt_completion_message(to_jsonb(m));
    api_message:=m.id is not null
      and public.is_refund_terminal_api_completion_message(to_jsonb(m));
    if not (receipt_message or api_message) then
      raise exception 'Authoritative receipt forbids customer resend; use the one bound completion'
        using errcode='P4663';
    end if;
    if receipt_message and (
      m.manual_delivery_expected_case_version is distinct from case_version
      or p_plain_body is distinct from m.body
      or p_delivery_kind is distinct from m.delivery_kind
    ) then
      raise exception 'Receipt completion transport identity changed' using errcode='P4664';
    end if;
    if api_message and (
      p_delivery_kind is distinct from m.delivery_kind
      or p_plain_body is distinct from m.body
      or p_target_gmail_thread_id is distinct from (
        select attempt.completion_gmail_thread_id
        from public.refund_case_nayax_refund_attempts attempt
        where attempt.id=m.nayax_refund_attempt_id)
    ) then
      raise exception 'API completion transport identity changed' using errcode='P4664';
    end if;
    if p_operation_key is distinct from 'refund-case-message:'||m.id::text
      or lower(btrim(p_recipient_email)) is distinct from lower(btrim(m.recipient_email)) then
      raise exception 'Receipt completion transport identity changed' using errcode='P4664';
    end if;
  end if;
  return public.service_claim_refund_gmail_outbound_pre_receipt_v1(
    p_refund_case_id,p_refund_case_message_id,p_operation_key,p_sender_email,p_recipient_email,
    p_plain_body,p_mailbox_identities,p_delivery_kind,p_target_gmail_thread_id);
end;
$$;
revoke all on function public.service_claim_refund_gmail_outbound_v3(
  uuid,uuid,text,text,text,text,text[],text,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.service_claim_refund_gmail_outbound_v3(
  uuid,uuid,text,text,text,text,text[],text,uuid
) to service_role;

-- API-confirmed receipts already own the normal v2 completion message. Keep
-- the receipt-v1 review and queue controls out of that overview so the manager
-- client cannot offer a second notice path or parse nullable DTM-only copy.
alter function public.admin_get_refund_authoritative_receipt_overview(uuid)
  rename to admin_get_refund_receipt_overview_pre_terminal_api_v1;
revoke all on function public.admin_get_refund_receipt_overview_pre_terminal_api_v1(uuid)
  from public,anon,authenticated,service_role;
create function public.admin_get_refund_authoritative_receipt_overview(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;
begin
  base:=public.admin_get_refund_receipt_overview_pre_terminal_api_v1(p_case_id);
  if base->>'attemptBindingKind' is distinct from 'proved_terminal_api' then
    return base;
  end if;
  return base-'completionNotice'-'historicalOwnerNoticeAvailable'
    -'historicalOwnerNoticeCutoff'-'historicalOwnerReviewBinding'
    ||jsonb_build_object('noticeChoices','[]'::jsonb);
end;
$$;
revoke all on function public.admin_get_refund_authoritative_receipt_overview(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.admin_get_refund_authoritative_receipt_overview(uuid)
  to authenticated;

-- API-confirmed receipts keep the normal v2 completion-message lifecycle. The
-- receipt proves payment independently; it must not replace sent, queued, or
-- failed delivery state with the receipt-v1 accounting-review queue.
alter function public.refund_lifecycle_contract(uuid)
  rename to refund_lifecycle_contract_pre_terminal_reconciliation_v1;
revoke all on function public.refund_lifecycle_contract_pre_terminal_reconciliation_v1(uuid)
  from public,anon,authenticated,service_role;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  base jsonb;
  delivery_base jsonb;
  receipt public.refund_authoritative_receipts%rowtype;
  attempt public.refund_case_nayax_refund_attempts%rowtype;
  completion_message public.refund_case_messages%rowtype;
  adjustment_fact public.sales_adjustment_facts%rowtype;
  unsent_pending boolean:=false;
  sent_complete boolean:=false;
begin
  base:=public.refund_lifecycle_contract_pre_terminal_reconciliation_v1(p_refund_case_id);
  select * into receipt from public.refund_authoritative_receipts
    where refund_case_id=p_refund_case_id;
  if receipt.id is null or receipt.confirmation_source<>'api_stage_contract' then
    return base;
  end if;
  select fact.* into adjustment_fact
  from public.refund_cases c
  join public.sales_adjustment_facts fact
    on fact.id=c.reporting_adjustment_id and fact.refund_case_id=c.id
  where c.id=p_refund_case_id;
  if adjustment_fact.id is null then return base; end if;
  delivery_base:=public.refund_lifecycle_contract_pre_authoritative_receipt_v1(
    p_refund_case_id
  );
  select * into attempt from public.refund_case_nayax_refund_attempts
    where id=receipt.nayax_refund_attempt_id and refund_case_id=p_refund_case_id;
  select * into completion_message from public.refund_case_messages
    where id=attempt.completion_message_id and refund_case_id=p_refund_case_id;
  unsent_pending:=attempt.id is not null and completion_message.id is not null
    and public.is_refund_terminal_api_completion_message(to_jsonb(completion_message))
    and attempt.completion_delivery_status='pending'
    and completion_message.status='pending'
    and completion_message.delivery_transport is null
    and completion_message.manual_delivery_provider_attempted_at is null
    and not exists(select 1 from public.refund_gmail_messages gmail_message
      where gmail_message.refund_case_message_id=completion_message.id);
  sent_complete:=attempt.id is not null and completion_message.id is not null
    and public.is_refund_terminal_api_completion_message(to_jsonb(completion_message))
    and attempt.completion_delivery_status='sent'
    and completion_message.status='sent';
  if unsent_pending then
    delivery_base:=delivery_base||jsonb_build_object(
      'managerAction',jsonb_build_object('action','wait_for_customer_notification',
        'owner','Machine Manager','safeRetryEligible',false,'payloadRedacted',true),
      'managerNextAction','wait_for_customer_notification',
      'managerQueue',jsonb_build_object('schemaVersion','refund_manager_queue_v2',
        'bucket','in_progress','label','In progress',
        'nextAction','wait_for_customer_notification','safeRetryEligible',false,
        'customerActionFields','[]'::jsonb,'payloadRedacted',true),
      'operations',(delivery_base->'operations')||jsonb_build_object(
        'required',false,'ageMinutes',null,'dueAt',null,'slaBreached',false,
        'failureClass',null,'nextStep',null));
  elsif sent_complete then
    delivery_base:=delivery_base||jsonb_build_object(
      'reasonCode','completion_sent',
      'messageState',(delivery_base->'messageState')||jsonb_build_object('state','sent'),
      'managerAction',jsonb_build_object('action','none','owner','Machine Manager',
        'safeRetryEligible',false,'payloadRedacted',true),
      'managerNextAction','none',
      'managerQueue',jsonb_build_object('schemaVersion','refund_manager_queue_v2',
        'bucket','completed','label','Done','nextAction','none',
        'safeRetryEligible',false,'customerActionFields','[]'::jsonb,
        'payloadRedacted',true),
      'operations',(delivery_base->'operations')||jsonb_build_object(
        'required',false,'ageMinutes',null,'dueAt',null,'slaBreached',false,
        'failureClass',null,'nextStep',null),
      'terminal',true,'refreshAfterSeconds',null);
  end if;
  return base||jsonb_build_object(
      'stage',delivery_base->'stage',
      'stageRank',delivery_base->'stageRank',
      'reasonCode',delivery_base->'reasonCode',
      'paymentState',delivery_base->'paymentState',
      'messageState',delivery_base->'messageState',
      'managerAction',delivery_base->'managerAction',
      'managerNextAction',delivery_base->'managerNextAction',
      'managerQueue',delivery_base->'managerQueue',
      'operations',delivery_base->'operations',
      'publicCopyKey',delivery_base->'publicCopyKey',
      'lastUpdatedAt',delivery_base->'lastUpdatedAt',
      'terminal',delivery_base->'terminal',
      'refreshAfterSeconds',delivery_base->'refreshAfterSeconds',
      'paymentWorkComplete',true,
      'accountingState',jsonb_build_object('state','applied','owner','Refund Operations',
        'accountingDate',adjustment_fact.adjustment_date,
        'settlementTimePrecision','unknown','settledAt',null,
        'blocksPaymentCompletion',false,'blocksCustomerNotice',false,
        'payloadRedacted',true));
end;
$$;
revoke all on function public.refund_lifecycle_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

comment on function public.service_reconcile_terminal_refund_receipt(uuid,uuid,uuid) is
  'Service-only exact-ID provider-free completion for one existing DTM receipt; contact and notice state are independent.';
comment on function public.service_reconcile_proved_nayax_api_terminal(uuid,uuid) is
  'Service-only exact-ID provider-free adoption of immutable successful request-and-approve journal evidence; never invokes Nayax or sends a notice.';

select pg_notify('pgrst','reload schema');
