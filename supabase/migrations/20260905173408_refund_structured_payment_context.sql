-- #1163: preserve optional customer context and ask for only the structured
-- details that can resolve a real transaction ambiguity on the same case.

alter table public.refund_cases
  add column card_last4_source text check (card_last4_source in ('physical_card','wallet_device','bank_record','unknown')),
  add column wallet_device_kind text check (wallet_device_kind in ('phone','watch','unknown')),
  add column incident_time_source text check (incident_time_source in ('transaction_alert_or_receipt','memory','unknown')),
  add column nearby_attempt_count text check (nearby_attempt_count in ('one','multiple','unknown'));

alter table public.refund_cases
  drop constraint if exists refund_cases_payment_interaction_check,
  add constraint refund_cases_payment_interaction_check check (payment_interaction in (
    'phone_watch_wallet','tap_card','insert_card','swipe_card','insert_or_swipe','cash','unsure'
  )),
  add constraint refund_cases_wallet_device_kind_interaction_check check (
    wallet_device_kind is null or payment_interaction='phone_watch_wallet'
  );

create or replace function public.canonical_refund_follow_up_fields(p_fields text[])
returns text[] language sql immutable set search_path=public as $$
  with allowed(value,position) as (values
    ('location_or_machine'::text,1),('incident_date',2),('incident_time',3),('incident_time_source',4),
    ('payment_method',5),('payment_interaction',6),('card_last4',7),('card_last4_source',8),
    ('card_network',9),('wallet_provider',10),('wallet_device_kind',11),('nearby_attempt_count',12),
    ('amount',13),('zelle_payment_contact',14)
  ), selected as (
    select distinct allowed.value,allowed.position from unnest(coalesce(p_fields,'{}'::text[])) entry
    join allowed on allowed.value=entry
  ) select coalesce(array_agg(value order by position),'{}'::text[]) from selected;
$$;

create or replace function public.guard_refund_deterministic_fact_version()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.reporting_machine_id is distinct from old.reporting_machine_id
    or new.reporting_location_id is distinct from old.reporting_location_id
    or new.incident_at is distinct from old.incident_at
    or new.incident_local_datetime is distinct from old.incident_local_datetime
    or new.incident_timezone is distinct from old.incident_timezone
    or new.incident_time_resolution is distinct from old.incident_time_resolution
    or new.incident_time_confidence is distinct from old.incident_time_confidence
    or new.incident_time_source is distinct from old.incident_time_source
    or new.payment_method is distinct from old.payment_method
    or new.payment_amount_cents is distinct from old.payment_amount_cents
    or new.card_last4 is distinct from old.card_last4
    or new.card_last4_provenance is distinct from old.card_last4_provenance
    or new.card_last4_source is distinct from old.card_last4_source
    or new.card_network is distinct from old.card_network
    or new.card_wallet_used is distinct from old.card_wallet_used
    or new.payment_interaction is distinct from old.payment_interaction
    or new.wallet_provider is distinct from old.wallet_provider
    or new.wallet_device_kind is distinct from old.wallet_device_kind
    or new.nearby_attempt_count is distinct from old.nearby_attempt_count
    or new.zelle_payment_contact is distinct from old.zelle_payment_contact then
    new.deterministic_fact_version:=old.deterministic_fact_version+1;
    new.deterministic_facts_updated_at:=statement_timestamp();
    new.cash_match_evaluated_fact_version:=null;
  else
    new.deterministic_fact_version:=old.deterministic_fact_version;
    new.deterministic_facts_updated_at:=old.deterministic_facts_updated_at;
  end if;
  return new;
end;
$$;



drop trigger if exists refund_cases_guard_deterministic_fact_version on public.refund_cases;
create trigger refund_cases_guard_deterministic_fact_version before update of
  reporting_machine_id,reporting_location_id,incident_at,incident_local_datetime,incident_timezone,
  incident_time_resolution,incident_time_confidence,incident_time_source,payment_method,payment_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,card_network,card_wallet_used,payment_interaction,
  wallet_provider,wallet_device_kind,nearby_attempt_count,zelle_payment_contact,deterministic_fact_version,
  deterministic_facts_updated_at
on public.refund_cases for each row execute function public.guard_refund_deterministic_fact_version();

