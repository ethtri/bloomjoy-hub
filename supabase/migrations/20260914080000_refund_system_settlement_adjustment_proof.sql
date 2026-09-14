-- Complete System-owned card refunds in the order required by the existing
-- accounting guard: complete the approved case, then write its adjustment.
-- This is forward-only because the single-manager migrations may already be
-- present in a database's migration history.

do $settlement_payload_proof$
declare
  body text;
  anchor text;
  replacement text;
begin
  body := replace(pg_catalog.pg_get_functiondef(
    'public.service_settle_nayax_refund_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text,text,text)'::regprocedure
  ), E'\r\n', E'\n');
  anchor := E'        ''refund_case_id'',c.id,''nayax_provider_attempt_id'',a.id,\n'
    || E'        ''provider_reference_present'',true,''payload_redacted'',true))';
  replacement := E'        ''refund_case_id'',c.id,''nayax_provider_attempt_id'',a.id,\n'
    || E'        ''provider_reference_present'',true,''refund_case_status'',''completed'',\n'
    || E'        ''refund_case_decision'',''approved'',''payload_redacted'',true))';
  if cardinality(pg_catalog.string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected System settlement adjustment payload shape';
  end if;
  execute replace(body, anchor, replacement);
end;
$settlement_payload_proof$;

do $success_evidence_settlement_order$
declare
  body text;
  anchor text;
  replacement text;
begin
  body := replace(pg_catalog.pg_get_functiondef(
    'public.admin_record_nayax_system_outcome_evidence_v1(uuid,uuid,text,text,text,timestamptz,text,bigint)'::regprocedure
  ), E'\r\n', E'\n');

  anchor := E'  perform pg_catalog.set_config(''bloomjoy.nayax_system_success_evidence_id'',\n'
    || E'    success_evidence.id::text,true);\n'
    || E'  insert into public.sales_adjustment_facts';
  replacement := E'  perform pg_catalog.set_config(''bloomjoy.nayax_system_success_evidence_id'',\n'
    || E'    success_evidence.id::text,true);\n'
    || E'  perform pg_catalog.set_config(''bloomjoy.nayax_settlement_attempt_id'',\n'
    || E'    a.id::text,true);\n'
    || E'  update public.refund_cases set status=''completed'',decision=''approved'',\n'
    || E'    manual_refund_reference=''Provider evidence recorded'',\n'
    || E'    refund_completed_by=approval.actor_user_id,refund_completed_at=p_evidence_occurred_at,\n'
    || E'    automation_state=''completed'',nayax_refund_execution_status=''approved'',\n'
    || E'    nayax_match_execution_eligible=false where id=c.id;\n'
    || E'  insert into public.sales_adjustment_facts';
  if cardinality(pg_catalog.string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected System success-evidence settlement start shape';
  end if;
  body := replace(body, anchor, replacement);

  anchor := E'    jsonb_build_object(''refund_case_id'',c.id,''nayax_provider_attempt_id'',a.id,\n'
    || E'      ''system_success_evidence_id'',success_evidence.id,\n'
    || E'      ''official_action_authorization_id'',approval.id,''payload_redacted'',true))';
  replacement := E'    jsonb_build_object(''refund_case_id'',c.id,''nayax_provider_attempt_id'',a.id,\n'
    || E'      ''system_success_evidence_id'',success_evidence.id,\n'
    || E'      ''official_action_authorization_id'',approval.id,\n'
    || E'      ''refund_case_status'',''completed'',''refund_case_decision'',''approved'',\n'
    || E'      ''payload_redacted'',true))';
  if cardinality(pg_catalog.string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected System success-evidence adjustment payload shape';
  end if;
  body := replace(body, anchor, replacement);

  anchor := E'  update public.refund_cases set status=''completed'',decision=''approved'',\n'
    || E'    manual_refund_reference=''Provider evidence recorded'',\n'
    || E'    refund_completed_by=approval.actor_user_id,refund_completed_at=p_evidence_occurred_at,\n'
    || E'    automation_state=''completed'',nayax_refund_execution_status=''approved'',\n'
    || E'    nayax_match_execution_eligible=false,reporting_adjustment_id=adjustment.id where id=c.id;';
  replacement := E'  update public.refund_cases set reporting_adjustment_id=adjustment.id where id=c.id;';
  if cardinality(pg_catalog.string_to_array(body, anchor)) <> 2 then
    raise exception 'Unexpected System success-evidence settlement finish shape';
  end if;
  execute replace(body, anchor, replacement);
end;
$success_evidence_settlement_order$;

select pg_notify('pgrst', 'reload schema');
