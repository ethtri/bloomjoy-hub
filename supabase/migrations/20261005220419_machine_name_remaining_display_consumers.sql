-- Display projections only. Raw aliases, scopes, grouping and durable snapshots remain unchanged.
do $migration$
declare signature text; definition text; needle text; replacement text; item record;
begin
  for item in select * from (values
    ('public.operator_time_entry_payload(uuid)', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.get_my_operator_timekeeping_context(date)', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.get_timekeeping_setup_context()', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.admin_get_technician_access_context(text)', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.admin_get_corporate_partner_access_options()', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.get_my_operator_payout_context()', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.get_technician_pay_report_context(date)', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('public.operator_compensation_rule_payload(uuid)', '''machineLabel'', machine.machine_label', '''machineLabel'', private.reporting_machine_display_name(machine)'),
    ('private.refund_request_read_projection(public.refund_cases,boolean)', '''machineLabel'',m.machine_label', '''machineLabel'',private.reporting_machine_display_name(m)'),
    ('public.get_refund_request_access()', 'm.machine_label as "machineLabel"', 'private.reporting_machine_display_name(m) as "machineLabel"'),
    ('private.email_alert_machine_scope(uuid)', 'select m.id,m.machine_label,l.name,', 'select m.id,private.reporting_machine_display_name(m),l.name,'),
    ('private.admin_list_access_people(text,text,uuid,text,uuid,integer,integer)', '''id'', machine_id, ''label'', machine_label', '''id'', machine_id, ''label'', (select private.reporting_machine_display_name(display_machine) from public.reporting_machines display_machine where display_machine.id=machine_id)')
  ) changes(signature,needle,replacement) loop
    definition:=pg_get_functiondef(item.signature::regprocedure);
    if strpos(definition,item.needle)=0 then raise exception 'Missing machine display projection in %',item.signature; end if;
    execute replace(definition,item.needle,item.replacement);
  end loop;
  -- Review CTEs contain narrowed records: resolve only final JSON fields by their already-scoped ID.
  definition:=pg_get_functiondef('public.get_my_time_review_context(date)'::regprocedure);
  for item in select * from (values
    ('''machineLabel'', machine.machine_label','machine.id'),
    ('''machineLabel'', machine_summary.machine_label','machine_summary.reporting_machine_id'),
    ('''machineLabel'', entry.machine_label','entry.reporting_machine_id')
  ) changes(needle,machine_id) loop
    if strpos(definition,item.needle)=0 then raise exception 'Missing time review display projection %',item.needle; end if;
    definition:=replace(definition,item.needle,'''machineLabel'', (select private.reporting_machine_display_name(display_machine) from public.reporting_machines display_machine where display_machine.id='||item.machine_id||')');
  end loop;
  execute definition;
  -- Legacy weekly report calculations/grouping stay byte-identical before the final output projector.
  definition:=pg_get_functiondef('public.admin_preview_partner_weekly_report(uuid,date)'::regprocedure);
  needle:='return result;';
  if strpos(definition,needle)=0 then raise exception 'Missing weekly report result'; end if;
  definition:=replace(definition,needle,'return private.project_machine_report_names(result);');
  needle:='fact.machine_label || '' has sales in this week without an active machine tax rate.''';
  if strpos(definition,needle)=0 then raise exception 'Missing weekly report warning output'; end if;
  definition:=replace(definition,needle,'(select private.reporting_machine_display_name(display_machine) from public.reporting_machines display_machine where display_machine.id=fact.reporting_machine_id) || '' has sales in this week without an active machine tax rate.''');
  execute definition;
end;
$migration$;