create or replace function public.refund_purchase_correction_values(p_case public.refund_cases)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'location_or_machine',(select choice.display_label from public.public_refund_selections() choice
      where choice.selection_key=coalesce(p_case.intake_selection_key,public.refund_public_selection_key('machine|'||p_case.reporting_machine_id::text)) limit 1),
    'incident_date',nullif(left(p_case.incident_local_datetime,10),''),
    'incident_time',case when p_case.incident_time_resolution in ('exact','legacy_absolute') then nullif(substring(p_case.incident_local_datetime from 12 for 5),'') end,
    'incident_time_source',p_case.incident_time_source,
    'payment_method',case when p_case.payment_method in ('card','cash') then p_case.payment_method end,
    'payment_interaction',nullif(p_case.payment_interaction,'unsure'),
    'card_last4',p_case.card_last4,
    'card_last4_source',p_case.card_last4_source,
    'card_network',p_case.card_network,
    'wallet_provider',nullif(p_case.wallet_provider,'unsure'),
    'wallet_device_kind',p_case.wallet_device_kind,
    'nearby_attempt_count',p_case.nearby_attempt_count,
    'amount',case when p_case.payment_amount_cents>0 then to_char(p_case.payment_amount_cents::numeric/100,'FM999990.00') end,
    'zelle_payment_contact',p_case.zelle_payment_contact));
$$;

create or replace function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; fields text[]; evidence jsonb; reasons text[]; exclusions text[]; candidate_count integer:=0;
begin
  select * into c from public.refund_cases where id=p_case_id;
  if c.id is null or not public.refund_purchase_correction_eligible(c) then return '{}'::text[]; end if;
  fields:=case when c.decision='approved' then array['zelle_payment_contact']::text[] else public.refund_missing_follow_up_fields(c.id) end;
  if c.decision is null then
    if c.intake_selection_key is not null then fields:=array_remove(fields,'location_or_machine'); end if;
    if c.payment_method='card' and c.card_wallet_used then
      if c.card_last4 is null or c.card_last4_provenance is distinct from 'wallet_device_token' then fields:=array_append(fields,'card_last4'); end if;
      if c.card_last4_source is null or c.card_last4_source='unknown' then fields:=array_append(fields,'card_last4_source'); end if;
      if c.payment_interaction is distinct from 'phone_watch_wallet' then fields:=array_append(fields,'payment_interaction'); end if;
      if c.wallet_provider is null or c.wallet_provider='unsure' then fields:=array_append(fields,'wallet_provider'); end if;
      if c.wallet_device_kind is null or c.wallet_device_kind='unknown' then fields:=array_append(fields,'wallet_device_kind'); end if;
    end if;
    if c.nayax_recommendation_state in ('manual_exception','no_safe_match')
      and c.nayax_lookup_status in ('manual_exception','no_match')
      and c.nayax_recommendation_evaluated_at>=c.deterministic_facts_updated_at then
      select count(*) into candidate_count from public.refund_nayax_lookup_candidates candidate
        where candidate.refund_case_id=c.id and candidate.lookup_generation=c.nayax_lookup_generation
          and candidate.expires_at>statement_timestamp();
      select candidate.evidence_summary into evidence from public.refund_nayax_lookup_candidates candidate
        where candidate.refund_case_id=c.id and candidate.lookup_generation=c.nayax_lookup_generation
          and candidate.expires_at>statement_timestamp()
        order by (candidate.evidence_summary->>'is_top_ranked'='true') desc nulls last,candidate.created_at desc limit 1;
      select coalesce(array_agg(value),'{}') into reasons from jsonb_array_elements_text(
        coalesce(evidence->'reason_codes','[]')||coalesce(evidence->'manual_review_reasons','[]')||coalesce(evidence->'hard_exclusions','[]'));
      select coalesce(array_agg(value),'{}') into exclusions from jsonb_array_elements_text(coalesce(evidence->'hard_exclusions','[]'));
      if not reasons && array['already_refunded','currency_not_usd','duplicate_provider_record','duplicate_transaction','missing_amount_evidence',
        'missing_canonical_machine_mapping','missing_currency_evidence','missing_provider_card_last4','missing_provider_machine_id',
        'missing_provider_site_id','payment_not_approved','provider_machine_mismatch','provider_status_unconfirmed']::text[]
        and array_remove(exclusions,'card_last4_mismatch')='{}'::text[] then
        if 'card_last4_mismatch'=any(reasons) then
          fields:=array_append(fields,'card_last4');
          if c.payment_interaction is null or c.payment_interaction in ('unsure','insert_or_swipe') then fields:=array_append(fields,'payment_interaction'); end if;
          if c.card_last4_source is null or c.card_last4_source='unknown' then fields:=array_append(fields,'card_last4_source'); end if;
          if c.card_network is null or c.card_network='other_unknown' then fields:=array_append(fields,'card_network'); end if;
          if c.payment_interaction='phone_watch_wallet' then
            if c.wallet_provider is null or c.wallet_provider='unsure' then fields:=array_append(fields,'wallet_provider'); end if;
            if c.wallet_device_kind is null or c.wallet_device_kind='unknown' then fields:=array_append(fields,'wallet_device_kind'); end if;
          end if;
        end if;
        if reasons && array['amount_mismatch','amount_uncertain']::text[] then fields:=array_append(fields,'amount'); end if;
        if reasons && array['incident_time_too_far','customer_time_rough']::text[] then
          fields:=array_append(fields,'incident_time');
          if c.incident_time_source is null or c.incident_time_source='unknown' then fields:=array_append(fields,'incident_time_source'); end if;
        end if;
        if candidate_count>1 and (reasons && array['card_last4_mismatch','amount_mismatch','amount_uncertain','incident_time_too_far','customer_time_rough']::text[])
          then fields:=array_append(fields,'nearby_attempt_count'); end if;
      end if;
    end if;
  end if;
  fields:=array(select unnest(fields) except select answer.key
    from public.refund_wallet_correction_contexts r cross join lateral jsonb_each(r.correction_response) answer
    where r.refund_case_id=c.id and r.status='submitted' and r.correction_kind='purchase'
      and public.refund_purchase_correction_values(c)->>answer.key is not distinct from coalesce(answer.value->>'value',r.correction_snapshot->>answer.key)
      and (answer.key not in ('card_last4','card_last4_source','wallet_provider','wallet_device_kind','card_network') or (
        public.refund_purchase_correction_values(c)->>'payment_method' is not distinct from r.correction_snapshot->>'payment_method'
        and public.refund_purchase_correction_values(c)->>'payment_interaction' is not distinct from r.correction_snapshot->>'payment_interaction')));
  return public.canonical_refund_follow_up_fields(fields);
