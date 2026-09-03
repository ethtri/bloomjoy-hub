-- Extend the existing correction capabilities; the case and message ledger
-- remain authoritative. Existing wallet links keep their original contract.
alter table public.refund_wallet_correction_contexts
  add column correction_kind text not null default 'wallet' check (correction_kind in ('wallet','purchase')),
  add column correction_message_id uuid references public.refund_case_messages(id),
  add column correction_fact_version bigint,
  add column correction_requested_fields text[],
  add column correction_snapshot jsonb,
  add column correction_response jsonb,
  add column correction_resulting_fact_version bigint,
  add column correction_next_action text check (correction_next_action in ('review','recheck')),
  add column correction_recheck_state text check (correction_recheck_state in ('pending','completed','failed','not_ready','stale','in_progress'));
create unique index refund_correction_message_unique
  on public.refund_wallet_correction_contexts(correction_message_id)
  where correction_message_id is not null;

-- Confidence is a matching fact, including a correction to the same clock time.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.guard_refund_deterministic_fact_version()'::regprocedure);
  if position('or new.incident_time_confidence is distinct from old.incident_time_confidence' in definition)=0 then
    if position('or new.incident_time_resolution is distinct from old.incident_time_resolution' in definition)=0 then raise exception 'Fact-version confidence anchor missing'; end if;
    definition:=replace(definition,'or new.incident_time_resolution is distinct from old.incident_time_resolution',
      'or new.incident_time_resolution is distinct from old.incident_time_resolution
    or new.incident_time_confidence is distinct from old.incident_time_confidence');
    execute definition;
  end if;
end;
$$;
create trigger refund_cases_guard_time_confidence_fact_version
before update of incident_time_confidence on public.refund_cases for each row
when (new.incident_time_confidence is distinct from old.incident_time_confidence)
execute function public.guard_refund_deterministic_fact_version();

create function public.refund_purchase_correction_eligible(p_case public.refund_cases)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_case.case_population = 'customer'
    and (p_case.status in ('draft','needs_review','waiting_on_customer') or (p_case.status='cash_zelle_pending' and p_case.decision='approved' and p_case.payment_method='cash'))
    and (p_case.decision is null or (p_case.decision='approved' and p_case.payment_method='cash'
      and nullif(btrim(p_case.zelle_payment_contact),'') is null))
    and p_case.nayax_refund_execution_status in ('not_requested','ready','disabled','failed','declined')
    and not exists (select 1 from public.refund_authoritative_receipts r where r.refund_case_id=p_case.id)
    and not exists (select 1 from public.refund_case_nayax_refund_attempts a
      where a.refund_case_id=p_case.id and (a.reconciliation_required or a.status in ('in_progress','requested','approved','ambiguous','manual_review')));
$$;

-- Shared request eligibility for the manager action and existing send ledger.
-- Candidate values never become customer-visible; only names of disputed facts.
create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare c public.refund_cases; fields text[]; evidence jsonb; reasons text[]; exclusions text[];
begin
  select * into c from public.refund_cases where id=p_case_id;
  if c.id is null or not public.refund_purchase_correction_eligible(c) then return '{}'::text[]; end if;
  fields := case when c.decision='approved' then array['zelle_payment_contact']::text[] else public.refund_missing_follow_up_fields(c.id) end;
  if c.decision is null then
  -- A mapped public selection with an unresolved internal binding belongs to
  -- Operations. Do not ask the customer to supply machine/account identifiers.
  if c.intake_selection_key is not null then fields := array_remove(fields,'location_or_machine'); end if;
  if c.payment_method='card' and c.card_wallet_used then
    if c.card_last4 is null or c.card_last4_provenance is distinct from 'wallet_device_token' then fields := array_append(fields,'card_last4'); end if;
    if c.payment_interaction is distinct from 'phone_watch_wallet' then fields := array_append(fields,'payment_interaction'); end if;
    if c.wallet_provider is null or c.wallet_provider='unsure' then fields := array_append(fields,'wallet_provider'); end if;
  end if;
  if c.nayax_recommendation_state in ('manual_exception','no_safe_match')
    and c.nayax_lookup_status in ('manual_exception','no_match')
    and c.nayax_recommendation_evaluated_at>=c.deterministic_facts_updated_at then
    select candidate.evidence_summary into evidence from public.refund_nayax_lookup_candidates candidate
      where candidate.refund_case_id=c.id and candidate.lookup_generation=c.nayax_lookup_generation
        and candidate.expires_at>statement_timestamp()
      order by (candidate.evidence_summary->>'is_top_ranked'='true') desc nulls last,candidate.created_at desc limit 1;
    select coalesce(array_agg(value),'{}') into reasons from jsonb_array_elements_text(
      coalesce(evidence->'reason_codes','[]') || coalesce(evidence->'manual_review_reasons','[]') || coalesce(evidence->'hard_exclusions','[]'));
    select coalesce(array_agg(value),'{}') into exclusions from jsonb_array_elements_text(coalesce(evidence->'hard_exclusions','[]'));
    if not reasons && array['already_refunded','currency_not_usd','duplicate_provider_record','duplicate_transaction','missing_amount_evidence',
      'missing_canonical_machine_mapping','missing_currency_evidence','missing_provider_card_last4','missing_provider_machine_id',
      'missing_provider_site_id','payment_not_approved','provider_machine_mismatch','provider_status_unconfirmed']::text[]
      and array_remove(exclusions,'card_last4_mismatch')='{}'::text[] then
      if 'card_last4_mismatch'=any(reasons) then fields:=array_append(fields,'card_last4'); end if;
      if reasons && array['amount_mismatch','amount_uncertain']::text[] then fields:=array_append(fields,'amount'); end if;
      if reasons && array['incident_time_too_far','customer_time_rough']::text[] then fields:=array_append(fields,'incident_time'); end if;
    end if;
  end if;
  end if;
  -- One answered request ends that customer task. An unchanged/unknown answer
  -- or an unsuccessful bounded recheck is internal work, not the same question.
  fields := array(select unnest(fields) except select answer.key
    from public.refund_wallet_correction_contexts r cross join lateral jsonb_each(r.correction_response) answer
    where r.refund_case_id=c.id and r.status='submitted' and r.correction_kind='purchase'
      -- An unrelated Operations correction must not reopen an answered question.
      and public.refund_purchase_correction_values(c)->>answer.key is not distinct from
        coalesce(answer.value->>'value',r.correction_snapshot->>answer.key)
      and (answer.key not in ('card_last4','wallet_provider','card_network') or (
        public.refund_purchase_correction_values(c)->>'payment_method' is not distinct from r.correction_snapshot->>'payment_method'
        and public.refund_purchase_correction_values(c)->>'payment_interaction' is not distinct from r.correction_snapshot->>'payment_interaction')));
  return public.canonical_refund_follow_up_fields(fields);
end;
$$;
revoke all on function public.refund_purchase_correction_request_fields(uuid) from public,anon,authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid) to service_role;

