-- #1836: expose observed subtotals independently from import completeness.
-- No source-coverage proof exists here; an empty period must stay unknown.
create function private.email_alert_metric_state(p_known bigint,p_known_count bigint,p_unresolved bigint,p_reason text default null)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('state',case when p_known_count=0 then 'unavailable' when p_unresolved>0 then 'partial' else 'reported' end,
  'knownSubtotal',case when p_known_count>0 then p_known end,'unresolvedCount',p_unresolved,
  'reason',coalesce(p_reason,case when p_unresolved>0 then 'normalization_unresolved' when p_known_count=0 then 'no_imported_rows' else 'reported_snapshot' end));
$$;
revoke all on function private.email_alert_metric_state(bigint,bigint,bigint,text) from public,anon,authenticated,service_role;

create function private.email_alert_sales_metrics(p_components jsonb,p_reason text default null)
returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb; reason text;
begin
 reason:=p_reason;
 if reason is not null then
  return jsonb_build_object('sourceCoverage','unverified','componentCount',0,'importedSalesComponentCount',0,
   'salesExTax',private.email_alert_metric_state(null,0,0,reason),'refundImpact',private.email_alert_metric_state(null,0,0,reason),
   'netSales',private.email_alert_metric_state(null,0,0,reason),'transactions',private.email_alert_metric_state(null,0,0,reason));
 end if;
 with components as materialized (
  select * from jsonb_to_recordset(coalesce(p_components,'[]')) as c(recorded_sales_cents bigint,sales_ex_tax_cents bigint,
   request_deduction_ex_tax_cents bigint,legacy_paid_deduction_ex_tax_cents bigint,refund_reversal_ex_tax_cents bigint,
   unresolved_refund_count bigint,unresolved_sales_count bigint,commissionable_sales_ex_tax_cents bigint,sales_transaction_count bigint)
 ), totals as (
  select count(*) components,count(*) filter(where recorded_sales_cents>0) sales_components,
   sum(sales_ex_tax_cents) filter(where recorded_sales_cents>0)::bigint sales,
   count(sales_ex_tax_cents) filter(where recorded_sales_cents>0) known_sales,
   count(*) filter(where recorded_sales_cents>0 and sales_ex_tax_cents is null) unresolved_sales,
   sum(request_deduction_ex_tax_cents+legacy_paid_deduction_ex_tax_cents-refund_reversal_ex_tax_cents)::bigint refunds,
   count(*) filter(where request_deduction_ex_tax_cents+legacy_paid_deduction_ex_tax_cents-refund_reversal_ex_tax_cents is not null) known_refunds,
   count(*) filter(where unresolved_refund_count>0 or request_deduction_ex_tax_cents+legacy_paid_deduction_ex_tax_cents-refund_reversal_ex_tax_cents is null) unresolved_refunds,
   sum(commissionable_sales_ex_tax_cents)::bigint net,
   count(commissionable_sales_ex_tax_cents) known_net,
   count(*) filter(where commissionable_sales_ex_tax_cents is null or unresolved_sales_count>0 or unresolved_refund_count>0) unresolved_net,
   sum(sales_transaction_count) filter(where recorded_sales_cents>0)::bigint transactions
  from components
 )
 select jsonb_build_object('sourceCoverage','unverified','componentCount',components,'importedSalesComponentCount',sales_components,
  'salesExTax',private.email_alert_metric_state(sales,known_sales,unresolved_sales),
  'refundImpact',private.email_alert_metric_state(refunds,known_refunds,coalesce(unresolved_refunds,0)),
  'netSales',private.email_alert_metric_state(net,known_net,unresolved_net),
  'transactions',private.email_alert_metric_state(transactions,sales_components,0)) into result from totals;
 return result;
end $$;
revoke all on function private.email_alert_sales_metrics(jsonb,text) from public,anon,authenticated,service_role;

