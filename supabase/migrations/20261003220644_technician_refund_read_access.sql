-- #1729: operational refund visibility follows current machine assignments.
-- Reading never changes manager mutation, approval, payment or raw-table access.
create function private.refund_request_machine_scope(p_actor uuid)
returns table(machine_id uuid,can_open_manager_workspace boolean)
language sql stable security definer set search_path='' as $$
 with technician as materialized (
  select unnest(public.technician_machine_ids_for_user(p_actor)) id
 )
 select m.id,coalesce(public.can_manage_refund_machine(p_actor,m.id),false)
 from public.reporting_machines m
 where p_actor is not null and (coalesce(public.can_manage_refund_machine(p_actor,m.id),false)
  or exists(select 1 from technician t where t.id=m.id));
$$;
revoke all on function private.refund_request_machine_scope(uuid) from public,anon,authenticated,service_role;

-- Same bounded free-text approach as email_alert_comment, with explicit
-- contact/address/payment redaction. Diagnostic wording stays intact; it is
-- never replaced with an inferred diagnosis. Consumers render this as text.
create function private.refund_request_operational_comment(p_case public.refund_cases)
returns text language plpgsql immutable set search_path='' as $$
declare value text:=p_case.issue_summary; sensitive text;
begin
 foreach sensitive in array array[p_case.customer_email,p_case.customer_name,
  p_case.customer_phone,p_case.zelle_payment_contact,p_case.card_last4,p_case.matched_nayax_card_last4] loop
  if length(coalesce(sensitive,''))>=3 then
   value:=regexp_replace(value,regexp_replace(sensitive,'([\\.\[\]{}()*+?^$|])','\\\1','g'),'[redacted]','gi');
  end if;
 end loop;
 value:=regexp_replace(value,'[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}','[contact redacted]','gi');
 value:=regexp_replace(value,'https?://[^[:space:]]+','[link redacted]','gi');
 value:=regexp_replace(value,'(my name is|name:|contact:|customer:)[[:space:]]+[^.!?;\n]+','[contact redacted]','gi');
 value:=regexp_replace(value,'[[:alpha:]][[:alpha:]''-]*[[:space:]]+[[:alpha:]][[:alpha:]''-]*[[:space:]]+lives[[:space:]]+[^.!?;\n]+','[address redacted]','gi');
 value:=regexp_replace(value,'[0-9]+[[:space:]]+([[:alnum:]#.-]+[[:space:]]+){1,6}(street|st|road|rd|avenue|ave|lane|ln|drive|dr|boulevard|blvd|court|ct)\M[^.!?;\n]*','[address redacted]','gi');
 value:=regexp_replace(value,'(address|zelle|venmo|paypal|cash[[:space:]]?app|routing|bank account|card number|card ending|last four|last 4)[[:space:]:=#-]+[^.!?;\n]+','[payment/contact redacted]','gi');
 value:=regexp_replace(value,'[0-9][0-9 ()+.-]{5,}[0-9]','[number redacted]','g');
 value:=regexp_replace(value,'\m((gift([[:space:]]+card)?|card|voucher|coupon|security|access)[[:space:]]+code|token|password|secret|pin|cvv|cvc)\M[[:space:]:=#-]+(is[[:space:]]+)?[[:alnum:]_-]+','[credential redacted]','gi');
 return nullif(btrim(regexp_replace(value,'[[:cntrl:]]',' ','g')),'');
end $$;
revoke all on function private.refund_request_operational_comment(public.refund_cases) from public,anon,authenticated,service_role;

