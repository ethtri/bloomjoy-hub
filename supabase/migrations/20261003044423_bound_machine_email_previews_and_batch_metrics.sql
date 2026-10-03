-- #1715: bound no-send preview work and reuse canonical financial reads within
-- one recipient. No customer scope, machine-local period, or null semantics change.
do $$
declare definition text; old_part text; new_part text;
begin
 definition:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 old_part:='manager_items jsonb;';
 new_part:='manager_items jsonb; selected_ids uuid[]; metric_cache jsonb:=''{}''; metric_key text; metric_item jsonb; period_metrics jsonb; financial_ids uuid[];';
 if strpos(definition,old_part)=0 then raise exception 'Email projection declaration changed' using errcode='P4653';end if;
 definition:=replace(definition,old_part,new_part);
 old_part:='settings:=private.email_alert_context(p_user_id)->''settings'';';
 new_part:=old_part||E'\n select coalesce(array_agg(s.machine_id),array[]::uuid[]) into selected_ids from private.email_alert_selected_scope(p_user_id,p_category) s;';
 if strpos(definition,old_part)=0 then raise exception 'Email projection settings changed' using errcode='P4653';end if;
 definition:=replace(definition,old_part,new_part);
 definition:=replace(definition,
  'exists(select 1 from private.email_alert_selected_scope(p_user_id,''weekly'') s where s.machine_id=c.reporting_machine_id)',
  'c.reporting_machine_id=any(selected_ids)');
 definition:=replace(definition,
  'select s.machine_id id from private.email_alert_selected_scope(p_user_id,p_category) s',
  'select s.machine_id id from unnest(selected_ids) s(machine_id)');
 old_part:='selected_scope:=exists(select 1 from private.email_alert_selected_scope(p_user_id,p_category) s where s.machine_id=machine_row.machine_id);';
 if strpos(definition,old_part)=0 then raise exception 'Email projection selected scope changed' using errcode='P4653';end if;
 definition:=replace(definition,old_part,'selected_scope:=machine_row.machine_id=any(selected_ids);');

 -- The canonical manager projection already calculated these exact next-work
 -- values for every open case. Reuse them without a second lifecycle traversal.
 old_part:=$old$   life:=public.refund_lifecycle_contract(case_row.id); work:=life->'nextWork';
   new_case:=p_category='new-refund' or (case_row.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to;
   open_case:=coalesce((work->>'isOpen')::boolean,false);
   select x into item from jsonb_array_elements(coalesce(manager_projection->'items','[]')) x where x->>'caseId'=case_row.id::text;$old$;
 new_part:=$new$   select x into item from jsonb_array_elements(coalesce(manager_projection->'items','[]')) x where x->>'caseId'=case_row.id::text;
   if item is not null then
    work:=jsonb_build_object('isOpen',true,'actor',item->>'actor','actionLabel',item->>'actionLabel');
   else
    life:=public.refund_lifecycle_contract(case_row.id); work:=life->'nextWork';
   end if;
   new_case:=p_category='new-refund' or (case_row.customer_request_received_at at time zone machine_row.timezone)::date between machine_from and machine_to;
   open_case:=coalesce((work->>'isOpen')::boolean,false);$new$;
 if strpos(definition,old_part)=0 then raise exception 'Email projection lifecycle changed' using errcode='P4653';end if;
 definition:=replace(definition,old_part,new_part);

 old_part:=$old$    select count(*)>0 and coalesce(sum(r.unresolved_sales_count),0)=0 and coalesce(sum(r.unresolved_refund_count),0)=0 complete,
      sum(r.gross_sales_cents)::bigint gross,sum(r.refund_amount_cents)::bigint refunds,sum(r.net_sales_cents)::bigint net,sum(r.transaction_count)::bigint transactions
    into metrics from private.sales_report_rows_for_actor(p_user_id,machine_from,machine_to,'day',array[machine_row.machine_id]) r;
    select case when count(*)>0 and coalesce(sum(r.unresolved_sales_count),0)=0 then sum(r.gross_sales_cents)::bigint end gross into previous
    from private.sales_report_rows_for_actor(p_user_id,machine_from-7,machine_to-7,'day',array[machine_row.machine_id]) r;$old$;
 new_part:=$new$    metric_key:=machine_from::text||'/'||machine_to::text;
    if not(metric_cache ? metric_key) then
     -- Only selected, currently reporting-authorized machines with the same
     -- original logical machine-local period share this canonical read.
     select array_agg(s.machine_id) into financial_ids
     from private.email_alert_machine_scope(p_user_id) s
     where s.machine_id=any(selected_ids) and s.can_view_sales
      and case when p_category='weekly' then date_trunc('week',logical_anchor at time zone s.timezone)::date-1
       else (logical_anchor at time zone s.timezone)::date-1 end=machine_to;
     with report_rows as materialized (
      select r.* from private.sales_report_rows_for_actor(p_user_id,machine_from-7,machine_to,'day',financial_ids) r
     ), per_machine as (
      select r.machine_id,
       count(*) filter(where r.period_start between machine_from and machine_to)>0
        and coalesce(sum(r.unresolved_sales_count) filter(where r.period_start between machine_from and machine_to),0)=0
        and coalesce(sum(r.unresolved_refund_count) filter(where r.period_start between machine_from and machine_to),0)=0 complete,
       (sum(r.gross_sales_cents) filter(where r.period_start between machine_from and machine_to))::bigint gross,
       (sum(r.refund_amount_cents) filter(where r.period_start between machine_from and machine_to))::bigint refunds,
       (sum(r.net_sales_cents) filter(where r.period_start between machine_from and machine_to))::bigint net,
       (sum(r.transaction_count) filter(where r.period_start between machine_from and machine_to))::bigint transactions,
       case when count(*) filter(where r.period_start between machine_from-7 and machine_to-7)>0
        and coalesce(sum(r.unresolved_sales_count) filter(where r.period_start between machine_from-7 and machine_to-7),0)=0
        then (sum(r.gross_sales_cents) filter(where r.period_start between machine_from-7 and machine_to-7))::bigint end previous_gross
      from report_rows r group by r.machine_id
     )
     select coalesce(jsonb_object_agg(r.machine_id::text,to_jsonb(r)-'machine_id'),'{}') into period_metrics from per_machine r;
     metric_cache:=metric_cache||jsonb_build_object(metric_key,period_metrics);
    end if;
    metric_item:=metric_cache->metric_key->machine_row.machine_id::text;
    select coalesce((metric_item->>'complete')::boolean,false) complete,
     (metric_item->>'gross')::bigint gross,(metric_item->>'refunds')::bigint refunds,
     (metric_item->>'net')::bigint net,(metric_item->>'transactions')::bigint transactions into metrics;
    select (metric_item->>'previous_gross')::bigint gross into previous;$new$;
 if strpos(definition,old_part)=0 then raise exception 'Email projection financial aggregate changed' using errcode='P4653';end if;
 definition:=replace(definition,old_part,new_part);
 execute definition;
end $$;

-- Replace the prior one-argument RPC with a compatible default call plus an
-- explicit keyset continuation. One complete recipient per request keeps the
-- preview bounded without silently truncating cases or the recipient list.
drop function public.service_preview_email_alerts(timestamptz);
create function public.service_preview_email_alerts(
 p_observed_at timestamptz default statement_timestamp(),p_limit integer default 1,p_cursor jsonb default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare candidates jsonb;remaining jsonb;entry jsonb;projection jsonb;next_cursor jsonb;
 cursor_user uuid;cursor_category text;cursor_slot text;has_more boolean;page_count integer;
begin
 if p_observed_at is null or p_limit is distinct from 1 then
  raise exception 'Preview requires an observation time and a one-recipient page' using errcode='22023';
 end if;
 if p_cursor is not null then
  if jsonb_typeof(p_cursor)<>'object' or (select count(*) from jsonb_object_keys(p_cursor))<>4
    or not(p_cursor ?& array['observedAt','userId','category','slotKey'])
    or exists(select 1 from unnest(array['observedAt','userId','category','slotKey']) k where jsonb_typeof(p_cursor->k) is distinct from 'string')
    or (p_cursor->>'observedAt')::timestamptz is distinct from p_observed_at
    or p_cursor->>'category' not in ('daily','weekly','new-refund','sales-quiet','device-offline')
    or coalesce(length(p_cursor->>'slotKey'),0) not between 1 and 100
    or p_cursor->>'userId' is null then
   raise exception 'Invalid preview continuation or observation time' using errcode='22023';
  end if;
  cursor_user:=(p_cursor->>'userId')::uuid;cursor_category:=p_cursor->>'category';cursor_slot:=p_cursor->>'slotKey';
 end if;
 select coalesce(jsonb_agg(to_jsonb(d) order by d.user_id,d.category,d.slot_key),'[]') into candidates
 from private.email_alert_due_candidates(p_observed_at) d;
 select coalesce(jsonb_agg(x order by (x->>'user_id')::uuid,x->>'category',x->>'slot_key'),'[]') into remaining
 from jsonb_array_elements(candidates) x
 where p_cursor is null or ((x->>'user_id')::uuid,x->>'category',x->>'slot_key')>(cursor_user,cursor_category,cursor_slot);
 entry:=remaining->0;has_more:=jsonb_array_length(remaining)>1;page_count:=case when entry is null then 0 else 1 end;
 if entry is not null then
  projection:=private.email_alert_projection((entry->>'user_id')::uuid,entry->>'category',p_observed_at,
   (entry->>'date_from')::date,(entry->>'date_to')::date,(entry->>'event_id')::uuid);
  if has_more then
   next_cursor:=jsonb_build_object('observedAt',p_observed_at,'userId',entry->>'user_id','category',entry->>'category','slotKey',entry->>'slot_key');
  end if;
 end if;
 return jsonb_build_object('observedAt',p_observed_at,'deliveryEnabled',(select delivery_enabled from private.email_alert_delivery_settings),
  'projections',case when entry is null then '[]'::jsonb else jsonb_build_array(projection) end,
  'pageCount',page_count,'totalCandidates',jsonb_array_length(candidates),'hasMore',has_more,'complete',not has_more,
  'nextCursor',next_cursor,'payloadRedacted',true);
end $$;
revoke all on function public.service_preview_email_alerts(timestamptz,integer,jsonb) from public,anon,authenticated;
grant execute on function public.service_preview_email_alerts(timestamptz,integer,jsonb) to service_role;
select pg_notify('pgrst','reload schema');
