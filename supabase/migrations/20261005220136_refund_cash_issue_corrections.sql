-- Extend the existing same-case capability. No customer contacts, decisions,
-- refund amounts, payouts, or reporting adjustments are created by this migration.
begin;

create function pg_temp.refund_cash_patch(p_signature text,p_old text,p_new text) returns void
language plpgsql as $$
declare d text;
begin
  d:=replace(pg_get_functiondef(p_signature::regprocedure),E'\r\n',E'\n');
  p_old:=replace(p_old,E'\r\n',E'\n'); p_new:=replace(p_new,E'\r\n',E'\n');
  if cardinality(string_to_array(d,p_old))<>2 then
    raise exception 'Cash clarification expected one anchor in %: %',p_signature,p_old;
  end if;
  execute replace(d,p_old,p_new);
end $$;

create function public.refund_cash_clarification_eligible(p_case public.refund_cases)
returns boolean language sql stable security definer set search_path='' as $$
  select public.refund_purchase_correction_eligible(p_case)
    and p_case.decision is null and p_case.payment_method='cash'
    and p_case.issue_category in ('wrong_amount','expected_cash_change');
$$;
revoke all on function public.refund_cash_clarification_eligible(public.refund_cases) from public,anon,authenticated;
grant execute on function public.refund_cash_clarification_eligible(public.refund_cases) to service_role;

select pg_temp.refund_cash_patch('public.canonical_refund_follow_up_fields(text[])',
  $$('amount',13),('zelle_payment_contact',14)$$,
  $$('amount',13),('zelle_payment_contact',14),('issue_summary',15),('cash_inserted_amount',16),('expected_change_amount',17)$$);
select pg_temp.refund_cash_patch('public.refund_purchase_correction_values(public.refund_cases)',
  $$'zelle_payment_contact',p_case.zelle_payment_contact$$,
  $$'zelle_payment_contact',p_case.zelle_payment_contact,
    'issue_summary',nullif(btrim(p_case.issue_summary),''),
    'cash_inserted_amount',case when p_case.cash_inserted_amount_cents>0 then to_char(p_case.cash_inserted_amount_cents::numeric/100,'FM999990.00') end,
    'expected_change_amount',case when p_case.expected_change_amount_cents>0 then to_char(p_case.expected_change_amount_cents::numeric/100,'FM999990.00') end$$);

alter function public.refund_purchase_correction_request_fields(uuid) rename to refund_correction_fields_pre_cash_clarification_v1;
revoke all on function public.refund_correction_fields_pre_cash_clarification_v1(uuid) from public,anon,authenticated,service_role;
create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[] language plpgsql stable security definer set search_path='' as $$
declare c public.refund_cases; fields text[]; additions text[]:='{}'; vals jsonb;
begin
  fields:=public.refund_correction_fields_pre_cash_clarification_v1(p_case_id);
  select * into c from public.refund_cases where id=p_case_id;
  if not coalesce(public.refund_cash_clarification_eligible(c),false) then return fields; end if;
  if c.resolution_method='gift_card' then fields:=array_remove(fields,'zelle_payment_contact'); end if;
  if nullif(btrim(c.issue_summary),'') is null then additions:=array_append(additions,'issue_summary'); end if;
  if c.cash_inserted_amount_cents is null then additions:=array_append(additions,'cash_inserted_amount'); end if;
  if c.expected_change_amount_cents is null then additions:=array_append(additions,'expected_change_amount'); end if;
  vals:=public.refund_purchase_correction_values(c);
  -- Respect a saved 'not sure' response. Re-open only if the underlying fact
  -- changed since that response, using the same rule as other correction facts.
  additions:=array(select field from unnest(additions) field where not exists(
    select 1 from public.refund_wallet_correction_contexts ctx
    where ctx.refund_case_id=c.id and ctx.correction_kind='purchase' and ctx.status='submitted'
      and ctx.correction_response ? field
      and (ctx.correction_response->field->>'disposition'='changed'
        and vals->>field is not distinct from ctx.correction_response->field->>'value'
        or ctx.correction_response->field->>'disposition' in ('confirmed','cannot_provide')
        and vals->>field is not distinct from ctx.correction_snapshot->>field)));
  return public.canonical_refund_follow_up_fields(fields||additions);
end $$;
revoke all on function public.refund_purchase_correction_request_fields(uuid) from public,anon,authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid) to service_role;

-- An old Zelle-only link stays Zelle-only. Only a newly scoped, undecided cash
-- request can combine its missing payout contact with clarification facts.
select pg_temp.refund_cash_patch('public.service_enqueue_refund_manual_message_intent_pre_payout_recover(uuid,bigint,uuid,uuid,text,text,text,text,text,text,text,text[],uuid,boolean,uuid)',
  $$p_requested_fields is distinct from array['zelle_payment_contact']::text[]$$,
  $$(p_requested_fields is distinct from array['zelle_payment_contact']::text[]
        and not (p_message_type='more_info'
          and position('[Secure refund correction link included at delivery]' in normalized_body)>0
          and public.refund_purchase_correction_links_enabled()
          and public.refund_cash_clarification_eligible(case_row)
          and case_row.resolution_method='original_payment'
          and p_requested_fields && array['issue_summary','cash_inserted_amount','expected_change_amount']::text[]
          and p_requested_fields <@ public.refund_purchase_correction_request_fields(case_row.id)))$$);
