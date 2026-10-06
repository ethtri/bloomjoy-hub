-- Correct the latest reviewed terms and preceding boundary without changing issued records.
create or replace function public.admin_correct_partnership_terms(
 p_rule_id uuid,p_expected_rule jsonb,p_previous_rule_id uuid,p_expected_previous_rule jsonb,
 p_effective_from date,p_primary_share integer,p_secondary_share integer,p_bloomjoy_share integer,p_reason text
) returns public.reporting_partnership_financial_rules
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); target public.reporting_partnership_financial_rules;
 prior public.reporting_partnership_financial_rules; saved public.reporting_partnership_financial_rules; partnership uuid;
 required_keys text[]:=array['effective_start_date','effective_end_date','fever_share_basis_points','partner_share_basis_points','bloomjoy_share_basis_points','fee_amount_cents','fee_basis','cost_amount_cents','cost_basis','calculation_model','split_base','fee_label','cost_label','deduction_timing','gross_to_net_method','additional_deductions_notes','notes','status','updated_at'];
begin
 select partnership_id into partnership from public.reporting_partnership_financial_rules where id=p_rule_id;
 if actor is null or not (public.is_super_admin(actor) or
 (public.is_scoped_admin(actor) and public.admin_can_manage_scoped_partnership(actor,partnership))) then
 raise exception 'Authorized partnership admin required' using errcode='42501'; end if;
 perform public.reporting_admin_assert_reason(p_reason);
 perform 1 from public.reporting_partnerships where id=partnership for update;
 select * into target from public.reporting_partnership_financial_rules
 where partnership_id=partnership and status='active' order by effective_start_date desc,created_at desc,id desc limit 1 for update;
 if target.id is distinct from p_rule_id or p_expected_rule is null
 or not(p_expected_rule ?& required_keys) or not(to_jsonb(target) @> p_expected_rule) then
 raise exception 'Financial terms changed. Reload and review again.' using errcode='40001'; end if;
 select * into prior from public.reporting_partnership_financial_rules
 where partnership_id=partnership and status='active' and id<>target.id
 order by effective_start_date desc,created_at desc,id desc limit 1 for update;
 if prior.id is distinct from p_previous_rule_id or (prior.id is not null and
 (p_expected_previous_rule is null or not(p_expected_previous_rule ?& required_keys)
 or not(to_jsonb(prior) @> p_expected_previous_rule))) then
 raise exception 'Previous financial terms changed. Reload and review again.' using errcode='40001'; end if;
 if p_effective_from is null or p_primary_share is null or p_secondary_share is null or p_bloomjoy_share is null
 or least(p_primary_share,p_secondary_share,p_bloomjoy_share)<0
 or greatest(p_primary_share,p_secondary_share,p_bloomjoy_share)>10000
 or p_primary_share+p_secondary_share+p_bloomjoy_share<>10000
 or (prior.id is not null and p_effective_from<=prior.effective_start_date)
 or (target.effective_end_date is not null and p_effective_from>target.effective_end_date) then
 raise exception 'Choose valid dates and allocations totaling 100%%' using errcode='22023'; end if;
 -- Never silently fill an unrelated existing gap.
 if prior.id is not null and prior.effective_end_date is distinct from target.effective_start_date-1 then
 raise exception 'Previous terms must end immediately before the reviewed current terms' using errcode='22023'; end if;
 if prior.id is not null and p_effective_from<=target.effective_start_date then
 perform public.admin_upsert_reporting_financial_rule(prior.id,partnership,prior.calculation_model,prior.split_base,
 prior.fee_amount_cents,prior.fee_basis,prior.fee_label,prior.cost_amount_cents,prior.cost_basis,prior.cost_label,
 prior.deduction_timing,prior.gross_to_net_method,prior.additional_deductions_notes,
 prior.fever_share_basis_points,prior.partner_share_basis_points,prior.bloomjoy_share_basis_points,
 prior.effective_start_date,p_effective_from-1,prior.status,prior.notes,p_reason);
 end if;
 -- sales_ex_tax_cents minus ex-tax refunds; zero configured fees and costs.
 saved := public.admin_upsert_reporting_financial_rule(target.id,partnership,'net_split','net_sales',
 0,'none','No additional deductions',0,'none','No additional costs','before_split',
 'imported_tax_plus_configured_fees',null,p_primary_share,p_secondary_share,p_bloomjoy_share,
 p_effective_from,target.effective_end_date,target.status,target.notes,p_reason);
 if prior.id is not null and p_effective_from>target.effective_start_date then
 perform public.admin_upsert_reporting_financial_rule(prior.id,partnership,prior.calculation_model,prior.split_base,
 prior.fee_amount_cents,prior.fee_basis,prior.fee_label,prior.cost_amount_cents,prior.cost_basis,prior.cost_label,
 prior.deduction_timing,prior.gross_to_net_method,prior.additional_deductions_notes,
 prior.fever_share_basis_points,prior.partner_share_basis_points,prior.bloomjoy_share_basis_points,
 prior.effective_start_date,p_effective_from-1,prior.status,prior.notes,p_reason);
 end if;
 return saved;
end; $$;
revoke all on function public.admin_correct_partnership_terms(uuid,jsonb,uuid,jsonb,date,integer,integer,integer,text) from public,anon;
grant execute on function public.admin_correct_partnership_terms(uuid,jsonb,uuid,jsonb,date,integer,integer,integer,text) to authenticated;
