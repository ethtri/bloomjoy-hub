-- #1726: customer request intake totals, separate from accounting impact,
-- prepared decisions, settled payments and gift-card face value.
create function private.email_alert_customer_requested_usd(p_case public.refund_cases)
returns bigint language plpgsql stable security definer set search_path='' as $$
declare opening private.refund_request_recognition_events;
begin
 if p_case.case_population is distinct from 'customer' or p_case.duplicate_of_refund_case_id is not null then return null;end if;
 -- Expected-change courtesy requests intentionally have no purchase-deduction
 -- event. This is the saved customer-entered change request, not the later
 -- Manager-editable affected amount or the rounded gift value.
 if p_case.issue_category='expected_cash_change' then
  if p_case.customer_request_received_source='hosted_refund_intake' and p_case.payment_method='cash'
   and p_case.expected_change_amount_cents>0 and p_case.expected_change_amount_cents<p_case.cash_inserted_amount_cents then
   return p_case.expected_change_amount_cents::bigint;
  end if;
  return null;
 end if;
 select * into opening from private.refund_request_recognition_events e
 where e.refund_case_id=p_case.id and e.event_kind in ('request_received','late_request_opening')
 order by e.recorded_at,e.id limit 1;
 -- Hosted intake accepts customer amounts in USD. Legacy/provider amounts
 -- without that original provenance remain unknown rather than guessed USD.
 if opening.amount_provenance='hosted_intake_customer_charge_estimate'
  and opening.amount_basis='tax_inclusive' and opening.request_target_after_cents>0 then
  return opening.request_target_after_cents;
 end if;
 return null;
end $$;
revoke all on function private.email_alert_customer_requested_usd(public.refund_cases) from public,anon,authenticated,service_role;

create function private.email_alert_digest_metadata(p_user_id uuid,p_machine_id uuid,p_date_from date,p_date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare scope record;current_count integer;current_known integer;current_amount bigint;
 previous_count integer;previous_known integer;previous_amount bigint;
begin
 if p_date_from is null or p_date_to is null or p_date_to<p_date_from or p_date_to-p_date_from>6 then
  raise exception 'Valid digest period required' using errcode='22023';
 end if;
 select s.timezone,s.is_manager,m.account_id,left(a.name,240) account_name into scope
 from private.email_alert_machine_scope(p_user_id) s
 join public.reporting_machines m on m.id=s.machine_id
 join public.customer_accounts a on a.id=m.account_id where s.machine_id=p_machine_id;
 if not found then raise exception 'Assigned machine required' using errcode='42501';end if;
 with requests as materialized (
  select (c.customer_request_received_at at time zone scope.timezone)::date request_date,
   case when scope.is_manager then private.email_alert_customer_requested_usd(c) end amount
  from public.refund_cases c
  where c.reporting_machine_id=p_machine_id and c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and c.customer_request_received_at>=((p_date_from-7)::timestamp at time zone scope.timezone)
   and c.customer_request_received_at<((p_date_to+1)::timestamp at time zone scope.timezone)
 )
 select (count(*) filter(where request_date between p_date_from and p_date_to))::integer,
  (count(amount) filter(where request_date between p_date_from and p_date_to))::integer,
  (sum(amount) filter(where request_date between p_date_from and p_date_to))::bigint,
  (count(*) filter(where request_date between p_date_from-7 and p_date_to-7))::integer,
  (count(amount) filter(where request_date between p_date_from-7 and p_date_to-7))::integer,
  (sum(amount) filter(where request_date between p_date_from-7 and p_date_to-7))::bigint
 into current_count,current_known,current_amount,previous_count,previous_known,previous_amount from requests;
 return jsonb_build_object('accountId',scope.account_id,'accountName',scope.account_name,
  'newRequestCount',current_count,'requestAmountsAllowed',scope.is_manager,
  'requestedAmountCents',case when scope.is_manager and current_count=0 then 0 else current_amount end,
  'requestedAmountKnownCount',current_known,'requestedAmountUnknownCount',current_count-current_known,
  'previousNewRequestCount',previous_count,
  'previousRequestedAmountCents',case when scope.is_manager and previous_count=0 then 0 else previous_amount end,
  'previousRequestedAmountKnownCount',previous_known,'previousRequestedAmountUnknownCount',previous_count-previous_known);
end $$;
revoke all on function private.email_alert_digest_metadata(uuid,uuid,date,date) from public,anon,authenticated,service_role;

do $$declare definition text;old_part text;new_part text;begin
 definition:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 old_part:=$old$new_case:=p_category='new-refund' or (case_row.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to;$old$;
 new_part:=$new$new_case:=p_category='new-refund' or (case_row.case_population='customer' and case_row.duplicate_of_refund_case_id is null
     and (case_row.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to);$new$;
 if strpos(definition,old_part)=0 then raise exception 'Digest intake case boundary changed';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:=$old$'previousGrossSalesCents',previous.gross,'refundCases',cases));$old$;
 new_part:=$new$'previousGrossSalesCents',previous.gross,'refundCases',cases)
    ||case when p_category in ('daily','weekly') then jsonb_build_object('digest',
      private.email_alert_digest_metadata(p_user_id,machine_row.machine_id,machine_from,machine_to)) else '{}'::jsonb end);$new$;
 if strpos(definition,old_part)=0 then raise exception 'Digest machine JSON boundary changed';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end $$;
select pg_notify('pgrst','reload schema');