create function public.refund_purchase_correction_values(p_case public.refund_cases)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'location_or_machine', (select choice.display_label from public.public_refund_selections() choice
      where choice.selection_key=coalesce(p_case.intake_selection_key,public.refund_public_selection_key('machine|'||p_case.reporting_machine_id::text)) limit 1),
    'incident_date', nullif(left(p_case.incident_local_datetime,10),''),
    'incident_time', case when p_case.incident_time_resolution in ('exact','legacy_absolute') then nullif(substring(p_case.incident_local_datetime from 12 for 5),'') end,
    'payment_method', case when p_case.payment_method in ('card','cash') then p_case.payment_method end,
    'payment_interaction', nullif(p_case.payment_interaction,'unsure'),
    'wallet_provider', nullif(p_case.wallet_provider,'unsure'),
    'amount', case when p_case.payment_amount_cents>0 then to_char(p_case.payment_amount_cents::numeric/100,'FM999990.00') end,
    'card_last4', p_case.card_last4,
    'card_network', p_case.card_network,
    'zelle_payment_contact', p_case.zelle_payment_contact
  ));
$$;

create function public.service_issue_refund_purchase_correction(
  p_message_id uuid, p_token_hash text, p_expected_fact_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.refund_cases; m public.refund_case_messages; r public.refund_wallet_correction_contexts;
  next_version integer; fields text[];
begin
  select * into m from public.refund_case_messages where id=p_message_id;
  select * into c from public.refund_cases where id=m.refund_case_id for update;
  if c.id is null or not public.refund_purchase_correction_eligible(c)
    or c.deterministic_fact_version is distinct from p_expected_fact_version
    or m.recipient_email is distinct from c.customer_email
    or m.status not in ('pending','sent')
    or m.message_type not in ('more_info','no_safe_match','wallet_correction','reminder','wallet_correction_reminder')
    or coalesce(p_token_hash,'') !~ '^[a-f0-9]{64}$' then
    raise exception 'Correction request is not current or eligible';
  end if;
  fields := public.canonical_refund_follow_up_fields(m.requested_fields);
  if cardinality(fields)=0 or ('zelle_payment_contact'=any(fields) and fields<>array['zelle_payment_contact']::text[]) then
    raise exception 'Specific purchase fields are required';
  end if;
  if not fields <@ public.refund_purchase_correction_request_fields(c.id) then
    raise exception 'The requested customer fields are no longer supported by current evidence';
  end if;
  select * into r from public.refund_wallet_correction_contexts where correction_message_id=m.id;
  if r.id is not null then
    if r.token_hash is distinct from p_token_hash then raise exception 'Request capability changed'; end if;
    return jsonb_build_object('requestId',r.id,'state',r.status,'expiresAt',r.expires_at);
  end if;
  update public.refund_wallet_correction_contexts set status='expired',updated_at=statement_timestamp()
    where refund_case_id=c.id and status='pending' and expires_at<=statement_timestamp();
  update public.refund_wallet_correction_contexts ctx set status='revoked',revoked_at=statement_timestamp(),updated_at=statement_timestamp()
    where ctx.refund_case_id=c.id and ctx.status='pending' and ctx.correction_kind='purchase' and exists(
      select 1 from public.refund_case_messages failed where failed.id=ctx.correction_message_id and failed.status='failed'
        and (failed.sent_at is null
          and failed.provider_message_id is null and failed.manual_delivery_provider_attempted_at is null and failed.delivery_transport is null
          and not exists(select 1 from public.refund_gmail_messages outbound where outbound.refund_case_message_id=failed.id)));
  if exists(select 1 from public.refund_wallet_correction_contexts where refund_case_id=c.id and status='pending') then
    raise exception 'A correction request is already active';
  end if;
  -- Infrastructure failure before transport does not spend a customer contact.
  select count(*)+1 into next_version from public.refund_wallet_correction_contexts ctx
    where ctx.refund_case_id=c.id and not exists(
      select 1 from public.refund_case_messages failed where failed.id=ctx.correction_message_id and failed.status='failed'
        and failed.sent_at is null and failed.provider_message_id is null and failed.manual_delivery_provider_attempted_at is null
        and failed.delivery_transport is null and not exists(select 1 from public.refund_gmail_messages outbound where outbound.refund_case_message_id=failed.id));
  if next_version>2 then raise exception 'Correction link limit reached'; end if;
  insert into public.refund_wallet_correction_contexts(refund_case_id,token_hash,version,expires_at,
    correction_kind,correction_message_id,correction_fact_version,correction_requested_fields,correction_snapshot)
  values(c.id,p_token_hash,next_version,statement_timestamp()+interval '48 hours',
    'purchase',m.id,c.deterministic_fact_version,fields,public.refund_purchase_correction_values(c)) returning * into r;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values(c.id,'purchase_correction_prepared','A scoped correction request was prepared for the existing customer message.',
    jsonb_build_object('request_id',r.id,'requested_fields',fields,'fact_version',c.deterministic_fact_version,'payload_redacted',true));
  -- Preparing a link does not mean an email was delivered or change ownership.
  return jsonb_build_object('requestId',r.id,'state',r.status,'expiresAt',r.expires_at);
end;
$$;

create function public.service_get_refund_purchase_correction(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts;
begin
  select * into r from public.refund_wallet_correction_contexts where token_hash=p_token_hash and correction_kind='purchase';
  if r.id is null then return jsonb_build_object('state','unavailable'); end if;
  select * into c from public.refund_cases where id=r.refund_case_id;
  if r.status='submitted' then return jsonb_build_object('state','received','publicReference',c.public_reference,'nextAction',r.correction_next_action); end if;
  if r.status<>'pending' or r.expires_at<=statement_timestamp()
    or not public.refund_purchase_correction_eligible(c)
    or not exists(select 1 from public.refund_case_messages m where m.id=r.correction_message_id
      and m.refund_case_id=c.id and m.recipient_email=c.customer_email and m.status='sent'
      and coalesce(m.delivery_state,'') not in ('failed','bounced','complained')
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)))
    or c.deterministic_fact_version is distinct from r.correction_fact_version then
    return jsonb_build_object('state','unavailable');
  end if;
  return jsonb_build_object('state','ready','publicReference',c.public_reference,
    'version',r.correction_fact_version,'locale',case when c.intake_meta->>'customer_locale'='es' then 'es' else 'en' end,
    'requestedFields',r.correction_requested_fields,'allowedFields',case when r.correction_requested_fields=array['zelle_payment_contact']::text[] then array['zelle_payment_contact']::text[] else array['location_or_machine','incident_date','incident_time','payment_method','payment_interaction','wallet_provider','amount','card_last4','card_network']::text[] end,
    'locationChoices',(select coalesce(jsonb_agg(jsonb_build_object('key',selection_key,'label',display_label)),'[]') from public.public_refund_selections()),
    'values',r.correction_snapshot,'timezone',c.incident_timezone,'expiresAt',r.expires_at);
