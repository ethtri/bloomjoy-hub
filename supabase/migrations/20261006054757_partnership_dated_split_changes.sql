-- Version changes preserve earlier terms and close only the preceding open window.
create or replace function public.admin_change_partnership_split(
  p_partnership_id uuid, p_expected_rule_id uuid, p_expected_rule jsonb,
  p_effective_from date, p_primary_share integer, p_secondary_share integer,
  p_bloomjoy_share integer, p_reason text
) returns public.reporting_partnership_financial_rules
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  prior public.reporting_partnership_financial_rules;
  saved public.reporting_partnership_financial_rules;
begin
  if actor is null or not (public.is_super_admin(actor) or
    (public.is_scoped_admin(actor) and public.admin_can_manage_scoped_partnership(actor,p_partnership_id))) then
    raise exception 'Authorized partnership admin required' using errcode='42501';
  end if;
  perform public.reporting_admin_assert_reason(p_reason);
  perform 1 from public.reporting_partnerships where id=p_partnership_id for update;
  if not found then raise exception 'Partnership not found' using errcode='22023'; end if;
  select * into prior from public.reporting_partnership_financial_rules
    where partnership_id=p_partnership_id and status='active'
    order by effective_start_date desc, created_at desc, id desc limit 1 for update;
  if prior.id is distinct from p_expected_rule_id or prior.id is null
    or p_expected_rule is null or not (to_jsonb(prior) @> p_expected_rule)
    or not (p_expected_rule ?& array['effective_start_date','effective_end_date','fever_share_basis_points',
      'partner_share_basis_points','bloomjoy_share_basis_points','fee_amount_cents','fee_basis',
      'cost_amount_cents','cost_basis','calculation_model','split_base','fee_label','cost_label',
      'deduction_timing','gross_to_net_method','additional_deductions_notes','notes','status','updated_at']) then
    raise exception 'Financial terms changed. Reload and review the split again.' using errcode='40001';
  end if;
  if p_effective_from is null or p_effective_from <= prior.effective_start_date
    or p_primary_share is null or p_secondary_share is null or p_bloomjoy_share is null
    or least(p_primary_share,p_secondary_share,p_bloomjoy_share)<0
    or p_primary_share+p_secondary_share+p_bloomjoy_share<>10000 then
    raise exception 'Choose a later effective date and allocations totaling 100%%' using errcode='22023';
  end if;
  if prior.effective_end_date is not null and prior.effective_end_date >= p_effective_from then
    raise exception 'The effective date overlaps existing ended terms' using errcode='22023';
  end if;
  if prior.effective_end_date is null then
    perform public.admin_upsert_reporting_financial_rule(prior.id,p_partnership_id,prior.calculation_model,
      prior.split_base,prior.fee_amount_cents,prior.fee_basis,prior.fee_label,prior.cost_amount_cents,
      prior.cost_basis,prior.cost_label,prior.deduction_timing,prior.gross_to_net_method,
      prior.additional_deductions_notes,prior.fever_share_basis_points,prior.partner_share_basis_points,
      prior.bloomjoy_share_basis_points,prior.effective_start_date,p_effective_from-1,
      'active',prior.notes,p_reason);
  end if;
  saved := public.admin_upsert_reporting_financial_rule(null,p_partnership_id,prior.calculation_model,
    prior.split_base,prior.fee_amount_cents,prior.fee_basis,prior.fee_label,prior.cost_amount_cents,
    prior.cost_basis,prior.cost_label,prior.deduction_timing,prior.gross_to_net_method,
    prior.additional_deductions_notes,p_primary_share,p_secondary_share,p_bloomjoy_share,
    p_effective_from,null,'active',prior.notes,p_reason);
  return saved;
end; $$;
revoke all on function public.admin_change_partnership_split(uuid,uuid,jsonb,date,integer,integer,integer,text) from public, anon;
grant execute on function public.admin_change_partnership_split(uuid,uuid,jsonb,date,integer,integer,integer,text) to authenticated;

-- Serialize the legacy writer with dated changes without changing its permissions or terms.
do $$ declare definition text; anchor text := '  normalized_reason := public.reporting_admin_assert_reason(p_reason);';
begin
  select pg_get_functiondef('public.admin_upsert_reporting_financial_rule(uuid,uuid,text,text,integer,text,text,integer,text,text,text,text,text,integer,integer,integer,date,date,text,text,text)'::regprocedure) into definition;
  if definition is null or strpos(definition,anchor)=0 then raise exception 'Financial writer anchor missing'; end if;
  definition := replace(definition,anchor,
    '  perform 1 from public.reporting_partnerships where id=p_partnership_id for update;' || E'\n' || anchor);
  execute definition;
end $$;
