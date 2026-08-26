-- #945: keep customer denial delivery truthful when the customer is also a
-- mapped manager, and support the reviewed four-manager machine roster.

alter table public.refund_gmail_messages
  add column if not exists recipient_manager_overlap boolean not null default false,
  add column if not exists recipient_manager_count integer not null default 0;

update public.refund_gmail_messages
set recipient_manager_count = recipient_cc_count
where direction = 'outbound'
  and recipient_resolution_status = 'resolved'
  and recipient_manager_count = 0
  and recipient_cc_count > 0;

alter table public.refund_gmail_messages
  drop constraint if exists refund_gmail_messages_recipient_manager_count_check,
  drop constraint if exists refund_gmail_messages_resolved_manager_route_check;

alter table public.refund_gmail_messages
  add constraint refund_gmail_messages_recipient_manager_count_check
    check (recipient_manager_count between 0 and 4),
  add constraint refund_gmail_messages_resolved_manager_route_check check (
    direction <> 'outbound'
    or recipient_resolution_status is distinct from 'resolved'
    or (
      recipient_manager_count = 0
      and not recipient_manager_overlap
    )
    or (
      recipient_manager_count between 1 and 4
      and recipient_manager_count = recipient_cc_count +
        case when recipient_manager_overlap then 1 else 0 end
    )
  );

create or replace function public.assert_refund_machine_manager_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_manager_count integer;
begin
  if new.status = 'active' and new.revoked_at is null then
    select count(*)
    into active_manager_count
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = new.reporting_machine_id
      and manager.status = 'active'
      and manager.revoked_at is null
      and manager.id <> coalesce(
        new.id,
        '00000000-0000-0000-0000-000000000000'::uuid
      );

    if active_manager_count >= 4 then
      raise exception 'Each machine can have at most 4 active Machine Managers'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.service_resolve_refund_customer_manager_cc(
  p_refund_case_id uuid,
  p_customer_email text,
  p_mailbox_identities text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  route_machine_id uuid;
  normalized_customer text := lower(btrim(coalesce(p_customer_email, '')));
  mailbox_identities text[] :=
    public.normalize_refund_mailbox_identities(p_mailbox_identities);
  manager_emails text[] := '{}'::text[];
  manager_cc_emails text[] := '{}'::text[];
  active_mapping_count integer := 0;
  distinct_active_mapping_count integer := 0;
  valid_active_mapping_count integer := 0;
  mailbox_collision_count integer := 0;
  manager_recipient_overlap boolean := false;
  manager_recipient_count integer := 0;
  resolution_status text;
begin
  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id;
  if case_row.id is null then raise exception 'Refund case not found'; end if;
  if not public.refund_email_address_is_valid(normalized_customer)
    or lower(btrim(case_row.customer_email)) <> normalized_customer then
    raise exception 'Customer recipient must match the refund case';
  end if;

  route_machine_id := case_row.reporting_machine_id;
  if route_machine_id is null
    and case_row.intake_selection_kind = 'livermore_pair'
    and case_row.intake_selection_key = public.refund_livermore_selection_key()
    and case_row.intake_selection_machine_ids =
      public.refund_livermore_selection_machine_ids()
    and public.refund_livermore_selection_is_valid() then
    route_machine_id := case_row.intake_selection_machine_ids[1];
  end if;

  if route_machine_id is null then
    return jsonb_build_object(
      'status', 'machine_unresolved',
      'managerCcEmails', '[]'::jsonb,
      'managerCcCount', 0,
      'managerRecipientOverlap', false,
      'managerRecipientCount', 0
    );
  end if;

  select
    count(*)::integer,
    count(distinct lower(btrim(manager.manager_email)))::integer,
    count(distinct lower(btrim(manager.manager_email))) filter (
      where public.refund_email_address_is_valid(manager.manager_email)
    )::integer,
    coalesce(
      array_agg(distinct lower(btrim(manager.manager_email))
        order by lower(btrim(manager.manager_email))) filter (
          where public.refund_email_address_is_valid(manager.manager_email)
        ),
      '{}'::text[]
    )
  into
    active_mapping_count,
    distinct_active_mapping_count,
    valid_active_mapping_count,
    manager_emails
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = route_machine_id
    and manager.status = 'active'
    and manager.revoked_at is null;

  select count(*)::integer
  into mailbox_collision_count
  from unnest(manager_emails) manager_email
  where manager_email = any(mailbox_identities);

  manager_recipient_overlap := normalized_customer = any(manager_emails);
  select coalesce(array_agg(manager_email order by manager_email), '{}'::text[])
  into manager_cc_emails
  from unnest(manager_emails) manager_email
  where manager_email <> normalized_customer
    and not (manager_email = any(mailbox_identities));

  manager_recipient_count := cardinality(manager_cc_emails) +
    case when manager_recipient_overlap then 1 else 0 end;
  resolution_status := case
    when active_mapping_count = 0 then 'no_active_managers'
    when distinct_active_mapping_count not between 1 and 4
      then 'invalid_manager_mapping'
    when valid_active_mapping_count <> distinct_active_mapping_count
      then 'invalid_manager_mapping'
    when mailbox_collision_count > 0 then 'invalid_manager_mapping'
    when manager_recipient_count <> distinct_active_mapping_count
      then 'invalid_manager_mapping'
    else 'resolved'
  end;

  if resolution_status <> 'resolved' then
    manager_cc_emails := '{}'::text[];
    manager_recipient_overlap := false;
    manager_recipient_count := 0;
  end if;

  return jsonb_build_object(
    'status', resolution_status,
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails),
    'managerRecipientOverlap', manager_recipient_overlap,
    'managerRecipientCount', manager_recipient_count
  );