end;
$$;

create or replace function public.service_get_refund_purchase_correction(p_token_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts;
begin
  select * into r from public.refund_wallet_correction_contexts where token_hash=p_token_hash and correction_kind='purchase';
  if r.id is null then return jsonb_build_object('state','unavailable'); end if;
  select * into c from public.refund_cases where id=r.refund_case_id;
  if r.status='submitted' then return jsonb_build_object('state','received','publicReference',c.public_reference,'nextAction',r.correction_next_action); end if;
  if r.status<>'pending' or r.expires_at<=statement_timestamp() or not public.refund_purchase_correction_eligible(c)
    or not exists(select 1 from public.refund_case_messages m where m.id=r.correction_message_id
      and m.refund_case_id=c.id and m.recipient_email=c.customer_email and m.status='sent'
      and coalesce(m.delivery_state,'') not in ('failed','bounced','complained')
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m)))
    or c.deterministic_fact_version is distinct from r.correction_fact_version then return jsonb_build_object('state','unavailable'); end if;
  return jsonb_build_object('state','ready','publicReference',c.public_reference,'version',r.correction_fact_version,
    'locale',case when c.intake_meta->>'customer_locale'='es' then 'es' else 'en' end,
    'requestedFields',r.correction_requested_fields,
    'allowedFields',case when r.correction_requested_fields=array['zelle_payment_contact']::text[] then array['zelle_payment_contact']::text[]
      else array['location_or_machine','incident_date','incident_time','incident_time_source','payment_method','payment_interaction',
        'card_last4','card_last4_source','card_network','wallet_provider','wallet_device_kind','nearby_attempt_count','amount']::text[] end,
    'locationChoices',(select coalesce(jsonb_agg(jsonb_build_object('key',selection_key,'label',display_label)),'[]') from public.public_refund_selections()),
    'values',r.correction_snapshot,'timezone',c.incident_timezone,'incidentTimeConfidence',c.incident_time_confidence,'expiresAt',r.expires_at);
