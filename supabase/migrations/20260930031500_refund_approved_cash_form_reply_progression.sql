-- Keep an approved cash refund on its protected payout path when the existing
-- secure correction form supplies the one missing Zelle destination. This
-- changes no decision or payment fact and retires only the bound reminder.
alter table public.refund_payout_destination_follow_ups
  add column if not exists satisfied_by_correction_context_id uuid unique
    references public.refund_wallet_correction_contexts(id) on delete restrict;

alter table public.refund_payout_destination_follow_ups
  drop constraint if exists refund_payout_destination_follow_up_satisfied_shape,
  add constraint refund_payout_destination_follow_up_satisfied_shape check (
    (status='satisfied' and satisfied_at is not null
      and num_nonnulls(satisfied_by_gmail_message_id,
        satisfied_by_correction_context_id)=1)
    or (status<>'satisfied' and satisfied_by_gmail_message_id is null
      and satisfied_by_correction_context_id is null and satisfied_at is null)
  );

do $migration$
declare
  source_definition text := pg_catalog.pg_get_functiondef(
    'public.service_submit_refund_purchase_correction(text,bigint,jsonb)'::regprocedure);
  old_branch text := $old$
  if payout_only then
    update public.refund_cases set zelle_payment_contact=case when 'zelle_payment_contact'=any(changed_fields) then vals->>'zelle_payment_contact' else c.zelle_payment_contact end,
      status='needs_review',automation_state='customer_replied',automation_follow_up_due_at=null where id=c.id returning * into next_case;
    update public.refund_payout_destination_follow_ups set status='manual_review',manual_review_at=statement_timestamp(),
      reminder_claim_token=null,updated_at=statement_timestamp() where refund_case_id=c.id and status in ('waiting','reminder_claimed','reminder_sent');
    needs_human:=true;
  else$old$;
  new_branch text := $new$
  if payout_only then
    update public.refund_cases set
      zelle_payment_contact=case when 'zelle_payment_contact'=any(changed_fields)
        then vals->>'zelle_payment_contact' else c.zelle_payment_contact end,
      status=case when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then 'cash_zelle_pending' else 'needs_review' end,
      automation_state=case when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then 'under_review' else 'customer_replied' end,
      automation_follow_up_due_at=null
      where id=c.id returning * into next_case;
    update public.refund_payout_destination_follow_ups set
      status=case when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then 'satisfied' else 'manual_review' end,
      manual_review_at=case when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then null else statement_timestamp() end,
      satisfied_by_correction_context_id=case
        when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then r.id else null end,
      satisfied_at=case when c.status='cash_zelle_pending' and c.decision='approved'
          and c.payment_method='cash'
          and 'zelle_payment_contact'=any(changed_fields)
          and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null
        then statement_timestamp() else null end,
      reminder_claim_token=null,updated_at=statement_timestamp()
      where request_message_id=r.correction_message_id
        and refund_case_id=c.id
        and status in ('waiting','reminder_claimed','reminder_sent');
    needs_human:=not (c.status='cash_zelle_pending' and c.decision='approved'
      and c.payment_method='cash'
      and 'zelle_payment_contact'=any(changed_fields)
      and nullif(btrim(coalesce(vals->>'zelle_payment_contact','')),'') is not null);
  else$new$;
begin
  if cardinality(pg_catalog.string_to_array(source_definition,old_branch))<>2 then
    raise exception 'Unexpected payout-only correction submit source';
  end if;
  execute pg_catalog.replace(source_definition,old_branch,new_branch);
end;
$migration$;

-- Recover only the already-observed form-response shape produced by the prior
-- branch. The submitted capability and its exact request remain the evidence;
-- no free text is interpreted and no payment state is advanced.
do $recovery$
declare recovered record;
begin
  for recovered in
    select c.id,r.id as request_id,r.correction_message_id
    from public.refund_cases c
    join public.refund_wallet_correction_contexts r
      on r.refund_case_id=c.id and r.correction_kind='purchase'
    join public.refund_case_messages m on m.id=r.correction_message_id
    join public.refund_payout_destination_follow_ups f
      on f.refund_case_id=c.id and f.request_message_id=m.id
    where c.status='needs_review' and c.automation_state='customer_replied'
      and c.decision='approved' and c.payment_method='cash'
      and nullif(btrim(coalesce(c.zelle_payment_contact,'')),'') is not null
      and c.nayax_refund_execution_status='not_requested'
      and c.refund_completed_at is null and c.refund_completed_by is null
      and c.reporting_adjustment_id is null
      and nullif(btrim(coalesce(c.manual_refund_reference,'')),'') is null
      and not exists(select 1 from public.refund_authoritative_receipts receipt
        where receipt.refund_case_id=c.id)
      and not exists(select 1 from public.refund_case_nayax_refund_attempts attempt
        where attempt.refund_case_id=c.id)
      and r.status='submitted'
      and r.correction_requested_fields=array['zelle_payment_contact']::text[]
      and r.correction_resulting_fact_version=c.deterministic_fact_version
      and r.correction_response=jsonb_build_object('zelle_payment_contact',
        jsonb_build_object('disposition','changed','value',c.zelle_payment_contact))
      and m.refund_case_id=c.id and m.status='sent'
      and m.requested_fields=array['zelle_payment_contact']::text[]
      and not public.is_refund_message_recorded_delivery_failure(to_jsonb(m))
      and coalesce(m.delivery_state,'') not in ('failed','bounced','complained')
      and f.status='manual_review' and f.manual_review_at is not null
      and f.satisfied_by_gmail_message_id is null
      and f.satisfied_by_correction_context_id is null
      and not exists(select 1 from public.refund_wallet_correction_contexts newer
        where newer.refund_case_id=c.id and newer.correction_kind='purchase'
          and (newer.version,newer.issued_at,newer.id)>(r.version,r.issued_at,r.id))
      and public.refund_lifecycle_contract(c.id)#>>'{nextWork,actionCode}'='review_customer_reply'
      and public.refund_lifecycle_contract(c.id)#>>'{nextWork,blocker,code}'='payout_destination_review_pending'
    for update of c
  loop
    update public.refund_cases set status='cash_zelle_pending',
      automation_state='under_review',automation_follow_up_due_at=null,
      updated_at=statement_timestamp()
      where id=recovered.id;
    update public.refund_payout_destination_follow_ups set
      status='satisfied',manual_review_at=null,
      satisfied_by_correction_context_id=recovered.request_id,
      satisfied_at=statement_timestamp(),updated_at=statement_timestamp()
      where refund_case_id=recovered.id
        and request_message_id=recovered.correction_message_id
        and status='manual_review';
    insert into public.refund_case_events(refund_case_id,event_type,message,metadata)
    values(recovered.id,'refund_approved_cash_destination_review_recovered',
      'The verified secure-form destination restored the existing approved cash payout path.',
      jsonb_build_object('request_id',recovered.request_id,
        'request_message_id',recovered.correction_message_id,
        'decision_unchanged',true,'payment_action_created',false,
        'payload_redacted',true));
  end loop;
end;
$recovery$;

revoke all on function public.service_submit_refund_purchase_correction(
  text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.service_submit_refund_purchase_correction(
  text,bigint,jsonb) to service_role;

comment on column public.refund_payout_destination_follow_ups.satisfied_by_correction_context_id is
  'Exact submitted secure-form context that supplied the missing payout destination; mutually exclusive with Gmail reply satisfaction.';

select pg_notify('pgrst','reload schema');