end;
$$;

revoke execute on function public.service_resolve_refund_customer_manager_cc(
  uuid, text, text[]
) from public, anon, authenticated;
grant execute on function public.service_resolve_refund_customer_manager_cc(
  uuid, text, text[]
) to service_role;

create or replace function public.service_authorize_refund_customer_outbound(
  p_refund_case_id uuid,
  p_recipient_email text,
  p_mailbox_identities text[],
  p_delivery_kind text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  case_row public.refund_cases;
  settings_row public.refund_customer_contact_settings;
  recipient_resolution jsonb;
  manager_cc_emails text[] := '{}'::text[];
  manager_recipient_overlap boolean := false;
  manager_recipient_count integer := 0;
  mailbox_identities text[] := public.normalize_refund_mailbox_identities(
    p_mailbox_identities
  );
  normalized_recipient text := lower(btrim(coalesce(p_recipient_email, '')));
  normalized_delivery_kind text := lower(btrim(coalesce(p_delivery_kind, '')));
begin
  if normalized_delivery_kind not in ('manual', 'automatic') then
    raise exception 'Valid refund customer delivery kind required';
  end if;

  select * into case_row
  from public.refund_cases
  where id = p_refund_case_id
  for update;

  if case_row.id is null then
    return jsonb_build_object('allowed', false, 'status', 'case_not_found');
  end if;
  if normalized_recipient <> lower(btrim(case_row.customer_email)) then
    raise exception 'Customer recipient must match the refund case';
  end if;

  if normalized_delivery_kind = 'automatic' then
    select * into settings_row
    from public.refund_customer_contact_settings
    where singleton
    for share;
    if not coalesce(settings_row.automatic_customer_contact_enabled, false) then
      return jsonb_build_object(
        'allowed', false,
        'status', 'automatic_contact_disabled'
      );
    end if;
    if case_row.status in ('approved', 'denied', 'completed', 'closed')
      or case_row.decision is not null then
      return jsonb_build_object('allowed', false, 'status', 'terminal_case');
    end if;
  end if;

  recipient_resolution := public.service_resolve_refund_customer_manager_cc(
    p_refund_case_id,
    normalized_recipient,
    mailbox_identities
  );
  select coalesce(array_agg(value order by value), '{}'::text[])
  into manager_cc_emails
  from jsonb_array_elements_text(
    coalesce(recipient_resolution -> 'managerCcEmails', '[]'::jsonb)
  ) value;
  manager_recipient_overlap := coalesce(
    (recipient_resolution ->> 'managerRecipientOverlap')::boolean,
    false
  );
  manager_recipient_count := coalesce(
    (recipient_resolution ->> 'managerRecipientCount')::integer,
    0
  );

  if recipient_resolution ->> 'status' is distinct from 'resolved'
    or manager_recipient_count not between 1 and 4
    or manager_recipient_count <> cardinality(manager_cc_emails) +
      (case when manager_recipient_overlap then 1 else 0 end) then
    return jsonb_build_object(
      'allowed', false,
      'status', 'manager_cc_required',
      'recipientResolutionStatus', recipient_resolution ->> 'status',
      'managerCcCount', 0,
      'managerRecipientOverlap', false,
      'managerRecipientCount', 0
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'status', 'authorized',
    'managerCcEmails', to_jsonb(manager_cc_emails),
    'managerCcCount', cardinality(manager_cc_emails),
    'managerRecipientOverlap', manager_recipient_overlap,
    'managerRecipientCount', manager_recipient_count,
    'recipientResolutionStatus', recipient_resolution ->> 'status'
  );
end;
$$;

revoke execute on function public.service_authorize_refund_customer_outbound(
  uuid, text, text[], text
) from public, anon, authenticated;
grant execute on function public.service_authorize_refund_customer_outbound(
  uuid, text, text[], text
) to service_role;

-- Raise every current machine-route ceiling together. Historical migrations
-- stay immutable; these guarded rewrites target the live definitions only.
do $$
declare
  signature text;
  definition text;
  revised text;
begin
  foreach signature in array array[
    'public.admin_set_reporting_machine_refund_managers(uuid,text[],text)',
    'public.admin_reconcile_refund_nayax_machine(uuid,text,text,uuid,text,text)',
    'public.owner_repair_refund_nayax_obvious_mappings()',
    'public.owner_reconcile_refund_nayax_active_inventory()',
    'public.refund_livermore_selection_is_valid()',
    'public.sync_refund_machine_payment_disabled_reason()',
    'public.admin_get_refund_manager_setup()',
    'public.admin_set_refund_machine_card_activation(uuid,boolean,text,text)',
    'public.admin_activate_qualified_refund_machines(text)',
    'public.service_begin_refund_manager_aging_notice_attempt(uuid,bigint,text,timestamptz,text,integer,integer,text,text,text[],text[])',
    'public.service_authorize_nayax_refund_form_completion(text,uuid,text[])',
    'public.service_finish_nayax_refund_form_completion(text,uuid,text,integer,boolean)',
    'public.owner_prepare_refund_synthetic_gmail_proof(uuid,text,text)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    revised := replace(definition, 'between 1 and 3', 'between 1 and 4');
    revised := replace(revised, 'not between 1 and 3', 'not between 1 and 4');
    revised := replace(revised, '> 3', '> 4');
    revised := replace(revised, 'at most 3', 'at most 4');
    if revised = definition then
      raise exception 'Expected three-manager ceiling in %', signature;
    end if;
    execute revised;
  end loop;
end;
$$;

alter table public.refund_synthetic_gmail_proof_authorizations
  drop constraint if exists refund_synthetic_gmail_proof_authorizations_expected_manager_co,
  drop constraint if exists refund_synthetic_proof_manager_count_check;
alter table public.refund_synthetic_gmail_proof_authorizations
  add constraint refund_synthetic_proof_manager_count_check
    check (expected_manager_count between 1 and 4);

-- Persist the complete route on Gmail claims so an overlap route can be
-- reconciled without consulting a later, potentially changed manager roster.
do $$
declare
  definition text := pg_get_functiondef(
    'public.service_claim_refund_gmail_outbound_v3(uuid,uuid,text,text,text,text,text[],text,uuid)'::regprocedure
  );
  revised text;
begin
  definition := replace(definition, E'\r\n', E'\n');
  revised := replace(
    definition,
    'manager_cc_emails text[] := ''{}''::text[];',
    E'manager_cc_emails text[] := ''{}''::text[];\n  manager_recipient_overlap boolean := false;\n  manager_recipient_count integer := 0;'
  );
  revised := replace(
    revised,
    E'''managerCcCount'', outbound_row.recipient_cc_count,\n        ''recipientResolutionStatus'', outbound_row.recipient_resolution_status,',
    E'''managerCcCount'', outbound_row.recipient_cc_count,\n        ''managerRecipientOverlap'', outbound_row.recipient_manager_overlap,\n        ''managerRecipientCount'', outbound_row.recipient_manager_count,\n        ''recipientResolutionStatus'', outbound_row.recipient_resolution_status,'
  );
  revised := replace(
    revised,
    E'from jsonb_array_elements_text(\n    delivery_authorization -> ''managerCcEmails''\n  ) value;\n\n  -- Lock every linked thread',
    E'from jsonb_array_elements_text(\n    delivery_authorization -> ''managerCcEmails''\n  ) value;\n  manager_recipient_overlap := coalesce((delivery_authorization ->> ''managerRecipientOverlap'')::boolean, false);\n  manager_recipient_count := coalesce((delivery_authorization ->> ''managerRecipientCount'')::integer, 0);\n\n  -- Lock every linked thread'
  );
  revised := replace(
    revised,
    E'recipient_cc_count,\n    recipient_resolution_status,',
    E'recipient_cc_count,\n    recipient_resolution_status,\n    recipient_manager_overlap,\n    recipient_manager_count,'
  );
  revised := replace(
    revised,
    E'cardinality(manager_cc_emails),\n    delivery_authorization ->> ''recipientResolutionStatus'',',
    E'cardinality(manager_cc_emails),\n    delivery_authorization ->> ''recipientResolutionStatus'',\n    manager_recipient_overlap,\n    manager_recipient_count,'
  );
  revised := replace(
    revised,
    E'''managerCcCount'', cardinality(manager_cc_emails),\n    ''recipientResolutionStatus'',',
    E'''managerCcCount'', cardinality(manager_cc_emails),\n    ''managerRecipientOverlap'', manager_recipient_overlap,\n    ''managerRecipientCount'', manager_recipient_count,\n    ''recipientResolutionStatus'','
  );
  if revised = definition
    or position('recipient_manager_overlap' in revised) = 0
    or position('managerRecipientCount' in revised) = 0 then
    raise exception 'Expected Gmail outbound v3 route contract';
  end if;
  execute revised;
end;
$$;

-- The original-thread Nayax completion proof now validates the whole manager
-- recipient set: CC recipients plus the customer when that customer is mapped.
do $$
declare
  definition text := pg_get_functiondef(
    'public.service_finish_nayax_refund_completion(text,uuid,text)'::regprocedure
  );
  revised text;
begin
  definition := replace(definition, E'\r\n', E'\n');
  revised := replace(
    definition,
    E'active_manager_cc_count integer := 0;\n  total_active_manager_count integer := 0;',
    E'active_manager_cc_count integer := 0;\n  active_manager_recipient_overlap boolean := false;\n  total_active_manager_count integer := 0;'
  );
  revised := replace(
    revised,
    E'select count(distinct lower(manager.manager_email))::integer\n    into total_active_manager_count',
    E'select count(distinct lower(manager.manager_email))::integer,\n      coalesce(bool_or(lower(btrim(manager.manager_email)) = lower(btrim(case_row.customer_email))), false)\n    into total_active_manager_count, active_manager_recipient_overlap'
  );
  revised := replace(revised, 'not between 1 and 3', 'not between 1 and 4');
  revised := replace(
    revised,
    E'or total_active_manager_count is distinct from outbound_row.recipient_cc_count\n      or active_manager_cc_count is distinct from total_active_manager_count\n      or active_manager_cc_count is distinct from outbound_row.recipient_cc_count',
    E'or outbound_row.recipient_manager_overlap is distinct from active_manager_recipient_overlap\n      or outbound_row.recipient_manager_count is distinct from total_active_manager_count\n      or outbound_row.recipient_manager_count is distinct from outbound_row.recipient_cc_count +\n        (case when outbound_row.recipient_manager_overlap then 1 else 0 end)\n      or active_manager_cc_count is distinct from outbound_row.recipient_cc_count'
  );
  revised := replace(
    revised,
    E'''manager_cc_count'', outbound_row.recipient_cc_count,\n        ''original_thread'', true,',
    E'''manager_cc_count'', outbound_row.recipient_cc_count,\n        ''manager_recipient_overlap'', outbound_row.recipient_manager_overlap,\n        ''manager_recipient_count'', outbound_row.recipient_manager_count,\n        ''original_thread'', true,'
  );
  if revised = definition
    or position('recipient_manager_count is distinct from total_active_manager_count' in revised) = 0 then
    raise exception 'Expected Nayax completion manager route contract';
  end if;
  execute revised;
end;
$$;

comment on function public.service_resolve_refund_customer_manager_cc(
  uuid, text, text[]
) is
  'Service-only complete manager recipient route. Supports one to four distinct active managers, counts the case customer once when they are also mapped, excludes that address from visible CC, and fails closed for malformed or mailbox-colliding mappings.';

comment on table public.reporting_machine_refund_managers is
  'Authenticated Machine Manager assignments for machine ownership and refund operations; each machine is limited to 4 active managers.';

select pg_notify('pgrst', 'reload schema');