end;
$$;

create function public.service_submit_refund_purchase_correction(p_token_hash text,p_expected_fact_version bigint,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts; next_case public.refund_cases;
  field text; answer jsonb; disposition text; value text; vals jsonb; unknown_fields text[] := '{}'; changed_fields text[] := '{}';
  needs_human boolean := false; local_date text; local_time text; local_stamp timestamp; instant timestamptz; selection jsonb; payout_only boolean;
begin
  -- Lock the case before the capability consistently with issuance.
  select c0.* into c from public.refund_cases c0 join public.refund_wallet_correction_contexts r0 on r0.refund_case_id=c0.id
    where r0.token_hash=p_token_hash and r0.correction_kind='purchase' for update of c0;
  select * into r from public.refund_wallet_correction_contexts where token_hash=p_token_hash and correction_kind='purchase' for update;
  if r.id is null then raise exception 'Correction link unavailable'; end if;
  if r.status='submitted' then return jsonb_build_object('state','received','publicReference',c.public_reference,'nextAction',r.correction_next_action); end if;
  if r.status<>'pending' or r.expires_at<=statement_timestamp() or not public.refund_purchase_correction_eligible(c)
    or not exists(select 1 from public.refund_case_messages m where m.id=r.correction_message_id
      and m.refund_case_id=c.id and m.recipient_email=c.customer_email and m.status='sent'
      and coalesce(m.delivery_state,'') not in ('failed','bounced','complained')
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)))
    or r.correction_fact_version is distinct from p_expected_fact_version or c.deterministic_fact_version is distinct from p_expected_fact_version then
    raise exception 'Correction link is stale or unavailable';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' or not p_answers ?& r.correction_requested_fields then raise exception 'Requested answers required'; end if;
  payout_only := r.correction_requested_fields=array['zelle_payment_contact']::text[];
  vals := r.correction_snapshot;
  for field,answer in select * from jsonb_each(p_answers) loop
    disposition := answer->>'disposition'; value := btrim(answer->>'value');
    if field not in ('location_or_machine','incident_date','incident_time','payment_method','payment_interaction','wallet_provider','amount','card_last4','card_network','zelle_payment_contact')
      or (payout_only and field<>'zelle_payment_contact') or (not payout_only and field='zelle_payment_contact')
      or jsonb_typeof(answer) is distinct from 'object'
      or disposition is null or disposition not in ('changed','confirmed','cannot_provide')
      or exists(select 1 from jsonb_object_keys(answer) k where k not in ('value','disposition','confidence')) then raise exception 'Unsupported correction answer'; end if;
    if answer ? 'confidence' and (field<>'incident_time' or disposition<>'changed' or answer->>'confidence' not in ('exact','within_15_minutes','within_1_hour','rough')) then raise exception 'Invalid time confidence'; end if;
    if disposition='confirmed' then
      if answer ? 'value' or nullif(vals->>field,'') is null then raise exception 'Missing values cannot be confirmed'; end if;
    elsif disposition='cannot_provide' then
      if answer ? 'value' then raise exception 'Unknown answers cannot contain values'; end if;
      unknown_fields := array_append(unknown_fields,field); needs_human := true;
    else
      if jsonb_typeof(answer->'value') is distinct from 'string' or coalesce(value,'')='' or length(value)>(case when field='zelle_payment_contact' then 320 else 160 end) then raise exception 'Invalid correction value'; end if;
      if field='zelle_payment_contact' and not (value ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or regexp_replace(value,'[[:space:]().-]','','g') ~ '^\+?[0-9]{10,15}$') then raise exception 'Invalid payout contact'; end if;
      if field='card_last4' and value !~ '^[0-9]{4}$'
        or field='amount' and (value !~ '^[0-9]{1,5}(\.[0-9]{1,2})?$' or value::numeric<=0)
        or field='incident_date' and value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        or field='incident_time' and value !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        or field='payment_method' and value not in ('card','cash')
        or field='payment_interaction' and value not in ('tap_card','insert_or_swipe','phone_watch_wallet','cash')
        or field='wallet_provider' and value not in ('apple_pay','google_wallet','other')
        or field='card_network' and value not in ('visa','mastercard','discover','american_express','other_unknown') then raise exception 'Invalid correction value'; end if;
      if vals->>field is distinct from value then
        changed_fields := array_append(changed_fields,field); vals := jsonb_set(vals,array[field],to_jsonb(value));
      end if;
    end if;
  end loop;
  next_case := c;
  if payout_only then
    update public.refund_cases set zelle_payment_contact=case when 'zelle_payment_contact'=any(changed_fields) then vals->>'zelle_payment_contact' else c.zelle_payment_contact end,
      status='needs_review',automation_state='customer_replied',automation_follow_up_due_at=null where id=c.id returning * into next_case;
    update public.refund_payout_destination_follow_ups set status='manual_review',manual_review_at=statement_timestamp(),
      reminder_claim_token=null,updated_at=statement_timestamp() where refund_case_id=c.id and status in ('waiting','reminder_claimed','reminder_sent');
    needs_human:=true;
  else
  if 'location_or_machine'=any(changed_fields) then
    -- Resolve only the same opaque public choice used at intake. Internal
    -- machine/manager identifiers never come from customer input.
    selection := public.service_resolve_refund_public_selection(vals->>'location_or_machine');
    if c.refund_qr_claim_context_id is not null then
      -- Keep the original QR proof immutable. Operations resolves the reported
      -- different public choice from this saved response, without asking again.
      needs_human:=true;
    else
    next_case.reporting_location_id := (selection->>'locationId')::uuid;
    next_case.intake_selection_key := selection->>'selectionKey';
    next_case.intake_selection_kind := selection->>'selectionKind';
    next_case.intake_selection_machine_ids := array(select jsonb_array_elements_text(selection->'machineIds')::uuid);
    next_case.reporting_machine_id := case when selection->>'selectionKind'='exact_machine' then next_case.intake_selection_machine_ids[1] end;
    next_case.incident_timezone := selection->>'locationTimezone';
    if next_case.reporting_machine_id is null then needs_human:=true; end if;
    end if;
  end if;
  if 'amount'=any(changed_fields) then next_case.payment_amount_cents := round((vals->>'amount')::numeric*100); end if;
  if 'payment_method'=any(changed_fields) then
    next_case.payment_method := vals->>'payment_method';
    next_case.card_last4 := null; next_case.card_last4_provenance := null; next_case.card_network := null;
    next_case.card_wallet_used := false; next_case.wallet_provider := null;
    next_case.payment_interaction := case when next_case.payment_method='cash' then 'cash' else 'unsure' end;
  end if;
  if 'payment_interaction'=any(changed_fields) then
    if (vals->>'payment_interaction'='cash') <> (next_case.payment_method='cash') then raise exception 'Payment method and interaction conflict'; end if;
    next_case.payment_interaction := vals->>'payment_interaction';
    next_case.card_wallet_used := next_case.payment_interaction='phone_watch_wallet';
    next_case.card_last4 := null; next_case.card_last4_provenance := null; next_case.wallet_provider := null;
  end if;
  if changed_fields && array['payment_method','payment_interaction']::text[] and next_case.payment_method='card' then
    if not p_answers ? 'card_last4' or (next_case.card_wallet_used and not p_answers ? 'wallet_provider') then raise exception 'Confirm dependent card details or choose cannot provide'; end if;
    if next_case.payment_interaction='unsure' then needs_human:=true; end if;
  end if;
  if 'wallet_provider'=any(changed_fields) or
    ('payment_interaction'=any(changed_fields) and p_answers->'wallet_provider'->>'disposition' in ('confirmed','changed')) then
    if next_case.card_wallet_used is not true then raise exception 'Wallet details require a wallet purchase'; end if;
    next_case.wallet_provider := vals->>'wallet_provider';
  end if;
  if 'card_last4'=any(changed_fields) or
    (changed_fields && array['payment_method','payment_interaction']::text[] and p_answers->'card_last4'->>'disposition' in ('confirmed','changed')) then
    if next_case.payment_method<>'card' or next_case.payment_interaction not in ('tap_card','insert_or_swipe','phone_watch_wallet') then raise exception 'Confirm how the card was used before changing its digits'; end if;
    next_case.card_last4 := vals->>'card_last4';
    next_case.card_last4_provenance := case when next_case.card_wallet_used then 'wallet_device_token' else 'physical_card' end;
  end if;
  if 'card_network'=any(changed_fields) or
    ('payment_method'=any(changed_fields) and p_answers->'card_network'->>'disposition' in ('confirmed','changed')) then
    if next_case.payment_method<>'card' then raise exception 'Card details require a card purchase'; end if;
    next_case.card_network := vals->>'card_network';
  end if;
  if p_answers->'incident_time'->>'disposition'='changed' then
    next_case.incident_time_confidence := coalesce(p_answers->'incident_time'->>'confidence','rough');
    if next_case.incident_time_confidence is distinct from c.incident_time_confidence then changed_fields:=array_append(changed_fields,'incident_time'); end if;
    needs_human := needs_human or next_case.incident_time_confidence='rough';
  end if;
  if changed_fields && array['incident_date','incident_time','location_or_machine']::text[] then
    local_date := vals->>'incident_date'; local_time := vals->>'incident_time';
    if local_date is null or local_time is null or next_case.incident_timezone is null then needs_human := true;
    else
      local_stamp := (local_date||'T'||local_time)::timestamp;
      instant := local_stamp at time zone next_case.incident_timezone;
      if instant < statement_timestamp()-interval '90 days' or instant > statement_timestamp()+interval '1 hour' then raise exception 'Purchase time outside supported range'; end if;
      next_case.incident_local_datetime := local_date||'T'||local_time;
      -- DST overlaps/gaps remain explicit internal work; never guess an instant.
      if instant at time zone next_case.incident_timezone<>local_stamp
        or (instant-interval '1 hour') at time zone next_case.incident_timezone=local_stamp
        or (instant+interval '1 hour') at time zone next_case.incident_timezone=local_stamp then
        next_case.incident_time_resolution := case when instant at time zone next_case.incident_timezone<>local_stamp then 'nonexistent' else 'ambiguous' end;
        needs_human := true;
      else next_case.incident_at := instant; next_case.incident_time_resolution := 'exact'; end if;
    end if;
  end if;
  -- Unknown answers are evidence of uncertainty, not fabricated replacements.
  -- Keep original facts in the case/snapshot and disallow automatic recheck.
  needs_human := needs_human or cardinality(changed_fields)=0;
  update public.refund_cases set
    reporting_machine_id=next_case.reporting_machine_id,reporting_location_id=next_case.reporting_location_id,
    intake_selection_key=next_case.intake_selection_key,intake_selection_kind=next_case.intake_selection_kind,
    intake_selection_machine_ids=next_case.intake_selection_machine_ids,incident_timezone=next_case.incident_timezone,
    payment_method=next_case.payment_method,payment_amount_cents=next_case.payment_amount_cents,
    payment_interaction=next_case.payment_interaction,card_wallet_used=next_case.card_wallet_used,
    wallet_provider=next_case.wallet_provider,card_last4=next_case.card_last4,card_last4_provenance=next_case.card_last4_provenance,
    card_network=next_case.card_network,incident_at=next_case.incident_at,incident_local_datetime=next_case.incident_local_datetime,
    incident_time_resolution=next_case.incident_time_resolution,incident_time_confidence=next_case.incident_time_confidence,
    wallet_correction_state=case when c.wallet_correction_state in ('needed','sent','reminder_sent') then 'received' else c.wallet_correction_state end,
    status='needs_review',automation_state='customer_replied',automation_follow_up_due_at=null,
    nayax_match_execution_eligible=false,matched_nayax_transaction_id=null,matched_nayax_site_id=null,
    matched_nayax_machine_auth_time=null,matched_nayax_amount_cents=null,matched_nayax_card_last4=null,
    matched_nayax_currency_code=null,nayax_recommendation_state=null,nayax_recommendation_policy_version=null,
    matched_sales_fact_id=null,
    nayax_recommendation_evaluated_at=null,correlation_status='manual_review',correlation_source=null,
    correlation_confidence=0,correlation_summary='Customer response saved. Bloomjoy owns the next review.',updated_at=statement_timestamp()
  where id=c.id returning * into next_case;
  delete from public.refund_nayax_lookup_candidates where refund_case_id=c.id;
  end if;
  update public.refund_follow_up_cycles set status='manual_review'
    where refund_case_id=c.id and status in ('claimed','waiting','customer_replied');
  update public.refund_wallet_correction_contexts set status='submitted',consumed_at=statement_timestamp(),updated_at=statement_timestamp(),
    correction_response=p_answers,correction_resulting_fact_version=next_case.deterministic_fact_version,
    correction_recheck_state=case when needs_human then null else 'pending' end,
    correction_next_action=case when needs_human then 'review' else 'recheck' end where id=r.id;
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
  values(c.id,'purchase_correction_received','Customer response saved on the same request; Bloomjoy owns the next review.',
    jsonb_build_object('request_id',r.id,'changed_fields',changed_fields,'cannot_provide_fields',unknown_fields,
      'resulting_fact_version',next_case.deterministic_fact_version,'payload_redacted',true));
  return jsonb_build_object('state','received','publicReference',c.public_reference,'refundCaseId',c.id,'requestId',r.id,
    'factVersion',next_case.deterministic_fact_version,'nextAction',case when needs_human then 'review' else 'recheck' end);
