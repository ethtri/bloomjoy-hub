-- Preserve existing immutable history, contact policy and transport bookkeeping.
-- Only new messages carrying the delivery placeholder use the scoped contract.
do $migration$
declare source text; original text; needle text; replacement text; shape text;
begin
  select pg_get_functiondef('public.guard_refund_follow_up_message()'::regprocedure) into source;
  source := replace(source,E'\r\n',E'\n');
  original := source;
  needle := '  reconciling_known_transactional_delivery boolean := false;';
  if position(needle in source)=0 then raise exception 'Follow-up guard declaration changed'; end if;
  source := replace(source,needle,needle || E'\n  scoped_correction boolean := position(''[Secure refund correction link included at delivery]'' in new.body)>0;');
  needle := '  if tg_op = ''UPDATE'' and old.delivery_kind = ''automatic'' then';
  replacement := $guard$
  if scoped_correction and (tg_op='INSERT' or (old.status='pending' and new.status='sent')) then
    select * into case_row from public.refund_cases where id=new.refund_case_id for share;
    expected_missing := public.refund_purchase_correction_request_fields(new.refund_case_id);
    if not public.refund_purchase_correction_eligible(case_row)
      or lower(btrim(new.recipient_email)) is distinct from lower(btrim(case_row.customer_email))
      or cardinality(new.requested_fields)=0
      or not new.requested_fields <@ expected_missing
      or new.message_type not in ('more_info','no_safe_match','reminder','wallet_correction','wallet_correction_reminder') then
      raise exception 'Scoped correction requires current specific customer fields';
    end if;
    if new.status='sent' and not exists (
      select 1 from public.refund_wallet_correction_contexts r
      where r.correction_message_id=new.id and r.refund_case_id=new.refund_case_id
        and r.correction_kind='purchase' and r.status='pending' and r.expires_at>statement_timestamp()
        and r.correction_fact_version=case_row.deterministic_fact_version
        and r.correction_requested_fields=new.requested_fields
    ) then raise exception 'Sent correction requires its valid scoped capability'; end if;
  end if;
$guard$;
  if position(needle in source)=0 then raise exception 'Follow-up guard entry changed'; end if;
  source := replace(source,needle,replacement || E'\n' || needle);
  needle := '      or case_row.card_wallet_used is true';
  if position(needle in source)=0 then raise exception 'Manual wallet guard changed'; end if;
  source := replace(source,needle,'      or (case_row.card_wallet_used is true and not scoped_correction)');
  needle := '      or new.requested_fields <> expected_missing then';
  if position(needle in source)=0 then raise exception 'Manual field guard changed'; end if;
  source := replace(source,needle,'      or (new.requested_fields <> expected_missing and not scoped_correction) then');
  -- The old missing-field helper deliberately excludes wallet digits. For new
  -- scoped manual requests use the safe shared server-derived field contract.
  needle := E'    if case_row.id is null\n      or case_row.status in';
  if position(needle in source)=0 then raise exception 'Manual case guard changed'; end if;
  source := replace(source,needle,E'    if scoped_correction then expected_missing := public.refund_purchase_correction_request_fields(new.refund_case_id); end if;\n' || needle);
  needle := '    or new.requested_fields <> cycle_row.requested_fields then';
  if position(needle in source)=0 then raise exception 'Cycle field guard changed'; end if;
  source := replace(source,needle,'    or (new.requested_fields <> cycle_row.requested_fields and not scoped_correction) then');
  needle := '  if new.message_type in (''wallet_correction'', ''wallet_correction_reminder'') then';
  replacement := $wallet$
  if scoped_correction and new.message_type in ('wallet_correction','wallet_correction_reminder') then
    if new.delivery_kind <> 'automatic' or new.content_source <> 'deterministic_template'
      or new.follow_up_cycle_id is not null or new.reason_code is not null
      or new.template_version <> case new.message_type when 'wallet_correction' then 'refund_wallet_correction_v1' else 'refund_wallet_correction_reminder_v1' end
      or (new.status='sent' and new.sent_at is null) then
      raise exception 'Scoped wallet correction requires tracked automatic delivery';
    end if;
    return new;
  end if;
$wallet$;
  if position(needle in source)=0 then raise exception 'Wallet message guard changed'; end if;
  source := replace(source,needle,replacement || E'\n' || needle);
  if source=original then raise exception 'Scoped delivery guard was not installed'; end if;
  execute source;

  select pg_get_constraintdef(oid) into shape from pg_constraint
    where conrelid='public.refund_case_messages'::regclass and conname='refund_case_messages_safe_evidence_shape';
  if shape is null or left(shape,6)<>'CHECK ' then raise exception 'Message evidence shape missing'; end if;
  alter table public.refund_case_messages drop constraint refund_case_messages_safe_evidence_shape;
  execute 'alter table public.refund_case_messages add constraint refund_case_messages_safe_evidence_shape CHECK (' || substring(shape from 7) || $shape$
    OR (delivery_kind='automatic' and content_source='deterministic_template'
      and message_type in ('wallet_correction','wallet_correction_reminder')
      and reason_code is null and follow_up_cycle_id is null and payout_destination_follow_up_id is null
      and cardinality(requested_fields)>0
      and position('[Secure refund correction link included at delivery]' in body)>0
      and template_version=case message_type when 'wallet_correction' then 'refund_wallet_correction_v1' else 'refund_wallet_correction_reminder_v1' end))
  $shape$;
end;
$migration$;

-- Old wallet issuance changed waiting state before send. New scopes change it
-- only on the existing message ledger's sent transition, never on link creation.
create function public.sync_refund_scoped_wallet_message() returns trigger
language plpgsql security definer set search_path='' as $$
declare r public.refund_wallet_correction_contexts;
begin
  if new.status='sent' and old.status='pending' and new.message_type in ('wallet_correction','wallet_correction_reminder') then
    select * into r from public.refund_wallet_correction_contexts where correction_message_id=new.id and correction_kind='purchase';
    if r.id is not null then
      update public.refund_cases set status='waiting_on_customer', automation_state='wallet_correction_needed',
        wallet_correction_state='sent', wallet_correction_version=r.version,
        customer_last_contacted_at=new.sent_at,last_customer_message_type=new.message_type,automation_follow_up_due_at=r.expires_at
      where id=new.refund_case_id and public.refund_purchase_correction_eligible(refund_cases);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.sync_refund_scoped_wallet_message() from public,anon,authenticated,service_role;
create trigger refund_scoped_wallet_message_sent after update on public.refund_case_messages
for each row execute function public.sync_refund_scoped_wallet_message();
