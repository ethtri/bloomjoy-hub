-- #1639: same-case, email-serialized issuance from compatible private inventory.
-- Money is integer cents. The launch value rounds UP to $5; exact multiples stay.
create table public.refund_gift_card_pools (
  id uuid primary key default gen_random_uuid(),
  provider text not null check(provider in ('sunzee','kemore')),
  provider_account_id text not null check(length(btrim(provider_account_id))>0),
  currency text not null default 'USD' check(currency='USD'),
  face_value_cents integer not null check(face_value_cents>0),
  eligible_machine_ids uuid[] not null check(cardinality(eligible_machine_ids)>0),
  eligible_locations text[] not null check(cardinality(eligible_locations)>0),
  expires_at timestamptz not null,
  enabled boolean not null default false,
  redemption_instructions text not null check(length(btrim(redemption_instructions))>0),
  created_at timestamptz not null default statement_timestamp()
);
create table public.refund_gift_card_codes (
  id uuid primary key default gen_random_uuid(),
  pool_id uuid not null references public.refund_gift_card_pools(id),
  provider text not null,
  provider_account_id text not null,
  provider_code_id text,
  code text not null check(length(code)>0 and code=btrim(code)),
  valid_from timestamptz not null,
  expires_at timestamptz not null check(expires_at>valid_from),
  status text not null default 'available' check(status in ('available','issued','used','revoked')),
  issued_case_id uuid unique references public.refund_cases(id),
  provider_evidence jsonb not null default '{}'::jsonb,
  unique(provider,provider_account_id,code),
  unique(provider,provider_account_id,provider_code_id)
);
create index refund_gift_card_available_idx on public.refund_gift_card_codes(pool_id,expires_at,id)
  where status='available';
alter table public.refund_cases
  add column resolution_method text not null default 'original_payment'
    check(resolution_method in ('original_payment','gift_card')),
  add column gift_card_pool_id uuid references public.refund_gift_card_pools(id),
  add column gift_card_value_cents integer,
  add column gift_card_expires_at timestamptz,
  add column gift_card_state text check(gift_card_state in ('pending_inventory','manager_review','issued','denied')),
  add column gift_card_approved_by uuid references auth.users(id),
  add column gift_card_approved_at timestamptz,
  add constraint refund_gift_card_offer_shape check(
    (resolution_method='original_payment' and gift_card_pool_id is null and gift_card_state is null
      and gift_card_value_cents is null and gift_card_expires_at is null)
    or (resolution_method='gift_card' and gift_card_pool_id is not null and gift_card_state is not null
      and gift_card_value_cents>0 and gift_card_expires_at is not null));
create table public.refund_gift_card_issuances (
  id uuid primary key default gen_random_uuid(),
  refund_case_id uuid not null unique references public.refund_cases(id),
  code_id uuid not null unique references public.refund_gift_card_codes(id),
  pool_id uuid not null references public.refund_gift_card_pools(id),
  normalized_email text not null check(normalized_email=lower(btrim(normalized_email))),
  purchase_amount_cents integer not null check(purchase_amount_cents>0),
  face_value_cents integer not null check(face_value_cents>=purchase_amount_cents),
  goodwill_amount_cents integer not null check(goodwill_amount_cents=face_value_cents-purchase_amount_cents),
  currency text not null check(currency='USD'),
  eligible_locations text[] not null,
  expires_at timestamptz not null,
  redemption_instructions text not null,
  policy_version text not null default 'email_rolling_12_months_up_5_usd_v1',
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  issued_at timestamptz not null default statement_timestamp(),
  message_id uuid not null unique references public.refund_case_messages(id) deferrable initially deferred,
  message_identity_digest text not null,
  check((approved_by is null)=(approved_at is null))
);
create index refund_gift_card_email_history_idx on public.refund_gift_card_issuances(normalized_email,issued_at desc);
alter table public.refund_case_messages
  add column gift_card_issuance_id uuid references public.refund_gift_card_issuances(id),
  add column gift_card_message_identity_digest text;
alter table public.refund_gift_card_pools enable row level security;
alter table public.refund_gift_card_codes enable row level security;
alter table public.refund_gift_card_issuances enable row level security;
revoke all on public.refund_gift_card_pools,public.refund_gift_card_codes,public.refund_gift_card_issuances
  from public,anon,authenticated,service_role;
grant select on public.refund_gift_card_pools,public.refund_gift_card_codes,public.refund_gift_card_issuances to service_role;
create trigger refund_gift_card_issuances_immutable before update or delete on public.refund_gift_card_issuances
  for each row execute function public.refund_receipt_immutable();

create function public.guard_refund_gift_card_code() returns trigger language plpgsql set search_path='' as $$
declare p public.refund_gift_card_pools;
begin
  select * into p from public.refund_gift_card_pools where id=new.pool_id;
  if new.provider is distinct from p.provider or new.provider_account_id is distinct from p.provider_account_id
    or ((tg_op='INSERT' or new.expires_at is distinct from old.expires_at) and new.expires_at<p.expires_at) then
    raise exception 'Code identity, account and validity must match its pool';
  end if;
  if tg_op='UPDATE' and old.issued_case_id is not null and (
    new.issued_case_id is distinct from old.issued_case_id or new.status='available'
    or new.code is distinct from old.code or new.pool_id is distinct from old.pool_id) then
    raise exception 'Issued code cannot be reassigned or returned to stock';
  end if;
  return new;
end $$;
create trigger refund_gift_card_code_scope before insert or update on public.refund_gift_card_codes
  for each row execute function public.guard_refund_gift_card_code();

create function public.refund_gift_card_quote_template_verified(p_pool_id uuid)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare verified boolean:=false;
begin
  if to_regclass('public.refund_gift_card_refill_rules') is null then return false; end if;
  execute 'select exists(select 1 from public.refund_gift_card_refill_rules where pool_id=$1
    and provider_config->>''scope_verified''=''true'' and provider_config->>''currency_verified''=''true'')'
    into verified using p_pool_id;
  return verified;