end;
$$;

revoke all on function public.refund_purchase_correction_eligible(public.refund_cases),public.refund_purchase_correction_values(public.refund_cases),
  public.service_issue_refund_purchase_correction(uuid,text,bigint),public.service_get_refund_purchase_correction(text),
  public.service_submit_refund_purchase_correction(text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.service_issue_refund_purchase_correction(uuid,text,bigint),public.service_get_refund_purchase_correction(text),
  public.service_submit_refund_purchase_correction(text,bigint,jsonb) to service_role;

alter function public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text)
  rename to service_apply_refund_gmail_customer_facts_pre_purchase_correction;
revoke all on function public.service_apply_refund_gmail_customer_facts_pre_purchase_correction(uuid,uuid,bigint,jsonb,text[],text)
  from public,anon,authenticated,service_role;
create function public.service_apply_refund_gmail_customer_facts_v1(
  p_refund_case_id uuid,p_gmail_message_id uuid,p_expected_fact_version bigint,p_updates jsonb,p_applied_fields text[],p_extraction_policy text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; received_at timestamptz;
begin
  select * into c from public.refund_cases where id=p_refund_case_id for update;
  select message.received_at into received_at from public.refund_gmail_messages message
    where message.id=p_gmail_message_id and message.refund_case_id=c.id;
  if exists(select 1 from public.refund_wallet_correction_contexts r where r.refund_case_id=c.id
    and r.correction_kind='purchase' and r.status='submitted' and r.consumed_at>=received_at) then
    return jsonb_build_object('outcome','conflict','reason','newer_customer_form_response','factVersion',c.deterministic_fact_version);
  end if;
  return public.service_apply_refund_gmail_customer_facts_pre_purchase_correction(
    p_refund_case_id,p_gmail_message_id,p_expected_fact_version,p_updates,p_applied_fields,p_extraction_policy);
end;
$$;
revoke all on function public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text) from public,anon,authenticated;
grant execute on function public.service_apply_refund_gmail_customer_facts_v1(uuid,uuid,bigint,jsonb,text[],text) to service_role;