do $$declare d text;old_part text;new_part text;begin
 d:=pg_get_functiondef('private.email_alert_projection(uuid,text,timestamptz,date,date,uuid)'::regprocedure);
 old_part:=$old$select coalesce(array_agg(s.machine_id),array[]::uuid[]) into selected_ids from private.email_alert_selected_scope(p_user_id,p_category) s;$old$;
 new_part:=$new$select coalesce(array_agg(s.machine_id),array[]::uuid[]) into selected_ids
 from private.email_alert_selected_scope(p_user_id,p_category) s
 join public.reporting_machines m on m.id=s.machine_id
 where p_category not in ('daily','weekly') or m.management_archived_at is null;$new$;
 if strpos(d,old_part)=0 then raise exception 'Digest selected scope boundary changed';end if;
 d:=replace(d,old_part,new_part);
 -- Reuse the original one canonical scan across the current and comparison
 -- periods. Legacy totals still apply their original all-or-null gating.
 old_part:=$old$with report_rows as materialized (
      select r.* from private.sales_report_rows_for_actor(p_user_id,machine_from-7,machine_to,'day',financial_ids) r
     ), per_machine as ($old$;
 new_part:=$new$with components as materialized (
      select c.* from unnest(financial_ids) ids(machine_id)
      cross join lateral private.machine_sales_daily_components(ids.machine_id,machine_from-7,machine_to) c
      where public.has_reporting_machine_access(p_user_id,ids.machine_id)
     ), report_rows as (
      select c.reporting_machine_id machine_id,c.booking_date period_start,
       sum(c.unresolved_sales_count)::bigint unresolved_sales_count,sum(c.unresolved_refund_count)::bigint unresolved_refund_count,
       sum(c.sales_ex_tax_cents)::bigint gross_sales_cents,
       sum(c.request_deduction_ex_tax_cents+c.legacy_paid_deduction_ex_tax_cents-c.refund_reversal_ex_tax_cents)::bigint refund_amount_cents,
       sum(c.commissionable_sales_ex_tax_cents)::bigint net_sales_cents,sum(c.sales_transaction_count)::bigint transaction_count
      from components c join public.reporting_locations l on l.id=c.reporting_location_id
      group by c.reporting_machine_id,c.booking_date
     ), per_machine as ($new$;
 if strpos(d,old_part)=0 then raise exception 'Digest batch read boundary changed';end if;
 d:=replace(d,old_part,new_part);
 old_part:=$old$select coalesce(jsonb_object_agg(r.machine_id::text,to_jsonb(r)-'machine_id'),'{}') into period_metrics from per_machine r;$old$;
 new_part:=$new$select coalesce(jsonb_object_agg(r.machine_id::text,(to_jsonb(r)-'machine_id')||jsonb_build_object(
      'sales_metrics',private.email_alert_sales_metrics((select jsonb_agg(to_jsonb(c)) from components c where c.reporting_machine_id=r.machine_id and c.booking_date between machine_from and machine_to)),
      'previous_sales_metrics',private.email_alert_sales_metrics((select jsonb_agg(to_jsonb(c)) from components c where c.reporting_machine_id=r.machine_id and c.booking_date between machine_from-7 and machine_to-7)))),'{}') into period_metrics from per_machine r;$new$;
 if strpos(d,old_part)=0 then raise exception 'Digest metric cache boundary changed';end if;
 d:=replace(d,old_part,new_part);
 -- Weekly manager items must use their original authorized selection, including
 -- archived machines with open work. They are not performance-roster entries.
 d:=replace(d,'c.reporting_machine_id=any(selected_ids)',
  'exists(select 1 from private.email_alert_selected_scope(p_user_id,''weekly'') s where s.machine_id=c.reporting_machine_id)');
 old_part:=$old$private.email_alert_digest_metadata(p_user_id,machine_row.machine_id,machine_from,machine_to)) else '{}'::jsonb end);$old$;
 new_part:=$new$private.email_alert_digest_metadata(p_user_id,machine_row.machine_id,machine_from,machine_to),
      'salesMetrics',coalesce(case when selected_scope and machine_row.can_view_sales then metric_item->'sales_metrics' end,
       private.email_alert_sales_metrics(null,case when not selected_scope then 'outside_performance_scope' when not machine_row.can_view_sales then 'reporting_not_allowed' end)),
      'previousSalesMetrics',coalesce(case when selected_scope and machine_row.can_view_sales then metric_item->'previous_sales_metrics' end,
       private.email_alert_sales_metrics(null,case when not selected_scope then 'outside_performance_scope' when not machine_row.can_view_sales then 'reporting_not_allowed' end))) else '{}'::jsonb end);$new$;
 if strpos(d,old_part)=0 then raise exception 'Digest metadata boundary changed';end if;
 execute replace(d,old_part,new_part);
end $$;
select pg_notify('pgrst','reload schema');