end $$;
create function public.service_get_refund_gift_card_offer(p_machine_id uuid,p_amount_cents integer)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('pool_id',p.id,'value',ceil(p_amount_cents::numeric/500)*500,'currency',p.currency,
    'eligible_locations',p.eligible_locations,'expires_at',p.expires_at,'one_use',true,
    'redemption_instructions',p.redemption_instructions)
  from public.refund_gift_card_pools p
  where p.enabled and p.expires_at>statement_timestamp() and p_amount_cents>0
    and (p.face_value_cents=ceil(p_amount_cents::numeric/500)*500
      or public.refund_gift_card_quote_template_verified(p.id))
    and p_machine_id=any(p.eligible_machine_ids)
    and exists(select 1 from public.reporting_machines m where m.id=p_machine_id and m.status='active')
  order by case when p.face_value_cents=ceil(p_amount_cents::numeric/500)*500 then 0 else 1 end,
    (select min(code.expires_at) from public.refund_gift_card_codes code
    where code.pool_id=p.id and code.status='available' and code.issued_case_id is null
      and code.valid_from<=statement_timestamp() and code.expires_at>=p.expires_at) nulls last,
    p.expires_at,p.id limit 1;
$$;

create function public.service_refund_gift_card_enabled(p_machine_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_gift_card_pools p
    where p.enabled and p_machine_id=any(p.eligible_machine_ids));
$$;

-- Existing catalog advertises activation; old deployments omit this column.
-- Pools start disabled, so schema deployment alone never activates the offer.
alter function public.public_refund_selections_v2() rename to public_refund_selections_pre_gift_card;
revoke all on function public.public_refund_selections_pre_gift_card() from public,anon,authenticated,service_role;
create function public.public_refund_selections_v2()
returns table(selection_key text,display_label text,selection_kind text,location_timezone text,
  machine_id uuid,cash_machine_options jsonb,gift_card_enabled boolean)
language sql stable security definer set search_path='' as $$
  select selection.selection_key,selection.display_label,selection.selection_kind,selection.location_timezone,
    selection.machine_id,
    coalesce((select jsonb_agg(option.value||jsonb_build_object('giftCardEnabled',
      public.service_refund_gift_card_enabled((option.value->>'machineId')::uuid)) order by option.ordinality)
      from jsonb_array_elements(selection.cash_machine_options) with ordinality option),'[]'::jsonb),
    case when selection.machine_id is not null then public.service_refund_gift_card_enabled(selection.machine_id)
      else exists(select 1 from jsonb_array_elements(selection.cash_machine_options) option
        where public.service_refund_gift_card_enabled((option->>'machineId')::uuid)) end
  from public.public_refund_selections_pre_gift_card() selection;
$$;
revoke all on function public.public_refund_selections_v2() from public;
grant execute on function public.public_refund_selections_v2() to anon,authenticated;