create function private.refund_request_read_projection(p_case public.refund_cases,p_can_manage boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'caseId',p_case.id,'publicReference',p_case.public_reference,
  'machineId',m.id,'machineLabel',m.machine_label,'locationName',l.name,'timezone',l.timezone,
  'accountId',m.account_id,'accountName',a.name,
  'receivedAt',p_case.customer_request_received_at,'incidentAt',p_case.incident_at,'updatedAt',p_case.updated_at,
  'issueCategory',p_case.issue_category,'comment',left(narrative.comment,4000),
  'commentTruncated',coalesce(char_length(narrative.comment)>4000,false),
  'requestedAmountCents',amount.cents,'currencyCode',case when amount.cents is not null then 'USD' end,
  'statusLabel',case when p_case.gift_card_state='issued' then 'Gift card issued'
    when p_case.gift_card_state='denied' then 'Refund declined'
    when p_case.gift_card_state='pending_inventory' then 'Gift card pending'
    when p_case.status='completed' then 'Refund completed'
    when p_case.status='denied' then 'Refund declined'
    when p_case.status='closed' then 'Request closed'
    when p_case.status='waiting_on_customer' then 'Waiting on customer'
    when p_case.status in ('approved','card_refund_pending','cash_zelle_pending') then 'Refund in progress'
    else 'Under review' end,
  'outcomeLabel',case when p_case.gift_card_state='issued' then 'Gift card issued for this request'
    when p_case.gift_card_state='denied' then 'Request declined'
    when p_case.status='completed' then 'Refund completed for this request'
    when p_case.status='denied' then 'Request declined'
    when p_case.status='closed' then 'Request closed'
    else 'No final outcome yet' end,
  'canOpenManagerWorkspace',p_can_manage)
 from public.reporting_machines m
 join public.reporting_locations l on l.id=m.location_id
 join public.customer_accounts a on a.id=m.account_id
 cross join lateral(select private.email_alert_customer_requested_usd(p_case) cents) amount
 cross join lateral(select private.refund_request_operational_comment(p_case) comment) narrative
 where m.id=p_case.reporting_machine_id;
$$;
revoke all on function private.refund_request_read_projection(public.refund_cases,boolean) from public,anon,authenticated,service_role;

create function public.get_refund_request_access()
returns jsonb language sql stable security definer set search_path='' as $$
 with machines as (
  select m.id as "machineId",m.machine_label as "machineLabel",l.id as "locationId",l.name as "locationName",
   l.timezone,m.account_id as "accountId",a.name as "accountName",s.can_open_manager_workspace as "canOpenManagerWorkspace"
  from private.refund_request_machine_scope(auth.uid()) s
  join public.reporting_machines m on m.id=s.machine_id
  join public.reporting_locations l on l.id=m.location_id
  join public.customer_accounts a on a.id=m.account_id
 )
 select jsonb_build_object('hasAccess',count(*)>0,
  'machines',coalesce(jsonb_agg(to_jsonb(m) order by m."machineLabel",m."machineId"),'[]'::jsonb)) from machines m;
$$;

