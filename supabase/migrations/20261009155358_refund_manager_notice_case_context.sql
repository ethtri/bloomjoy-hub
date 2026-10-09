-- #1863: add case context without replacing lifecycle, routing or amount authority.
-- Preserve the original RPC for old workers. Deploy this additive migration
-- before switching workers to v2; rolling workers back keeps v1 usable.
do $$
declare definition text; original_definition text; anchor text;
begin
 original_definition:=pg_get_functiondef('public.service_get_refund_manager_action_email_context(uuid,text,timestamptz)'::regprocedure);
 definition:=original_definition;
 anchor:='CREATE OR REPLACE FUNCTION public.service_get_refund_manager_action_email_context(';
 if strpos(definition,anchor)<>1 then raise exception 'Manager notice legacy RPC signature changed';end if;
 if to_regprocedure('public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)') is not null then
  raise exception 'Manager notice v2 RPC already exists';end if;
 definition:=replace(definition,anchor,'CREATE OR REPLACE FUNCTION public.service_get_refund_manager_action_email_context_v2(');
 anchor:=$old$coalesce(nullif(btrim(machine.refund_public_display_label), ''), 'Machine not recorded'),$old$;
 if strpos(definition,anchor)=0 then raise exception 'Manager notice Machine name boundary changed';end if;
 definition:=replace(definition,anchor,$new$coalesce(nullif(btrim(private.reporting_machine_display_name(machine)), ''), 'Machine not recorded'),$new$);
 anchor:=$old$'currencyCode', case_row.matched_nayax_currency_code,$old$;
 if strpos(definition,anchor)=0 then raise exception 'Manager notice case context boundary changed';end if;
 definition:=replace(definition,anchor,anchor||$new$
    -- Only original intake evidence may be described as the requested amount.
    -- Current selected/refund/provider amounts remain legacy fields above.
    'requestedAmountCents', case when manager_user_id is not null
      then private.email_alert_customer_requested_usd(case_row) end,
    'requestedCurrencyCode', case when manager_user_id is not null
      and private.email_alert_customer_requested_usd(case_row) is not null then 'USD' end,
    'paymentOutcomeUnknown', coalesce(lifecycle->>'paymentState'
      in ('outcome_unknown','integrity_unknown'),false),
    'issueLabel', case when manager_user_id is not null then case case_row.issue_category
      when 'charged_no_product' then 'Paid, but no product'
      when 'product_problem' then 'Product problem'
      when 'charged_more_than_once' then 'Charged more than once'
      when 'wrong_amount' then 'Wrong amount'
      when 'partial_items' then 'Fewer items than paid for'
      when 'expected_cash_change' then 'Missing cash change'
      when 'other' then 'Other issue'
      else null end end,
    -- The dispatcher must omit this summary for operations fallback or a route
    -- that no longer matches the current assigned Machine Managers.
    'customerCommentExcerpt', case when manager_user_id is not null then
      nullif(left(btrim(regexp_replace(private.refund_request_operational_comment(case_row),
        '[[:space:]]+', ' ', 'g')),320),'') end,$new$);
 execute definition;
 if pg_get_functiondef('public.service_get_refund_manager_action_email_context(uuid,text,timestamptz)'::regprocedure)
   is distinct from original_definition then raise exception 'Manager notice legacy RPC changed';end if;
end $$;

revoke all on function public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)
 from public,anon,authenticated;
grant execute on function public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz)
 to service_role;
comment on function public.service_get_refund_manager_action_email_context_v2(uuid,text,timestamptz) is
 'Service-only manager notice projection: canonical action, effective Machine name, original intake amount and bounded sanitized case context. Transport must suppress case summary for operations or stale assignment routes.';
select pg_notify('pgrst','reload schema');