create function public.refund_gift_card_case_projection(p_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('state',c.gift_card_state,'value',c.gift_card_value_cents,
    'purchase_amount',c.payment_amount_cents,'goodwill_amount',c.gift_card_value_cents-c.payment_amount_cents,
    'currency',p.currency,'expires_at',c.gift_card_expires_at,
    'eligible_locations',coalesce(i.eligible_locations,p.eligible_locations),
    'redemption_instructions',coalesce(i.redemption_instructions,p.redemption_instructions),
    'issued_at',i.issued_at,'delivery_state',coalesce(m.delivery_state,m.manual_delivery_state,'not_queued'),
    'payloadRedacted',true)
  from public.refund_cases c join public.refund_gift_card_pools p on p.id=c.gift_card_pool_id
  left join public.refund_gift_card_issuances i on i.refund_case_id=c.id
  left join lateral (select message.* from public.refund_case_messages message
    where message.id=i.message_id or message.gift_card_issuance_id=i.id
    order by message.created_at desc,message.id desc limit 1) m on true
  where c.id=p_case_id and c.resolution_method='gift_card';
$$;

create function public.get_refund_gift_card_case(p_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; previous jsonb; issued_count integer; latest timestamptz;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.can_manage_refund_case(auth.uid(),p_case_id) then
    raise exception 'Refund case access required' using errcode='42501';
  end if;
  select * into c from public.refund_cases where id=p_case_id;
  if c.resolution_method<>'gift_card' then return null; end if;
  select count(*),max(issued_at) into issued_count,latest from public.refund_gift_card_issuances i
    where (normalized_email=lower(btrim(c.customer_email)) or exists(select 1 from public.refund_case_messages m
      where m.gift_card_issuance_id=i.id and m.recipient_email=lower(btrim(c.customer_email))))
      and refund_case_id<>c.id and issued_at+interval '12 months'>statement_timestamp();
  select jsonb_build_object('value',i.face_value_cents,'currency',i.currency,'issued_at',i.issued_at,
    'public_reference',prior.public_reference,'eligible_locations',i.eligible_locations) into previous
    from public.refund_gift_card_issuances i join public.refund_cases prior on prior.id=i.refund_case_id
    where (i.normalized_email=lower(btrim(c.customer_email)) or exists(select 1 from public.refund_case_messages m
      where m.gift_card_issuance_id=i.id and m.recipient_email=lower(btrim(c.customer_email)))) and i.refund_case_id<>c.id
    order by i.issued_at desc limit 1;
  return public.refund_gift_card_case_projection(p_case_id)||jsonb_build_object(
    'prior_issued_count',issued_count,'latest_issued_at',latest,'previous_issuance',previous,
    'customer_email',c.customer_email,
    'can_resend',c.gift_card_state='issued' and public.refund_official_action_authority(auth.uid(),p_case_id) is not null,
    'can_decide',c.gift_card_state='manager_review'
      and public.refund_official_action_authority(auth.uid(),p_case_id) is not null);
end $$;

-- Exact immutable receipt/message identity lets the current outbox deliver the
-- private code without putting that code in case lists, event logs or reports.
create function public.is_refund_gift_card_message(p_message jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.refund_gift_card_issuances i join public.refund_cases c on c.id=i.refund_case_id
    where i.refund_case_id::text=p_message->>'refund_case_id'
      and ((i.message_id::text=p_message->>'id'
          and i.normalized_email=p_message->>'recipient_email'
          and i.message_identity_digest=public.refund_receipt_completion_message_digest(p_message))
        or (i.id::text=p_message->>'gift_card_issuance_id'
          and p_message->>'gift_card_message_identity_digest'=public.refund_receipt_completion_message_digest(p_message)))
      and c.case_population='customer' and c.resolution_method='gift_card' and c.gift_card_state='issued'
      and p_message->>'template_version'='refund_gift_card_v1');
$$;

create function public.refund_gift_card_automatic_eligible(p_email text,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(select 1 from public.refund_gift_card_issuances i
    where (i.normalized_email=lower(btrim(p_email)) or exists(select 1 from public.refund_case_messages m
      where m.gift_card_issuance_id=i.id and m.recipient_email=lower(btrim(p_email))))
      and i.issued_at+interval '12 months'>p_at);
$$;

create function public.service_issue_refund_gift_card(p_case_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; p public.refund_gift_card_pools; code_row public.refund_gift_card_codes;
  m public.refund_case_messages; issued public.refund_gift_card_issuances; email_key text;
begin
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if c.resolution_method<>'gift_card' then return null; end if;
  select * into issued from public.refund_gift_card_issuances where refund_case_id=c.id;
  if issued.id is not null then return public.refund_gift_card_case_projection(c.id); end if;
  if c.gift_card_state='denied' then return public.refund_gift_card_case_projection(c.id); end if;
  if c.case_population<>'customer' or c.duplicate_of_refund_case_id is not null or c.decision is not null or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null or c.nayax_refund_execution_status<>'not_requested'
    or c.status in ('approved','denied','completed','closed','card_refund_pending','cash_zelle_pending')
    or exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    or exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_official_action_authorizations a
      where a.refund_case_id=c.id and a.status in ('pending','consumed')) then
    raise exception 'Existing payment effects must be reconciled before gift-card issuance' using errcode='P4670';
  end if;
  select * into strict p from public.refund_gift_card_pools where id=c.gift_card_pool_id for share;
  if not p.enabled or p.expires_at<=statement_timestamp() then
    update public.refund_cases set gift_card_state='pending_inventory' where id=c.id;
    return public.refund_gift_card_case_projection(c.id);
  end if;
  if c.gift_card_value_cents<>ceil(c.payment_amount_cents::numeric/500)*500
    or c.gift_card_value_cents<>p.face_value_cents or c.gift_card_expires_at>p.expires_at
    or not c.reporting_machine_id=any(p.eligible_machine_ids) then
    raise exception 'Accepted gift-card terms do not match the current purchase and pool' using errcode='P4671';
  end if;
  email_key:=lower(btrim(c.customer_email));
  perform pg_advisory_xact_lock(hashtextextended('refund-gift-card:'||email_key,0));
  -- Anniversary arithmetic clamps Feb 29 to Feb 28 in the following year;
  -- subtracting 12 months from the current date is not its inverse.
  if c.gift_card_approved_at is null and not public.refund_gift_card_automatic_eligible(email_key,statement_timestamp()) then
    update public.refund_cases set gift_card_state='manager_review' where id=c.id;
    return public.refund_gift_card_case_projection(c.id);
  end if;
  select * into code_row from public.refund_gift_card_codes
    where pool_id=p.id and status='available' and issued_case_id is null
      and valid_from<=statement_timestamp() and expires_at>=c.gift_card_expires_at and expires_at>statement_timestamp()
    order by expires_at,id for update skip locked limit 1;
  if code_row.id is null then
    update public.refund_cases set gift_card_state='pending_inventory' where id=c.id;
    return public.refund_gift_card_case_projection(c.id);
  end if;
  update public.refund_gift_card_codes set status='issued',issued_case_id=c.id where id=code_row.id;
  update public.refund_cases set gift_card_state='issued',status='completed',automation_follow_up_due_at=null,
    gift_card_expires_at=least(p.expires_at,code_row.expires_at)
    where id=c.id returning * into c;
  m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.message_type:='completed'; m.status:='pending';
  m.recipient_email:=email_key; m.subject:='Your Bloomjoy gift card is ready';
  m.body:='Your one-use Bloomjoy gift card is ready. Your code and redemption details are included at delivery.';
  m.template_key:='refund_gift_card_v1'; m.template_version:='refund_gift_card_v1';
  m.content_source:='deterministic_template'; m.delivery_kind:='automatic'; m.requested_fields:='{}'::text[];
  m.manual_delivery_intent_id:=gen_random_uuid(); m.manual_delivery_state:='queued';
  m.manual_delivery_expected_case_version:=c.official_action_version;
  m.manual_delivery_status_link_requested:=false;
  insert into public.refund_gift_card_issuances(refund_case_id,code_id,pool_id,normalized_email,
    purchase_amount_cents,face_value_cents,goodwill_amount_cents,currency,eligible_locations,expires_at,
    redemption_instructions,approved_by,approved_at,message_id,message_identity_digest)
    values(c.id,code_row.id,p.id,email_key,c.payment_amount_cents,p.face_value_cents,
      p.face_value_cents-c.payment_amount_cents,p.currency,p.eligible_locations,c.gift_card_expires_at,
      p.redemption_instructions,c.gift_card_approved_by,c.gift_card_approved_at,m.id,
      public.refund_receipt_completion_message_digest(to_jsonb(m)));
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,created_at)
    values(m.id,c.id,m.message_type,m.status,m.recipient_email,m.subject,m.body,m.template_key,
      m.template_version,m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,
      m.manual_delivery_state,m.manual_delivery_expected_case_version,statement_timestamp());
  insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
    values(c.id,'gift_card_issued','A gift card was assigned and queued for customer delivery.',
      jsonb_build_object('purchase_amount_cents',c.payment_amount_cents,'face_value_cents',p.face_value_cents,
        'goodwill_amount_cents',p.face_value_cents-c.payment_amount_cents,'policy_version','email_rolling_12_months_up_5_usd_v1',
        'manager_exception',c.gift_card_approved_at is not null,'payload_redacted',true));
  return public.refund_gift_card_case_projection(c.id);
end $$;

create function public.admin_decide_refund_gift_card(p_case_id uuid,p_approve boolean,p_notes text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Assigned Manager access required' using errcode='42501';
  end if;
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if public.refund_official_action_authority(auth.uid(),p_case_id) is null then
    raise exception 'Assigned Manager access required' using errcode='42501';
  end if;
  if c.resolution_method<>'gift_card' or p_approve is null then raise exception 'Gift-card exception required'; end if;
  if c.gift_card_approved_at is not null or c.gift_card_state in ('issued','denied') then
    return public.get_refund_gift_card_case(p_case_id);
  end if;
  if c.gift_card_state<>'manager_review' then raise exception 'No gift-card decision is due'; end if;
  if p_approve then
    update public.refund_cases set gift_card_approved_by=auth.uid(),gift_card_approved_at=statement_timestamp(),
      gift_card_state='pending_inventory' where id=c.id;
    perform public.service_issue_refund_gift_card(c.id);
  else
    update public.refund_cases set gift_card_state='denied',status='denied',decision='denied',
      decided_by=auth.uid(),decided_at=statement_timestamp(),decision_reason=left(btrim(p_notes),1000),
      automation_follow_up_due_at=null where id=c.id;
  end if;
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,auth.uid(),'gift_card_exception_decided','Manager decided the gift-card exception.',
      jsonb_build_object('approved',p_approve,'payload_redacted',true));
  return public.get_refund_gift_card_case(p_case_id);
end $$;

create function public.service_resume_refund_gift_card_cases()
returns jsonb language plpgsql security definer set search_path='' as $$
declare c record; result jsonb; issued_count integer:=0; reviewed_count integer:=0;
begin
  for c in select id from public.refund_cases where resolution_method='gift_card'
    and case_population='customer' and duplicate_of_refund_case_id is null
    and gift_card_state='pending_inventory' order by created_at,id limit 25 for update skip locked loop
    result:=public.service_issue_refund_gift_card(c.id);
    if result->>'state'='issued' then issued_count:=issued_count+1; end if;
    if result->>'state'='manager_review' then reviewed_count:=reviewed_count+1; end if;
  end loop;
  return jsonb_build_object('issued',issued_count,'managerReview',reviewed_count,'payloadRedacted',true);
end $$;

-- Authorized delivery recovery creates a new intent in the SAME outbox and
-- links it to the original issuance. It never allocates another code or resets
-- allowance history. Unknown sends must be reconciled before another attempt.
create function public.admin_resend_refund_gift_card(p_case_id uuid,p_intent_id uuid,p_email text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; i public.refund_gift_card_issuances; code_row public.refund_gift_card_codes;
  m public.refund_case_messages; email_key text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean,false) then
    raise exception 'Assigned Manager access required' using errcode='42501';
  end if;
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if public.refund_official_action_authority(auth.uid(),c.id) is null or p_intent_id is null then
    raise exception 'Assigned Manager and stable delivery intent required' using errcode='42501';
  end if;
  select * into strict i from public.refund_gift_card_issuances where refund_case_id=c.id;
  email_key:=lower(btrim(coalesce(nullif(btrim(p_email),''),c.customer_email)));
  if email_key !~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' or length(email_key)>320 then
    raise exception 'Valid customer email required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('refund-gift-card:'||email_key,0));
  select * into m from public.refund_case_messages where manual_delivery_intent_id=p_intent_id;
  if m.id is not null then
    if m.gift_card_issuance_id is distinct from i.id or m.recipient_email<>email_key then
      raise exception 'Delivery intent is already bound to different facts';
    end if;
    return public.refund_gift_card_case_projection(c.id);
  end if;
  select * into strict code_row from public.refund_gift_card_codes where id=i.code_id for share;
  if c.gift_card_state<>'issued' or code_row.status<>'issued' or i.expires_at<=statement_timestamp()
    or code_row.expires_at<=statement_timestamp() then raise exception 'Existing valid unused code required'; end if;
  if exists(select 1 from public.refund_case_messages prior where (prior.id=i.message_id or prior.gift_card_issuance_id=i.id)
      and (prior.manual_delivery_state='delivery_unknown' or prior.delivery_state='unknown'
        or (prior.manual_delivery_state='claimed' and prior.manual_delivery_provider_attempted_at is not null))) then
    raise exception 'Unknown delivery must be reconciled before resending' using errcode='P4672';
  end if;
  if email_key=lower(btrim(c.customer_email)) and exists(select 1 from public.refund_case_messages prior
    where (prior.id=i.message_id or prior.gift_card_issuance_id=i.id) and prior.manual_delivery_state in ('queued','claimed')) then
    return public.refund_gift_card_case_projection(c.id);
  end if;
  -- Cancel only definite pre-provider work; never erase transport evidence.
  update public.refund_case_messages prior set status='failed',manual_delivery_state='failed',
    manual_delivery_claim_token=null,manual_delivery_claimed_at=null,error_message='gift_card_delivery_recipient_corrected'
    where (prior.id=i.message_id or prior.gift_card_issuance_id=i.id)
      and prior.manual_delivery_state in ('queued','claimed') and prior.manual_delivery_provider_attempted_at is null;
  if email_key<>lower(btrim(c.customer_email)) then
    perform set_config('bloomjoy.giftcard.delivery_recovery_case_id',c.id::text,true);
    update public.refund_cases set customer_email=email_key where id=c.id returning * into c;
    perform set_config('bloomjoy.giftcard.delivery_recovery_case_id','',true);
  end if;
  m:=null; m.id:=gen_random_uuid(); m.refund_case_id:=c.id; m.message_type:='completed'; m.status:='pending';
  m.recipient_email:=email_key; m.subject:='Your Bloomjoy gift card is ready';
  m.body:='Your one-use Bloomjoy gift card is ready. Your code and redemption details are included at delivery.';
  m.template_key:='refund_gift_card_v1'; m.template_version:='refund_gift_card_v1';
  m.created_by:=auth.uid(); m.content_source:='deterministic_template'; m.delivery_kind:='automatic';
  m.requested_fields:='{}'::text[]; m.manual_delivery_intent_id:=p_intent_id; m.manual_delivery_state:='queued';
  m.manual_delivery_expected_case_version:=c.official_action_version;
  m.manual_delivery_status_link_requested:=false; m.gift_card_issuance_id:=i.id;
  m.gift_card_message_identity_digest:=public.refund_receipt_completion_message_digest(to_jsonb(m));
  insert into public.refund_case_messages(id,refund_case_id,message_type,status,recipient_email,subject,body,
    template_key,template_version,created_by,content_source,delivery_kind,requested_fields,manual_delivery_intent_id,
    manual_delivery_state,manual_delivery_expected_case_version,gift_card_issuance_id,gift_card_message_identity_digest,created_at)
    values(m.id,c.id,m.message_type,m.status,m.recipient_email,m.subject,m.body,m.template_key,m.template_version,
      m.created_by,m.content_source,m.delivery_kind,m.requested_fields,m.manual_delivery_intent_id,m.manual_delivery_state,
      m.manual_delivery_expected_case_version,m.gift_card_issuance_id,m.gift_card_message_identity_digest,statement_timestamp());
  insert into public.refund_case_events(refund_case_id,actor_user_id,event_type,message,metadata)
    values(c.id,auth.uid(),'gift_card_delivery_requeued','The original gift card was queued for delivery recovery.',
      jsonb_build_object('issuance_id',i.id,'new_issuance',false,'recipient_corrected',email_key<>i.normalized_email,'payload_redacted',true));
  return public.refund_gift_card_case_projection(c.id);
end $$;

create function public.service_renew_refund_gift_card_pool(p_pool_id uuid,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.refund_gift_card_pools;
begin
  -- Case-before-pool matches the allocator. Do not hold the pool while waiting
  -- on a case whose allocator is obtaining its compatible stock lock.
  perform 1 from public.refund_cases where gift_card_pool_id=p_pool_id
    and gift_card_state in ('pending_inventory','manager_review') order by id for update;
  select * into strict p from public.refund_gift_card_pools where id=p_pool_id for update;
  if p_expires_at is null or p_expires_at<=statement_timestamp() or p_expires_at<p.expires_at then
    raise exception 'Renewal must preserve or improve accepted validity';
  end if;
  update public.refund_gift_card_pools set expires_at=p_expires_at where id=p.id;
  update public.refund_cases set gift_card_expires_at=p_expires_at
    where gift_card_pool_id=p.id and gift_card_state in ('pending_inventory','manager_review')
      and gift_card_expires_at<=statement_timestamp() and gift_card_expires_at<p_expires_at;
  return jsonb_build_object('renewed',true,'payloadRedacted',true);
end $$;

create function public.service_accept_refund_gift_card_offer(p_case_id uuid,p_pool_id uuid,p_value integer,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.refund_cases; p public.refund_gift_card_pools;
begin
  select * into strict c from public.refund_cases where id=p_case_id for update;
  if c.resolution_method='gift_card' then
    if c.gift_card_pool_id<>p_pool_id or c.gift_card_value_cents<>p_value then raise exception 'Accepted offer cannot change'; end if;
    return public.service_issue_refund_gift_card(c.id);
  end if;
  if c.case_population<>'customer' or c.decision is not null or c.refund_completed_at is not null
    or c.reporting_adjustment_id is not null or c.nayax_refund_execution_status<>'not_requested'
    or c.status in ('approved','denied','completed','closed','card_refund_pending','cash_zelle_pending')
    or exists(select 1 from public.refund_case_nayax_refund_attempts a where a.refund_case_id=c.id)
    or exists(select 1 from public.refund_authoritative_receipts r where r.refund_case_id=c.id)
    or exists(select 1 from public.refund_case_official_action_authorizations a where a.refund_case_id=c.id
      and a.status in ('pending','consumed')) then
    raise exception 'Existing payment effects must be reconciled before accepting gift card' using errcode='P4670';
  end if;
  select * into strict p from public.refund_gift_card_pools where id=p_pool_id for share;
  if not p.enabled or p_value<>p.face_value_cents or p_value<>ceil(c.payment_amount_cents::numeric/500)*500
    or p_expires_at>p.expires_at or p_expires_at<=statement_timestamp()
    or not c.reporting_machine_id=any(p.eligible_machine_ids) then raise exception 'Current compatible offer required'; end if;
  update public.refund_cases set resolution_method='gift_card',gift_card_pool_id=p.id,
    gift_card_value_cents=p_value,gift_card_expires_at=p_expires_at,gift_card_state='pending_inventory',
    zelle_payment_contact=null,automation_follow_up_due_at=null where id=c.id;
  return public.service_issue_refund_gift_card(c.id);
end $$;

create function public.issue_refund_gift_card_after_intake() returns trigger
language plpgsql security definer set search_path='' as $$
begin if new.resolution_method='gift_card' then perform public.service_issue_refund_gift_card(new.id); end if; return new; end $$;
create trigger zz_refund_gift_card_after_intake after insert on public.refund_cases
  for each row execute function public.issue_refund_gift_card_after_intake();

-- The accepted resolution is a same-case settlement boundary, including an
-- unknown original-payment attempt. No old client may settle gift and money.
create function public.guard_refund_gift_card_settlement() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='refund_cases' then
    if tg_op='INSERT' and (new.gift_card_approved_by is not null or new.gift_card_approved_at is not null) then
      raise exception 'Gift-card approval cannot be supplied at intake' using errcode='42501';
    end if;
    if (tg_op='UPDATE' and row(new.gift_card_approved_by,new.gift_card_approved_at)
      is distinct from row(old.gift_card_approved_by,old.gift_card_approved_at))
      and current_user in ('anon','authenticated','service_role') then
      raise exception 'Only the assigned Manager decision may approve a repeat gift card' using errcode='42501';
    end if;
    if tg_op='UPDATE' and old.resolution_method='gift_card' then
    if old.gift_card_state is distinct from 'denied' and new.gift_card_state='denied' then
      if current_user in ('anon','authenticated','service_role') or auth.uid() is null then
        raise exception 'Only the assigned Manager may deny a gift-card exception' using errcode='P4670';
      end if;
      if public.refund_official_action_authority(auth.uid(),old.id) is null then
        raise exception 'Only the assigned Manager may deny a gift-card exception' using errcode='P4670';
      end if;
    end if;
    if (
      new.resolution_method<>old.resolution_method or new.gift_card_pool_id<>old.gift_card_pool_id
      or new.gift_card_value_cents<>old.gift_card_value_cents or new.gift_card_expires_at<old.gift_card_expires_at
      or (old.gift_card_state='issued' and new.gift_card_expires_at<>old.gift_card_expires_at)
      or (new.customer_email<>old.customer_email and not(current_user not in ('anon','authenticated','service_role')
        and coalesce(current_setting('bloomjoy.giftcard.delivery_recovery_case_id',true)=old.id::text,false)))
      or new.payment_amount_cents<>old.payment_amount_cents
      or new.reporting_machine_id<>old.reporting_machine_id or new.payment_method<>old.payment_method
      or (old.gift_card_state='denied' and new.gift_card_state<>'denied')
      or ((new.status in ('denied','closed') or new.decision='denied') and new.gift_card_state<>'denied')
      or (old.gift_card_state='issued' and (new.gift_card_state<>'issued' or new.status<>'completed'
        or new.decision is not null or new.refund_amount_cents is distinct from old.refund_amount_cents
        or new.duplicate_of_refund_case_id is distinct from old.duplicate_of_refund_case_id))
      or new.decision='approved' or new.refund_completed_at is not null
      or new.nayax_refund_execution_status<>'not_requested' or new.manual_refund_reference is not null) then
      raise exception 'Gift-card resolution prevents a second settlement or changed accepted terms' using errcode='P4670';
    end if;
    end if;
    return new;
  end if;
  perform 1 from public.refund_cases where id=new.refund_case_id and resolution_method='gift_card' for update;
  if found then raise exception 'Gift-card resolution prevents money settlement' using errcode='P4670'; end if;
  return new;
end $$;
create trigger aa_refund_gift_card_case_settlement before insert or update on public.refund_cases
  for each row execute function public.guard_refund_gift_card_settlement();
create trigger aa_refund_gift_card_attempt_settlement before insert on public.refund_case_nayax_refund_attempts
  for each row execute function public.guard_refund_gift_card_settlement();
create trigger aa_refund_gift_card_receipt_settlement before insert on public.refund_authoritative_receipts
  for each row execute function public.guard_refund_gift_card_settlement();

create function public.enforce_refund_gift_card_receipt() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.refund_cases c where c.id=new.id and c.gift_card_state='issued'
    and not exists(select 1 from public.refund_gift_card_issuances i where i.refund_case_id=c.id)) then
    raise exception 'Issued gift-card state requires the atomic issuance receipt';
  end if;
  return new;
end $$;
create constraint trigger refund_gift_card_receipt_integrity after insert or update on public.refund_cases
  deferrable initially deferred for each row execute function public.enforce_refund_gift_card_receipt();

-- Widen only the exact receipt-bound message tuple on the shared delivery seam.
alter function public.is_refund_receipt_completion_message(jsonb) rename to is_refund_receipt_completion_pre_gift_card;
create function public.is_refund_receipt_completion_message(p_message jsonb) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_refund_receipt_completion_pre_gift_card(p_message) or public.is_refund_gift_card_message(p_message);
$$;
alter function public.is_refund_receipt_automatic_completion_message(uuid) rename to is_refund_receipt_auto_pre_gift_card;
create function public.is_refund_receipt_automatic_completion_message(p_message_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_refund_receipt_auto_pre_gift_card(p_message_id) or exists(select 1 from public.refund_case_messages m
    where m.id=p_message_id and m.status='pending' and public.is_refund_gift_card_message(to_jsonb(m)));
$$;
do $patch$
declare n text; shape text; definition text;
begin
  foreach n in array array['refund_case_messages_manual_delivery_intent_check','refund_case_messages_safe_evidence_shape'] loop
    select pg_get_constraintdef(oid) into shape from pg_constraint
      where conrelid='public.refund_case_messages'::regclass and conname=n;
    if shape is null then raise exception 'Missing existing outbox constraint %',n; end if;
    execute format('alter table public.refund_case_messages drop constraint %I',n);
    execute format('alter table public.refund_case_messages add constraint %I CHECK (%s OR
      (delivery_kind=''automatic'' and content_source=''deterministic_template'' and message_type=''completed''
       and template_version=''refund_gift_card_v1'' and manual_delivery_intent_id is not null
       and manual_delivery_expected_case_version>0 and manual_delivery_state is not null
       and reason_code is null and cardinality(requested_fields)=0
       and follow_up_cycle_id is null and payout_destination_follow_up_id is null and appeal_id is null))',n,substring(shape from 7));
  end loop;
  -- The common recovery worker must preserve unknown transport outcomes for
  -- gift-card notices using the same rule as original-payment completions.
  definition:=pg_get_functiondef('public.service_claim_refund_manual_message_deliveries(uuid,integer)'::regprocedure);
  definition:=replace(definition,'message_row.template_version=''refund_receipt_completion_v1''',
    'message_row.template_version in (''refund_receipt_completion_v1'',''refund_gift_card_v1'')');
  execute definition;
  definition:=pg_get_functiondef('public.refund_completion_outbox_postcommit_wakeup()'::regprocedure);
  execute replace(definition,'new.template_version=''refund_receipt_completion_v1''',
    'new.template_version in (''refund_receipt_completion_v1'',''refund_gift_card_v1'')');
  definition:=pg_get_functiondef('public.refund_case_lifecycle_integrity_code(uuid)'::regprocedure);
  execute replace(definition,'when refund_case.case_population = ''internal_test'' then null',
    'when refund_case.case_population = ''internal_test'' or refund_case.resolution_method=''gift_card'' then null');
  definition:=pg_get_functiondef('public.guard_refund_case_active_nayax_attempt()'::regprocedure);
  if strpos(definition,'if new.payment_method = ''card''')=0 then raise exception 'Card settlement guard changed'; end if;
  execute replace(definition,'if new.payment_method = ''card''',
    'if new.payment_method = ''card'' and new.resolution_method=''original_payment''');
  -- Inferred proximity is a money-refund investigation rule. Gift-card repeats
  -- are decided by the serialized annual allowance; confirmed duplicates still
  -- hit the unchanged explicit duplicate guard and the gift settlement guard.
  definition:=pg_get_functiondef('public.assert_refund_case_reconciliation_safe()'::regprocedure);
  if strpos(definition,'if public.refund_case_has_unresolved_reconciliation(new.id) then')=0 then
    raise exception 'Refund reconciliation guard changed'; end if;
  execute replace(definition,'if public.refund_case_has_unresolved_reconciliation(new.id) then',
    'if new.resolution_method=''original_payment'' and public.refund_case_has_unresolved_reconciliation(new.id) then');
end $patch$;

-- An explicitly accepted gift card is transactional fulfillment. The switch
-- for unsolicited follow-up remains unchanged for every other refund message.
do $patch$ declare definition text; begin
  definition:=pg_get_functiondef('public.guard_refund_follow_up_message()'::regprocedure);
  if strpos(definition,'if attempting_automatic_delivery then')=0 then raise exception 'Follow-up guard changed'; end if;
  execute replace(definition,'if attempting_automatic_delivery then',
    'if attempting_automatic_delivery and not public.is_refund_gift_card_message(to_jsonb(new)) then');
  definition:=pg_get_functiondef('public.service_authorize_refund_customer_outbound(uuid,text,text[],text)'::regprocedure);
  if strpos(definition,'if not coalesce(settings_row.automatic_customer_contact_enabled, false) then')=0 then
    raise exception 'Customer delivery switch changed'; end if;
  execute replace(definition,'if not coalesce(settings_row.automatic_customer_contact_enabled, false) then',
    'if not coalesce(settings_row.automatic_customer_contact_enabled, false)
      and not exists(select 1 from public.refund_case_messages gift_message
        where gift_message.refund_case_id=case_row.id and gift_message.status=''pending''
          and gift_message.recipient_email=normalized_recipient
          and public.is_refund_gift_card_message(to_jsonb(gift_message))) then');
  definition:=pg_get_functiondef('public.service_mark_refund_manual_message_provider_attempt(uuid,uuid)'::regprocedure);
  if strpos(definition,'if not exists(select 1 from public.refund_customer_contact_settings settings')=0 then
    raise exception 'Provider attempt switch changed'; end if;
  execute replace(definition,'if not exists(select 1 from public.refund_customer_contact_settings settings',
    'if not public.is_refund_gift_card_message(to_jsonb(message_row))
      and not exists(select 1 from public.refund_customer_contact_settings settings');
end $patch$;

-- Own-message identity is append-only; provider bookkeeping remains mutable.
create function public.guard_refund_gift_card_message() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.template_version='refund_gift_card_v1' then
      if current_user in ('anon','authenticated','service_role') then raise exception 'Gift-card receipt required'; end if;
      if not public.is_refund_gift_card_message(to_jsonb(new)) then raise exception 'Gift-card receipt required'; end if;
    end if;
  elsif old.template_version='refund_gift_card_v1' then
    if tg_op='DELETE' or new.gift_card_issuance_id is distinct from old.gift_card_issuance_id
      or new.gift_card_message_identity_digest is distinct from old.gift_card_message_identity_digest
      or public.refund_receipt_completion_message_digest(to_jsonb(old))
      is distinct from public.refund_receipt_completion_message_digest(to_jsonb(new)) then
      raise exception 'Gift-card delivery identity is immutable';
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger aa_refund_gift_card_message_identity before insert or update or delete on public.refund_case_messages
  for each row execute function public.guard_refund_gift_card_message();

-- All new capabilities default private; expose only existing actor-scoped read
-- and decision entrypoints, and exact service issuance/offer/recovery functions.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('guard_refund_gift_card_code','service_get_refund_gift_card_offer','service_refund_gift_card_enabled','refund_gift_card_quote_template_verified',
      'refund_gift_card_case_projection','get_refund_gift_card_case','is_refund_gift_card_message',
      'refund_gift_card_automatic_eligible',
      'service_issue_refund_gift_card','admin_decide_refund_gift_card','service_resume_refund_gift_card_cases',
      'service_renew_refund_gift_card_pool','service_accept_refund_gift_card_offer',
      'admin_resend_refund_gift_card',
      'issue_refund_gift_card_after_intake','guard_refund_gift_card_settlement','guard_refund_gift_card_message',
      'enforce_refund_gift_card_receipt',
      'is_refund_receipt_completion_message','is_refund_receipt_automatic_completion_message') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $$;
grant execute on function public.service_get_refund_gift_card_offer(uuid,integer),public.service_refund_gift_card_enabled(uuid),
  public.service_issue_refund_gift_card(uuid),public.service_resume_refund_gift_card_cases() to service_role;
grant execute on function public.service_renew_refund_gift_card_pool(uuid,timestamptz),
  public.service_accept_refund_gift_card_offer(uuid,uuid,integer,timestamptz) to service_role;
grant execute on function public.get_refund_gift_card_case(uuid),
  public.admin_decide_refund_gift_card(uuid,boolean,text),public.admin_resend_refund_gift_card(uuid,uuid,text) to authenticated;
select pg_notify('pgrst','reload schema');

-- Reuse the established lifecycle vocabulary and queue. The distinct gift-card
-- receipt/UI carries the fulfillment facts; the legacy paymentState stays
-- not_requested so a gift card is never represented as money paid.
alter function public.refund_lifecycle_contract(uuid) rename to refund_lifecycle_pre_gift_card;
create function public.refund_lifecycle_contract(p_refund_case_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; c public.refund_cases; g jsonb; notice_state text; is_terminal boolean;
begin
  base:=public.refund_lifecycle_pre_gift_card(p_refund_case_id);
  select * into c from public.refund_cases where id=p_refund_case_id;
  if c.resolution_method<>'gift_card' then return base; end if;
  g:=public.refund_gift_card_case_projection(c.id);
  notice_state:=coalesce(g->>'delivery_state','not_queued');
  is_terminal:=c.gift_card_state='denied' or (c.gift_card_state='issued' and notice_state in ('sent','delivered'));
  return base||jsonb_build_object('resolutionMethod','gift_card','gift_card',g,
    'paymentState','not_requested','paymentWorkComplete',c.gift_card_state='issued',
    'terminal',is_terminal,'refreshAfterSeconds',case when is_terminal then null else 5 end,
    'customerAction',jsonb_build_object('required',false,'requestedFields','[]'::jsonb,'payloadRedacted',true),
    'stage',case when c.gift_card_state='denied' then 'denied' when is_terminal then 'customer_notified' else 'matching' end,
    'publicCopyKey',case when c.gift_card_state='denied' then 'refund_denied' when is_terminal then 'refund_customer_notified' else 'refund_request_received' end,
    'nextWork',coalesce(base->'nextWork','{}'::jsonb)||jsonb_build_object(
      'schemaVersion','refund_next_work_v1','actor',case when c.gift_card_state='manager_review' then 'manager' else 'system' end,
      'actionCode',case when is_terminal then 'none' when c.gift_card_state='manager_review' then 'approve_or_deny_request' else 'none' end,
      'actionLabel',case c.gift_card_state when 'manager_review' then 'Review the previous gift card and decide this request.'
        when 'pending_inventory' then 'The System is preparing compatible gift-card stock.'
        when 'issued' then case when is_terminal then 'Gift card sent.' else 'The System is delivering the assigned gift card.' end
        else 'Gift-card request declined.' end,
      'isOpen',not is_terminal,'payloadRedacted',true),
    'decisionRecommendation',null,
    'managerQueue',jsonb_build_object('schemaVersion','refund_manager_queue_v2',
      'bucket',case when is_terminal then 'closed' when c.gift_card_state='manager_review' then 'decision_needed' else 'system_processing' end,
      'label',case when c.gift_card_state='manager_review' then 'Gift-card exception needs a decision' else 'Gift-card resolution' end,
      'nextAction',case when c.gift_card_state='manager_review' then 'approve_or_deny' else 'none' end,
      'safeRetryEligible',false,'customerActionFields','[]'::jsonb,'payloadRedacted',true));
end $$;
revoke all on function public.refund_lifecycle_pre_gift_card(uuid),public.refund_lifecycle_contract(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.refund_lifecycle_contract(uuid) to service_role;

create function public.refund_project_gift_card_overview(p_base jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb:=p_base; cases jsonb; field_name text;
begin
  foreach field_name in array array['cases','internalTestCases'] loop
  if jsonb_typeof(base->field_name)='array' then
  select coalesce(jsonb_agg(case when c.resolution_method='gift_card' then item.value||jsonb_build_object(
    'resolutionMethod','gift_card','gift_card',public.refund_gift_card_case_projection(c.id),
    'lifecycle',public.refund_lifecycle_contract(c.id)) else item.value end order by item.ordinality),'[]'::jsonb)
    into cases from jsonb_array_elements(base->field_name) with ordinality item
    left join public.refund_cases c on c.id=(item.value->>'id')::uuid;
  base:=jsonb_set(base,array[field_name],cases,true);
  end if;
  end loop;
  return base;
end $$;
revoke all on function public.refund_project_gift_card_overview(jsonb)
  from public,anon,authenticated,service_role;
do $$ declare definition text; begin
  definition:=pg_get_functiondef('public.admin_get_refund_operations_overview()'::regprocedure);
  if strpos(definition,'return base;')=0 then raise exception 'Overview projection changed'; end if;
  execute replace(definition,'return base;','return public.refund_project_gift_card_overview(base);');
end $$;

-- Keep lightweight queue ordering/counts and the existing four view buckets.
do $patch$ declare definition text; begin
  definition:=pg_get_functiondef('public.get_refund_portal_queue_projection(timestamptz)'::regprocedure);
  definition:=replace(definition,'refund_case.payment_method,','refund_case.payment_method, refund_case.resolution_method, refund_case.gift_card_state,');
  definition:=replace(definition,E'    is_waiting := is_open',E'    if case_record.resolution_method=''gift_card'' then\n'
    ||E'      is_decision:=is_open and case_record.gift_card_state=''manager_review'' and actor_can_act;\n'
    ||E'    end if;\n    is_waiting := is_open');
  definition:=replace(definition,'''caseId'', case_record.id,',
    '''caseId'', case_record.id, ''resolutionMethod'',case_record.resolution_method,');
  execute definition;
  definition:=pg_get_functiondef('public.service_read_refund_status_capability(text,text)'::regprocedure);
  -- Add the redacted terms only after the original capability/expiry/rate guard.
  definition:=replace(definition,'''lifecycle'', customer_lifecycle,',
    '''lifecycle'', customer_lifecycle, ''gift_card'',public.refund_gift_card_case_projection(capability.refund_case_id),');
  execute definition;
end $patch$;