alter function public.admin_get_refund_operations_overview() rename to admin_get_refund_operations_overview_pre_purchase_correction;
revoke all on function public.admin_get_refund_operations_overview_pre_purchase_correction() from public,anon,authenticated,service_role;
create function public.admin_get_refund_operations_overview()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; enriched jsonb;
begin
  base := public.admin_get_refund_operations_overview_pre_purchase_correction();
  select coalesce(jsonb_agg(item.value||jsonb_build_object(
    'customerCorrectionFields',case when exists(select 1 from public.refund_customer_contact_settings settings where settings.singleton and coalesce((to_jsonb(settings)->>'correction_links_enabled')::boolean,false)) then public.refund_purchase_correction_request_fields((item.value->>'id')::uuid) end,
    'customerCorrection', case when r.id is null then null else jsonb_build_object(
      'state',case when r.status='pending' and r.expires_at<=statement_timestamp() then 'expired' else r.status end,
      'requestedAt',r.issued_at,'respondedAt',r.consumed_at,'expiresAt',r.expires_at,
      'requestedFields',r.correction_requested_fields,'answers',r.correction_response,'previousValues',r.correction_snapshot,
      'isActive',r.status='pending' and r.expires_at>statement_timestamp()
        and r.correction_fact_version=current_case.deterministic_fact_version and public.refund_purchase_correction_eligible(current_case)
        and m.recipient_email=current_case.customer_email and m.status in ('pending','sent')
        and coalesce(m.delivery_state,'') not in ('failed','bounced','complained') and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)),
      'isUsable',r.status='pending' and r.expires_at>statement_timestamp()
        and r.correction_fact_version=current_case.deterministic_fact_version and public.refund_purchase_correction_eligible(current_case)
        and m.recipient_email=current_case.customer_email and m.status='sent'
        and coalesce(m.delivery_state,'') not in ('failed','bounced','complained') and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)),
      'deliveryState',m.delivery_state,'deliveryStatus',m.status,'recheckState',r.correction_recheck_state,'nextAction',r.correction_next_action
    ) end) order by item.ordinality),'[]') into enriched
  from jsonb_array_elements(coalesce(base->'cases','[]')) with ordinality item
  join public.refund_cases current_case on current_case.id=(item.value->>'id')::uuid
  left join lateral(select * from public.refund_wallet_correction_contexts ctx where ctx.refund_case_id=(item.value->>'id')::uuid
    and ctx.correction_kind='purchase' order by ctx.issued_at desc limit 1) r on true
  left join public.refund_case_messages m on m.id=r.correction_message_id;
  return jsonb_set(base,'{cases}',enriched,true);
end;
$$;
revoke all on function public.admin_get_refund_operations_overview() from public,anon;
grant execute on function public.admin_get_refund_operations_overview() to authenticated,service_role;
select pg_notify('pgrst','reload schema');