select pg_temp.refund_cash_patch('public.service_issue_refund_purchase_correction_pre_revision(uuid,text,bigint)',
  $$('zelle_payment_contact'=any(fields) and fields<>array['zelle_payment_contact']::text[])$$,
  $$('zelle_payment_contact'=any(fields) and fields<>array['zelle_payment_contact']::text[]
    and not (public.refund_cash_clarification_eligible(c) and c.resolution_method='original_payment'
      and fields && array['issue_summary','cash_inserted_amount','expected_change_amount']::text[]))$$);
select pg_temp.refund_cash_patch('public.service_get_refund_purchase_correction_pre_renewal_v1(text)',
  $$'nearby_attempt_count','amount']::text[] end$$,
  $$'nearby_attempt_count','amount']::text[]
        || case when public.refund_cash_clarification_eligible(c)
          and r.correction_requested_fields && array['issue_summary','cash_inserted_amount','expected_change_amount']::text[]
          then array['issue_summary','cash_inserted_amount','expected_change_amount']::text[]
            || case when 'zelle_payment_contact'=any(r.correction_requested_fields) and c.resolution_method='original_payment'
              then array['zelle_payment_contact']::text[] else '{}'::text[] end
          else '{}'::text[] end end$$);

select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$payout_only boolean;$$,$$payout_only boolean; cash_clarification boolean;$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$vals := r.correction_snapshot;$$,
  $$cash_clarification:=coalesce(public.refund_cash_clarification_eligible(c),false)
    and r.correction_requested_fields && array['issue_summary','cash_inserted_amount','expected_change_amount']::text[];
  vals := r.correction_snapshot;$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$'card_network','zelle_payment_contact')$$,
  $$'card_network','zelle_payment_contact','issue_summary','cash_inserted_amount','expected_change_amount')$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$(not payout_only and field='zelle_payment_contact')$$,
  $$(not payout_only and field='zelle_payment_contact' and not (cash_clarification
        and c.resolution_method='original_payment' and 'zelle_payment_contact'=any(r.correction_requested_fields)))
      or (field in ('issue_summary','cash_inserted_amount','expected_change_amount') and not cash_clarification)$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$case when field='zelle_payment_contact' then 320 else 160 end$$,
  $$case when field='issue_summary' then 2500 when field='zelle_payment_contact' then 320 else 160 end$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$field='amount' and (value !~$$,
  $$field in ('amount','cash_inserted_amount','expected_change_amount') and (value !~$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$if 'amount'=any(changed_fields) then next_case.payment_amount_cents := round((vals->>'amount')::numeric*100); end if;$$,
  $$if 'amount'=any(changed_fields) then next_case.payment_amount_cents := round((vals->>'amount')::numeric*100); end if;
  if cash_clarification then
    if p_answers ? 'payment_method' and p_answers->'payment_method'->>'disposition'='changed'
      and p_answers->'payment_method'->>'value'<>'cash' then raise exception 'Invalid correction value'; end if;
    if 'issue_summary'=any(changed_fields) then next_case.issue_summary:=vals->>'issue_summary'; end if;
    if 'cash_inserted_amount'=any(changed_fields) then next_case.cash_inserted_amount_cents:=round((vals->>'cash_inserted_amount')::numeric*100); end if;
    if 'expected_change_amount'=any(changed_fields) then next_case.expected_change_amount_cents:=round((vals->>'expected_change_amount')::numeric*100); end if;
    if next_case.cash_inserted_amount_cents is not null and next_case.expected_change_amount_cents is not null
      and next_case.expected_change_amount_cents>=next_case.cash_inserted_amount_cents then raise exception 'Invalid correction value'; end if;
    if 'zelle_payment_contact'=any(changed_fields) then next_case.zelle_payment_contact:=vals->>'zelle_payment_contact'; end if;
    needs_human:=true;
  end if;$$);
select pg_temp.refund_cash_patch('public.service_submit_refund_purchase_correction(text,bigint,jsonb)',
  $$payment_method=next_case.payment_method,payment_amount_cents=next_case.payment_amount_cents,$$,
  $$payment_method=next_case.payment_method,payment_amount_cents=next_case.payment_amount_cents,
    issue_summary=next_case.issue_summary,cash_inserted_amount_cents=next_case.cash_inserted_amount_cents,
    expected_change_amount_cents=next_case.expected_change_amount_cents,zelle_payment_contact=next_case.zelle_payment_contact,$$);

-- New evidence invalidates previously delivered versions exactly like the
-- existing payment/time facts; payout-only behavior is otherwise untouched.
select pg_temp.refund_cash_patch('public.guard_refund_deterministic_fact_version()',
  $$or new.zelle_payment_contact is distinct from old.zelle_payment_contact then$$,
  $$or new.zelle_payment_contact is distinct from old.zelle_payment_contact
    or new.issue_summary is distinct from old.issue_summary
    or new.cash_inserted_amount_cents is distinct from old.cash_inserted_amount_cents
    or new.expected_change_amount_cents is distinct from old.expected_change_amount_cents then$$);
drop trigger if exists refund_cases_guard_deterministic_fact_version on public.refund_cases;
create trigger refund_cases_guard_deterministic_fact_version before update of
  reporting_machine_id,reporting_location_id,incident_at,incident_local_datetime,incident_timezone,
  incident_time_resolution,incident_time_confidence,incident_time_source,payment_method,payment_amount_cents,
  card_last4,card_last4_provenance,card_last4_source,card_network,card_wallet_used,payment_interaction,
  wallet_provider,wallet_device_kind,nearby_attempt_count,zelle_payment_contact,deterministic_fact_version,
  deterministic_facts_updated_at,issue_summary,cash_inserted_amount_cents,expected_change_amount_cents
on public.refund_cases for each row execute function public.guard_refund_deterministic_fact_version();

commit;