create function public.get_refund_requests(p_date_from date,p_date_to date,p_machine_id uuid default null,
 p_limit integer default 50,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not exists(select 1 from private.refund_request_machine_scope(auth.uid())) then
  raise exception 'Assigned machine access required' using errcode='42501';end if;
 if p_date_from is null or p_date_to is null or not isfinite(p_date_from) or not isfinite(p_date_to)
  or p_date_from>p_date_to or p_date_to-p_date_from>366 then
  raise exception 'Choose a valid reporting period of up to 367 days' using errcode='22023';end if;
 if p_limit is null or p_limit<1 or p_limit>100 or p_offset is null or p_offset<0 or p_offset>100000 then
  raise exception 'Invalid pagination' using errcode='22023';end if;
 if p_machine_id is not null and not exists(select 1 from private.refund_request_machine_scope(auth.uid()) s where s.machine_id=p_machine_id) then
  raise exception 'Assigned machine access required' using errcode='42501';end if;
 with page as materialized (
  select c,s.can_open_manager_workspace,row_number() over(order by c.customer_request_received_at desc,c.id desc) n
  from private.refund_request_machine_scope(auth.uid()) s
  join public.refund_cases c on c.reporting_machine_id=s.machine_id
  join public.reporting_machines m on m.id=s.machine_id
  join public.reporting_locations l on l.id=m.location_id
  where c.case_population='customer' and c.duplicate_of_refund_case_id is null
   and (p_machine_id is null or c.reporting_machine_id=p_machine_id)
   and c.customer_request_received_at>=(p_date_from::timestamp at time zone l.timezone)
   and c.customer_request_received_at<((p_date_to+1)::timestamp at time zone l.timezone)
  order by c.customer_request_received_at desc,c.id desc limit p_limit+1 offset p_offset
 )
 select jsonb_build_object('requests',coalesce(jsonb_agg(private.refund_request_read_projection(c,can_open_manager_workspace)
  order by n) filter(where n<=p_offset+p_limit),'[]'::jsonb),'hasMore',count(*)>p_limit) into result from page;
 return result;
end $$;

create function public.get_refund_request(p_case_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.refund_request_read_projection(c,s.can_open_manager_workspace)
 from private.refund_request_machine_scope(auth.uid()) s
 join public.refund_cases c on c.reporting_machine_id=s.machine_id
 where c.id=p_case_id and c.case_population='customer' and c.duplicate_of_refund_case_id is null;
$$;
revoke all on function public.get_refund_request_access(),public.get_refund_requests(date,date,uuid,integer,integer),public.get_refund_request(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.get_refund_request_access(),public.get_refund_requests(date,date,uuid,integer,integer),public.get_refund_request(uuid) to authenticated;

-- Upgrade existing email projections without changing their manager audit
-- payload, preferences, canonical financial action fields or delivery ledger.
do $$declare d text; old_part text;new_part text;begin
 d:=pg_get_functiondef('private.email_alert_digest_metadata(uuid,uuid,date,date)'::regprocedure);
 old_part:='select s.timezone,s.is_manager,m.account_id,';
 new_part:='select s.timezone,exists(select 1 from private.refund_request_machine_scope(p_user_id) r where r.machine_id=p_machine_id) as can_read_requests,m.account_id,';
 if strpos(d,old_part)=0 then raise exception 'Digest access boundary changed';end if;
 d:=replace(d,old_part,new_part);
 if strpos(d,'scope.is_manager')=0 then raise exception 'Digest amount authorization boundary changed';end if;
 execute replace(d,'scope.is_manager','scope.can_read_requests');

 d:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 old_part:=$old$'commentExcerpt',private.email_alert_comment(case_row,machine_row.is_manager),$old$;
 new_part:=$new$'commentExcerpt',case when p_category='new-refund' then left(private.refund_request_operational_comment(case_row),280) else private.email_alert_comment(case_row,machine_row.is_manager) end,$new$;
 if strpos(d,old_part)=0 then raise exception 'Email comment boundary changed';end if;d:=replace(d,old_part,new_part);
 old_part:=$old$'commentKind',case when machine_row.is_manager then 'sanitized-narrative' else 'operational-summary' end,$old$;
 new_part:=$new$'commentKind',case when machine_row.is_manager or p_category='new-refund' then 'sanitized-narrative' else 'operational-summary' end,$new$;
 if strpos(d,old_part)=0 then raise exception 'Email comment kind boundary changed';end if;d:=replace(d,old_part,new_part);
 old_part:=$old$case when machine_row.is_manager then 'View the request in Bloomjoy Hub' else 'Review the machine condition' end$old$;
 new_part:=$new$'View the request in Bloomjoy Hub'$new$;
 if strpos(d,old_part)=0 then raise exception 'Email action boundary changed';end if;d:=replace(d,old_part,new_part);
 old_part:=$old$'canOpenCase',machine_row.is_manager));$old$;
 new_part:=$new$'canOpenCase',machine_row.is_manager or (p_category='new-refund' and exists(select 1 from private.refund_request_machine_scope(p_user_id) r where r.machine_id=machine_row.machine_id)))
   ||case when p_category='new-refund' then jsonb_build_object('requestedAmountCents',private.email_alert_customer_requested_usd(case_row)) else '{}'::jsonb end);$new$;
 if strpos(d,old_part)=0 then raise exception 'Email case boundary changed';end if;d:=replace(d,old_part,new_part);
 execute d;
end $$;
select pg_notify('pgrst','reload schema');