end;
$$;

create or replace function public.service_submit_refund_purchase_correction(p_token_hash text,p_expected_fact_version bigint,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.refund_cases; r public.refund_wallet_correction_contexts; next_case public.refund_cases;
  field text; answer jsonb; disposition text; value text; vals jsonb; unknown_fields text[] := '{}'; changed_fields text[] := '{}';
  needs_human boolean := false; local_date text; local_time text; local_stamp timestamp; instant timestamptz; selection jsonb; payout_only boolean; required_fields text[];
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
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'Requested answers required'; end if;
  required_fields:=r.correction_requested_fields;
  if (p_answers->'payment_method'->>'disposition'='changed' and p_answers->'payment_method'->>'value'='cash') or c.payment_method='cash' then
    required_fields:=array(select unnest(required_fields) except select unnest(array['payment_interaction','card_last4','card_last4_source','card_network','wallet_provider','wallet_device_kind']::text[]));
  elsif p_answers->'payment_interaction'->>'disposition'='changed' and p_answers->'payment_interaction'->>'value' in ('tap_card','insert_card','swipe_card','insert_or_swipe') then
    required_fields:=array(select unnest(required_fields) except select unnest(array['wallet_provider','wallet_device_kind']::text[]));
  end if;
  if p_answers->'card_last4'->>'disposition'='changed' then required_fields:=array_append(required_fields,'card_last4_source'); end if;
  if p_answers->'incident_time'->>'disposition'='changed' then required_fields:=array_append(required_fields,'incident_time_source'); end if;
  required_fields:=public.canonical_refund_follow_up_fields(required_fields);
  if not p_answers ?& required_fields then raise exception 'Requested answers required'; end if;
  payout_only := r.correction_requested_fields=array['zelle_payment_contact']::text[];
  vals := r.correction_snapshot;
  for field,answer in select * from jsonb_each(p_answers) loop
    disposition := answer->>'disposition'; value := btrim(answer->>'value');
    if field not in ('location_or_machine','incident_date','incident_time','incident_time_source','payment_method','payment_interaction','wallet_provider','wallet_device_kind','nearby_attempt_count','amount','card_last4','card_last4_source','card_network','zelle_payment_contact')
      or (payout_only and field<>'zelle_payment_contact') or (not payout_only and field='zelle_payment_contact')
      or jsonb_typeof(answer) is distinct from 'object'
      or disposition is null or disposition not in ('changed','confirmed','cannot_provide')
      or exists(select 1 from jsonb_object_keys(answer) k where k not in ('value','disposition','confidence')) then raise exception 'Unsupported correction answer'; end if;
    if answer ? 'confidence' and (field<>'incident_time' or disposition not in ('changed','confirmed') or answer->>'confidence' not in ('exact','within_15_minutes','within_1_hour','rough')) then raise exception 'Invalid time confidence'; end if;
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
        or field='payment_interaction' and value not in ('tap_card','insert_card','swipe_card','insert_or_swipe','phone_watch_wallet','cash')
        or field='card_last4_source' and value not in ('physical_card','wallet_device','bank_record','unknown')
        or field='wallet_provider' and value not in ('apple_pay','google_wallet','other')
        or field='wallet_device_kind' and value not in ('phone','watch','unknown')
        or field='incident_time_source' and value not in ('transaction_alert_or_receipt','memory','unknown')
        or field='nearby_attempt_count' and value not in ('one','multiple','unknown')
        or field='card_network' and value not in ('visa','mastercard','discover','american_express','other_unknown') then raise exception 'Invalid correction value'; end if;
      if vals->>field is distinct from value then
        changed_fields := array_append(changed_fields,field); vals := jsonb_set(vals,array[field],to_jsonb(value));
      end if;
      if field in ('card_last4_source','wallet_device_kind','incident_time_source','nearby_attempt_count') and value='unknown' then needs_human:=true; end if;
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
    next_case.card_last4 := null; next_case.card_last4_provenance := null; next_case.card_last4_source:=null; next_case.card_network := null;
    next_case.card_wallet_used := false; next_case.wallet_provider := null; next_case.wallet_device_kind:=null;
    next_case.payment_interaction := case when next_case.payment_method='cash' then 'cash' else 'unsure' end;
  end if;
  if 'payment_interaction'=any(changed_fields) then
    if (vals->>'payment_interaction'='cash') <> (next_case.payment_method='cash') then raise exception 'Payment method and interaction conflict'; end if;
    next_case.payment_interaction := vals->>'payment_interaction';
    next_case.card_wallet_used := next_case.payment_interaction='phone_watch_wallet';
    next_case.card_last4 := null; next_case.card_last4_provenance := null; next_case.card_last4_source:=null;
    next_case.wallet_provider := null; next_case.wallet_device_kind:=null;
  end if;
  if changed_fields && array['payment_method','payment_interaction']::text[] and next_case.payment_method='card' then
    if not p_answers ? 'card_last4' or not p_answers ? 'card_last4_source'
      or (next_case.card_wallet_used and (not p_answers ? 'wallet_provider' or not p_answers ? 'wallet_device_kind'))
      then raise exception 'Confirm dependent card details or choose cannot provide'; end if;
    if next_case.payment_interaction='unsure' then needs_human:=true; end if;
  end if;
  if 'wallet_provider'=any(changed_fields) or
    ('payment_interaction'=any(changed_fields) and p_answers->'wallet_provider'->>'disposition' in ('confirmed','changed')) then
    if next_case.card_wallet_used is not true then raise exception 'Wallet details require a wallet purchase'; end if;
    next_case.wallet_provider := vals->>'wallet_provider';
  end if;
  if 'wallet_device_kind'=any(changed_fields) or
    ('payment_interaction'=any(changed_fields) and p_answers->'wallet_device_kind'->>'disposition' in ('confirmed','changed')) then
    if next_case.card_wallet_used is not true then raise exception 'Wallet device requires a wallet purchase'; end if;
    next_case.wallet_device_kind:=vals->>'wallet_device_kind';
  end if;
  if 'card_last4'=any(changed_fields) or
    (changed_fields && array['payment_method','payment_interaction']::text[] and p_answers->'card_last4'->>'disposition' in ('confirmed','changed')) then
    if next_case.payment_method<>'card' or next_case.payment_interaction not in ('tap_card','insert_card','swipe_card','insert_or_swipe','phone_watch_wallet') then raise exception 'Confirm how the card was used before changing its digits'; end if;
    next_case.card_last4 := vals->>'card_last4';
    next_case.card_last4_provenance := case when p_answers->'card_last4_source'->>'disposition'='cannot_provide' then null else case vals->>'card_last4_source'
      when 'physical_card' then 'physical_card'
      when 'wallet_device' then case when next_case.card_wallet_used then 'wallet_device_token' end
      when 'bank_record' then null
      when 'unknown' then null
      else case when next_case.card_wallet_used then 'wallet_device_token' else 'physical_card' end end end;
  end if;
  if 'card_last4_source'=any(changed_fields) or
    (changed_fields && array['payment_method','payment_interaction','card_last4']::text[] and p_answers->'card_last4_source'->>'disposition' in ('confirmed','changed')) then
    if next_case.payment_method<>'card' then raise exception 'Last-four source requires a card purchase'; end if;
    next_case.card_last4_source:=vals->>'card_last4_source';
    next_case.card_last4_provenance:=case next_case.card_last4_source
      when 'physical_card' then 'physical_card'
      when 'wallet_device' then case when next_case.card_wallet_used then 'wallet_device_token' end
      when 'bank_record' then null when 'unknown' then null
      else case when next_case.card_wallet_used then 'wallet_device_token' else 'physical_card' end end;
  end if;
  if p_answers->'card_last4_source'->>'disposition'='cannot_provide' then
    next_case.card_last4_source:=null; next_case.card_last4_provenance:=null;
  end if;
  if 'card_network'=any(changed_fields) or
    ('payment_method'=any(changed_fields) and p_answers->'card_network'->>'disposition' in ('confirmed','changed')) then
    if next_case.payment_method<>'card' then raise exception 'Card details require a card purchase'; end if;
    next_case.card_network := vals->>'card_network';
  end if;
  if p_answers->'incident_time'->>'disposition' in ('changed','confirmed') then
    if nullif(p_answers->'incident_time'->>'confidence','') is null then raise exception 'Time confidence required'; end if;
    next_case.incident_time_confidence := coalesce(p_answers->'incident_time'->>'confidence','rough');
    if next_case.incident_time_confidence is distinct from c.incident_time_confidence then changed_fields:=array_append(changed_fields,'incident_time'); end if;
    needs_human := needs_human or next_case.incident_time_confidence='rough';
  end if;
  if 'incident_time_source'=any(changed_fields) then next_case.incident_time_source:=vals->>'incident_time_source'; end if;
  if 'nearby_attempt_count'=any(changed_fields) then next_case.nearby_attempt_count:=vals->>'nearby_attempt_count'; end if;
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
    wallet_provider=next_case.wallet_provider,wallet_device_kind=next_case.wallet_device_kind,
    card_last4=next_case.card_last4,card_last4_provenance=next_case.card_last4_provenance,card_last4_source=next_case.card_last4_source,
    card_network=next_case.card_network,incident_at=next_case.incident_at,incident_local_datetime=next_case.incident_local_datetime,
    incident_time_resolution=next_case.incident_time_resolution,incident_time_confidence=next_case.incident_time_confidence,
    incident_time_source=next_case.incident_time_source,nearby_attempt_count=next_case.nearby_attempt_count,
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
create or replace function public.service_create_refund_case_from_gmail_contact_form(
  p_token_hash text,p_customer_email text,p_case_values jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare selection_kind text:=nullif(btrim(p_case_values->>'intakeSelectionKind'),'');
  selection_key text:=nullif(btrim(p_case_values->>'intakeSelectionKey'),'');
  selection_machine_ids uuid[]; delegated_values jsonb:=p_case_values; result jsonb; refund_case_id uuid;
begin
  select coalesce(array_agg(value::uuid order by ordinality),'{}'::uuid[]) into selection_machine_ids
  from jsonb_array_elements_text(coalesce(p_case_values->'intakeSelectionMachineIds','[]'::jsonb)) with ordinality item(value,ordinality);
  if selection_kind='livermore_pair' then
    if selection_key<>public.refund_livermore_selection_key()
      or selection_machine_ids<>public.refund_livermore_selection_machine_ids()
      or not public.refund_livermore_selection_is_valid() then return null; end if;
    delegated_values:=jsonb_set(delegated_values,'{reportingMachineId}',to_jsonb(selection_machine_ids[1]::text),true);
  end if;
  result:=public.service_create_refund_case_from_gmail_contact_form_pre_selection_v1(p_token_hash,p_customer_email,delegated_values);
  refund_case_id:=nullif(result->>'id','')::uuid;
  if refund_case_id is null then return null; end if;
  update public.refund_cases set
    reporting_machine_id=case when selection_kind='livermore_pair' then null else reporting_machine_id end,
    intake_selection_key=selection_key,intake_selection_kind=selection_kind,
    intake_selection_machine_ids=nullif(selection_machine_ids,'{}'::uuid[]),
    card_last4_source=nullif(btrim(p_case_values->>'cardLast4Source'),''),
    card_last4_provenance=case nullif(btrim(p_case_values->>'cardLast4Source'),'')
      when 'physical_card' then 'physical_card'
      when 'wallet_device' then case when p_case_values->>'paymentInteraction'='phone_watch_wallet' then 'wallet_device_token' end
      when 'bank_record' then null when 'unknown' then null else card_last4_provenance end,
    wallet_device_kind=nullif(btrim(p_case_values->>'walletDeviceKind'),''),
    incident_time_source=nullif(btrim(p_case_values->>'incidentTimeSource'),''),
    nearby_attempt_count=nullif(btrim(p_case_values->>'nearbyAttemptCount'),''),
    updated_at=statement_timestamp()
  where id=refund_case_id;
  return result;
end;
$$;

revoke all on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.service_create_refund_case_from_gmail_contact_form(text,text,jsonb) to service_role;

revoke all on function public.refund_purchase_correction_request_fields(uuid),
  public.refund_purchase_correction_values(public.refund_cases),
  public.service_issue_refund_purchase_correction(uuid,text,bigint),
  public.service_get_refund_purchase_correction(text),
  public.service_submit_refund_purchase_correction(text,bigint,jsonb)
  from public,anon,authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid),
  public.service_issue_refund_purchase_correction(uuid,text,bigint),
  public.service_get_refund_purchase_correction(text),
  public.service_submit_refund_purchase_correction(text,bigint,jsonb)
  to service_role;

select pg_notify('pgrst','reload schema');


