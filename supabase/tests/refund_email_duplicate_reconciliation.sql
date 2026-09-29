begin;

create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set local search_path = public, extensions;

select plan(75);

create function pg_temp.capture_error(statement text)
returns text
language plpgsql
as $$
begin
  execute statement;
  return null;
exception when others then
  return sqlstate || ':' || sqlerrm;
end;
$$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '93000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'email-reconciliation-manager@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '93000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'unassigned-email-manager@example.test',
    '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  );

insert into public.customer_accounts (id, name, account_type)
values ('93100000-0000-4000-8000-000000000001', 'Email reconciliation test', 'customer');

insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '93200000-0000-4000-8000-000000000001',
  '93100000-0000-4000-8000-000000000001',
  'Email reconciliation location',
  'America/Los_Angeles'
);

insert into public.reporting_machines (
  id, account_id, location_id, machine_label, machine_type,
  nayax_refunds_enabled, nayax_machine_id, nayax_refund_max_amount_cents
) values
  (
    '93300000-0000-4000-8000-000000000001',
    '93100000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'Email reconciliation machine A', 'commercial', true,
    'email-reconciliation-nayax-a', 2000
  ),
  (
    '93300000-0000-4000-8000-000000000002',
    '93100000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'Email reconciliation machine B', 'commercial', true,
    'email-reconciliation-nayax-b', 2000
  );

insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '93400000-0000-4000-8000-000000000001',
  '93300000-0000-4000-8000-000000000001',
  '93000000-0000-4000-8000-000000000001',
  'email-reconciliation-manager@example.test',
  'Email-only duplicate reconciliation test'
);

select has_table(
  'public', 'refund_case_reconciliation_reviews',
  'PII-minimized email reconciliation table exists'
);
select has_column(
  'public', 'refund_cases', 'duplicate_of_refund_case_id',
  'Refund cases can point to one canonical case'
);
select has_column(
  'public', 'refund_case_reconciliation_reviews', 'left_fact_fingerprint',
  'Duplicate review binds the left case facts'
);
select has_column(
  'public', 'refund_case_reconciliation_reviews', 'right_fact_fingerprint',
  'Duplicate review binds the right case facts'
);
select has_function(
  'public', 'admin_get_refund_case_reconciliation', array['uuid'],
  'Scoped reconciliation context exists'
);
select has_function(
  'public', 'admin_resolve_refund_case_reconciliation',
  array['uuid','text','uuid','text'],
  'Scoped reconciliation resolution exists'
);
select has_function(
  'public', 'refund_case_user_has_active_manager_mapping',
  array['uuid','uuid'],
  'Evidence gathering has a manager-mapping check separate from payment authority'
);
select ok(
  not has_function_privilege(
    'service_role',
    'public.refund_case_user_has_active_manager_mapping(uuid,uuid)',
    'execute'
  ),
  'The evidence-only authority helper is private to database functions'
);
select ok(
  pg_get_functiondef(
    'public.service_begin_refund_nayax_lookup(uuid,bigint,text,uuid)'::regprocedure
  ) not like '%refund_case_has_unresolved_reconciliation(case_row.id)%',
  'A pending possible-duplicate review does not block read-only Nayax lookup'
);
select ok(
  pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  ) like '%can_manage_refund_case(p_actor_user_id, refund_case.id)%'
  and pg_get_functiondef(
    'public.service_select_refund_nayax_candidate_as_actor_pre_lookup_generation_v1(uuid,uuid,bigint,uuid,text)'::regprocedure
  ) not like '%refund_case_has_unresolved_reconciliation(refund_case.id)%',
  'A case worker can record exact provider evidence while payment remains blocked'
);
select ok(
  pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) like '%refund_case_user_has_active_manager_mapping%'
  and pg_get_functiondef(
    'public.admin_create_refund_manual_nayax_candidate_pre_ops_v1(uuid,bigint,text,text,text,integer,text)'::regprocedure
  ) not like '%refund_case_has_unresolved_reconciliation(case_row.id)%',
  'Manual portal evidence can resolve a review without granting payment authority'
);
select ok(
  not has_table_privilege(
    'authenticated', 'public.refund_case_reconciliation_reviews', 'select'
  ),
  'Browser clients cannot read comparison rows directly'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  customer_name, issue_summary, incident_at, payment_method,
  payment_amount_cents, card_last4, card_wallet_used, status,
  correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000001',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Synthetic Customer',
    'Website form fixture', '2026-08-05 18:00:00+00',
    'card', 700, '4242', false, 'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000002',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'SAME-EMAIL-CUSTOMER@example.test', 'Synthetic Customer',
    'Gmail fixture', '2026-08-05 18:08:00+00',
    'card', 700, '4242', false, 'needs_review', 'manual_review', 'gmail'
  );

select is(
  (select count(*)::integer from public.refund_case_reconciliation_reviews),
  1,
  'Matching website and Gmail cases create one race-safe review pair'
);
select is(
  (select match_class from public.refund_case_reconciliation_reviews),
  'exact',
  'The complete high-confidence fact set is exact'
);
select ok(
  (
    select reason_codes @> array[
      'customer_email_exact', 'machine_exact',
      'incident_within_15_minutes', 'amount_exact',
      'payment_method_exact', 'card_last4_exact', 'wallet_state_exact'
    ]::text[]
    from public.refund_case_reconciliation_reviews
  ),
  'Only fixed, non-PII match reasons are persisted'
);
select ok(
  (
    select left_fact_fingerprint ~ '^[a-f0-9]{64}$'
      and right_fact_fingerprint ~ '^[a-f0-9]{64}$'
      and left_fact_fingerprint !~ 'same-email-customer|4242'
      and right_fact_fingerprint !~ 'same-email-customer|4242'
    from public.refund_case_reconciliation_reviews
  ),
  'Fact bindings are one-way fixed-length fingerprints without raw customer facts'
);
select ok(
  public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  ),
  'A candidate blocks the case pending manager review'
);
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '94000000-0000-4000-8000-000000000001'
  $sql$) like '%Resolve possible duplicate refund cases%',
  'A pending review blocks an official case decision'
);
select ok(
  public.refund_official_action_authority(
    '93000000-0000-4000-8000-000000000001',
    '94000000-0000-4000-8000-000000000001'
  ) is not null,
  'The duplicate review does not masquerade as a manager access failure'
);
select ok(
  pg_get_functiondef(
    'public.can_prepare_nayax_refund_execution(uuid,uuid)'::regprocedure
  ) like '%can_perform_refund_official_action%',
  'Nayax readiness delegates actor authority to the canonical manager check'
);

select set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000001',
  true
);
select is(
  (
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ) ->> 'actionBlocked'
  )::boolean,
  true,
  'The assigned manager sees the case as action-blocked'
);
select is(
  jsonb_array_length(
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ) -> 'reviews'
  ),
  1,
  'The assigned manager sees one linked review'
);
select ok(
  public.admin_get_refund_case_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  )::text !~ 'same-email-customer@example.test|Website form fixture|Gmail fixture'
  and not jsonb_path_exists(
    public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    ),
    '$.** ? (@ == "4242")'
  ),
  'The comparison contract omits email, complaint text, and card digits'
);

select has_column('public','refund_case_messages','reconciliation_review_id',
  'Customer messages can bind to the exact reconciliation review');
select has_column('public','refund_case_messages','transactional_provider_message_header',
  'Transactional questions retain the provider Message-ID needed for exact replies');
select has_column('public','refund_case_reconciliation_reviews','clarification_reply_message_id',
  'The existing review retains one immutable clarification reply');
select ok(not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid in ('public.refund_case_messages'::regclass,
        'public.refund_transactional_delivery_events'::regclass)
      and pg_catalog.pg_get_constraintdef(c.oid)
        like '%is_refund_gmail_canonical_message_header%'
  ),'Message-ID shape checks do not require callers to execute a private helper');
select has_function('public','service_enqueue_refund_reconciliation_clarification',
  array['uuid','uuid','bigint','uuid','text'],
  'The existing outbox has one purpose-bound clarification entry point');
select has_function('public','admin_resolve_refund_case_reconciliation_from_reply',
  array['uuid','text','uuid','uuid','text'],
  'A source-bound reply resolution boundary exists');

savepoint reconciliation_clarification_contract;

select is(
  public.service_enqueue_refund_reconciliation_clarification(
    (select id from public.refund_case_reconciliation_reviews),
    '94000000-0000-4000-8000-000000000001',
    (select official_action_version from public.refund_cases
      where id='94000000-0000-4000-8000-000000000001'),
    '94500000-0000-4000-8000-000000000001','request')->>'enqueued',
  'true','One fixed clarification enters the existing durable outbox');
select is((select reconciliation_message_role from public.refund_case_messages
    where reconciliation_review_id=(select id from public.refund_case_reconciliation_reviews)),
  'request','The question is purpose-bound on the message row');
select is((select cardinality(requested_fields) from public.refund_case_messages
    where reconciliation_review_id=(select id from public.refund_case_reconciliation_reviews)),
  0,'The duplicate question does not masquerade as a structured fact correction');
select is((select content_source from public.refund_case_messages
    where reconciliation_review_id=(select id from public.refund_case_reconciliation_reviews)),
  'deterministic_template','The customer question uses fixed server-built copy');
select is((select count(*)::integer from public.refund_case_messages
    where reconciliation_review_id=(select id from public.refund_case_reconciliation_reviews)),
  1,'Intent replay cannot create a second question');
select ok(pg_temp.capture_error(format(
  'select public.admin_resolve_refund_case_reconciliation_from_reply(%L,%L,%L,%L,%L)',
  (select id from public.refund_case_reconciliation_reviews),'duplicate',
  '94000000-0000-4000-8000-000000000001',gen_random_uuid(),'same purchase'))
  like '%Exact current clarification reply evidence required%',
  'No review can resolve from an unbound or missing customer reply');
select ok(pg_get_functiondef('public.service_receive_refund_scoped_email_reply(uuid,uuid)'::regprocedure)
    like '%provider_message_header=any(regexp_split_to_array%'
    and pg_get_functiondef('public.service_receive_refund_scoped_email_reply(uuid,uuid)'::regprocedure)
      like '%clarification_reply_binding=''exact_thread''%',
  'Reply binding requires the exact outbound thread and provider Message-ID');
select ok(pg_get_functiondef('public.service_enqueue_refund_reconciliation_clarification(uuid,uuid,bigint,uuid,text)'::regprocedure)
    like '%clarification_reminder_message_id is not null%'
    and pg_get_functiondef('public.service_enqueue_refund_reconciliation_clarification(uuid,uuid,bigint,uuid,text)'::regprocedure)
      like '%clarification_reply_message_id is not null%',
  'The existing review permits at most one reminder and stops after a reply');

select ok(pg_temp.capture_error(format(
  'select public.admin_resolve_refund_case_reconciliation(%L,%L,%L,%L)',
  (select id from public.refund_case_reconciliation_reviews),'distinct',null,'different_purchase'))
  like '%exact verified customer reply%',
  'Once the question is queued, generic evidence cannot bypass its bound reply');
select ok(pg_temp.capture_error(format(
  'select public.admin_resolve_refund_case_reconciliation(%L,%L,%L,%L)',
  (select id from public.refund_case_reconciliation_reviews),'distinct',null,'customer_confirmed'))
  like '%exact verified customer reply%',
  'A caller cannot spoof customer_confirmed through the generic resolver');

update public.refund_case_messages set status='sent',manual_delivery_state='sent',
  sent_at=statement_timestamp()-interval '2 hours',
  delivery_transport='resend',provider_message_id='reconciliation-request-provider',
  delivery_state='accepted',delivery_state_updated_at=statement_timestamp()-interval '2 hours'
where reconciliation_review_id=(select id from public.refund_case_reconciliation_reviews);
select is(public.service_record_refund_transactional_delivery_event(
  repeat('a',64),'reconciliation-request-provider','delivered',
  statement_timestamp()-interval '2 hours','<reconciliation-question@example.test>')->>'applied',
  'true','The existing delivery ledger binds a transactional RFC Message-ID');
select ok((select transactional_provider_message_header='<reconciliation-question@example.test>'
    from public.refund_case_messages where reconciliation_message_role='request')
    and (select clarification_reminder_due_at is not null
      from public.refund_case_reconciliation_reviews),
  'Definitive transactional delivery starts the single reminder clock');
update public.refund_case_reconciliation_reviews set
  clarification_reminder_due_at=statement_timestamp()-interval '1 minute';
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=false
where singleton;
select ok(pg_temp.capture_error(format(
  'select public.service_enqueue_refund_reconciliation_clarification(%L,%L,%L,%L,%L)',
  (select id from public.refund_case_reconciliation_reviews),
  '94000000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id='94000000-0000-4000-8000-000000000002'),
  '94500000-0000-4000-8000-000000000099','reminder'))
  like '%Automatic customer contact is disabled%',
  'The single automatic reminder respects the shared customer-contact switch');
update public.refund_customer_contact_settings
set automatic_customer_contact_enabled=true
where singleton;
select is(public.service_enqueue_refund_reconciliation_clarification(
  (select id from public.refund_case_reconciliation_reviews),
  '94000000-0000-4000-8000-000000000002',
  (select official_action_version from public.refund_cases
    where id='94000000-0000-4000-8000-000000000002'),
  '94500000-0000-4000-8000-000000000002','reminder')->>'enqueued',
  'true','The one reminder reuses the same bound review and outbox');
select is((select delivery_kind from public.refund_case_messages
    where reconciliation_message_role='reminder'),
  'automatic','The reminder is explicitly governed as automatic customer contact');
update public.refund_case_messages set status='sent',manual_delivery_state='sent',
  sent_at=statement_timestamp()-interval '1 hour',
  delivery_transport='resend',provider_message_id='reconciliation-reminder-provider',
  delivery_state='accepted',delivery_state_updated_at=statement_timestamp()-interval '1 hour'
where reconciliation_message_role='reminder';
select is(public.service_record_refund_transactional_delivery_event(
  repeat('b',64),'reconciliation-reminder-provider','delivered',
  statement_timestamp()-interval '1 hour','<reconciliation-reminder@example.test>')->>'applied',
  'true','The reminder keeps its own exact provider reply identity');

insert into public.refund_gmail_threads(id,refund_case_id,mailbox_hash,provider_thread_id,
  thread_subject,first_message_at,latest_message_at,retention_expires_at)
values('94600000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001',
  repeat('9',64),'reconciliation-clarification-thread','Reconciliation clarification',
  statement_timestamp()-interval '2 hours',statement_timestamp()-interval '1 hour',
  statement_timestamp()+interval '30 days');
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,
  subject,plain_body,references_header,received_at,retention_expires_at)
values('94700000-0000-4000-8000-000000000002','94600000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','reconciliation-customer-reply','inbound',
  'message','received','same-email-customer@example.test','info@bloomjoysweets.com','customer',
  'verified','Re: Reconciliation clarification','These were two separate purchases.',
  '<reconciliation-reminder@example.test>',statement_timestamp(),
  statement_timestamp()+interval '30 days');

select is(public.service_receive_refund_scoped_email_reply(
  '94000000-0000-4000-8000-000000000001','94700000-0000-4000-8000-000000000002')->>'outcome',
  'received','A reply to the separate reminder binds to the same exact review');
select is((select clarification_reply_binding from public.refund_case_reconciliation_reviews),
  'exact_thread','Only the exact outbound Message-ID and thread authorize resolution');
select is(public.admin_resolve_refund_case_reconciliation_from_reply(
  (select id from public.refund_case_reconciliation_reviews),'distinct',null,
  '94700000-0000-4000-8000-000000000002','two separate purchases')->>'actionBlocked',
  'false','An operator can record the customer-supported distinct-purchase answer');
select is((select status from public.refund_case_reconciliation_reviews),
  'confirmed_distinct','The reply path uses the existing reconciliation result state');

insert into public.refund_cases(id,reporting_machine_id,reporting_location_id,
  customer_email,customer_name,issue_summary,incident_at,payment_method,
  payment_amount_cents,card_last4,card_wallet_used,status,correlation_status,intake_source)
values('94000000-0000-4000-8000-000000000011',
  '93300000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000001',
  'same-email-customer@example.test','Synthetic Customer','Third related fixture',
  '2026-08-05 18:12:00+00','card',700,'4242',false,'needs_review','manual_review','form');
select public.service_enqueue_refund_reconciliation_clarification(
  (select id from public.refund_case_reconciliation_reviews where
    '94000000-0000-4000-8000-000000000011' in (left_refund_case_id,right_refund_case_id)
    and '94000000-0000-4000-8000-000000000001' in (left_refund_case_id,right_refund_case_id)),
  '94000000-0000-4000-8000-000000000011',
  (select official_action_version from public.refund_cases
    where id='94000000-0000-4000-8000-000000000011'),
  '94500000-0000-4000-8000-000000000003','request');
update public.refund_case_reconciliation_reviews set status='pending',resolved_at=null,
  resolution_reason_code=null where
  '94000000-0000-4000-8000-000000000001' in (left_refund_case_id,right_refund_case_id)
  and '94000000-0000-4000-8000-000000000002' in (left_refund_case_id,right_refund_case_id);
insert into public.refund_gmail_messages(id,gmail_thread_id,refund_case_id,provider_message_id,
  direction,message_kind,status,sender_email,recipient_email,participant_role,participant_trust,
  subject,plain_body,references_header,received_at,retention_expires_at)
values('94700000-0000-4000-8000-000000000003','94600000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001','reconciliation-second-customer-reply','inbound',
  'message','received','same-email-customer@example.test','info@bloomjoysweets.com','customer',
  'verified','Re: Reconciliation clarification','Following up on the earlier answer.',
  '<reconciliation-reminder@example.test>',statement_timestamp(),
  statement_timestamp()+interval '30 days');
select is(public.service_receive_refund_scoped_email_reply(
  '94000000-0000-4000-8000-000000000001','94700000-0000-4000-8000-000000000003')->>'outcome',
  'already_received','A referenced older review wins over a newer unrelated pair review');
select is((select clarification_reply_message_id from public.refund_case_reconciliation_reviews where
    '94000000-0000-4000-8000-000000000011' in (left_refund_case_id,right_refund_case_id)
    and '94000000-0000-4000-8000-000000000001' in (left_refund_case_id,right_refund_case_id)),
  null::uuid,'The same inbound cannot be misbound to the newer pair review');

rollback to savepoint reconciliation_clarification_contract;

select public.admin_resolve_refund_case_reconciliation(
  (select id from public.refund_case_reconciliation_reviews),
  'duplicate',
  '94000000-0000-4000-8000-000000000001',
  'same_incident'
);
select is(
  (
    select duplicate_of_refund_case_id
    from public.refund_cases
    where id = '94000000-0000-4000-8000-000000000002'
  ),
  '94000000-0000-4000-8000-000000000001'::uuid,
  'The manager marks the second case as duplicate of the canonical case'
);
select ok(
  not public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000001'
  ),
  'Resolving the pair releases the canonical case review hold'
);
select ok(
  pg_temp.capture_error($sql$
    update public.refund_cases
    set status = 'approved', decision = 'approved'
    where id = '94000000-0000-4000-8000-000000000002'
  $sql$) like '%confirmed duplicate case%',
  'The confirmed duplicate remains permanently blocked from official action'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000003',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'possible-email-customer@example.test', 'Website possible fixture',
    '2026-08-05 20:00:00+00', 'card', 900, '1111', false,
    'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000004',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'possible-email-customer@example.test', 'Gmail possible fixture',
    '2026-08-05 23:00:00+00', 'card', 900, '2222', true,
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select match_class
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'possible',
  'A wallet/last-four mismatch is reviewable but never silently merged'
);
select public.admin_resolve_refund_case_reconciliation(
  (
    select id from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'distinct',
  null,
  'different_purchase'
);
select is(
  (
    select status from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'confirmed_distinct',
  'A manager can confirm genuinely different purchases'
);
update public.refund_cases
set
  incident_at = '2026-08-05 20:08:00+00',
  card_last4 = '1111',
  card_wallet_used = false
where id = '94000000-0000-4000-8000-000000000004';
select is(
  (
    select status from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'pending',
  'Changing comparison facts reopens a stale distinct resolution'
);
select is(
  (
    select match_class from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000004' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'exact',
  'The reopened review reflects the newly exact fact match'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000008',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'midnight-customer@example.test', 'Before midnight fixture',
    '2026-08-05 23:58:00+00', 'card', 650, '9090', false,
    'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000009',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'MIDNIGHT-CUSTOMER@example.test', 'After midnight fixture',
    '2026-08-06 00:05:00+00', 'card', 650, '9090', false,
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000009' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  1,
  'Cross-midnight cases inside the candidate window share one review scope'
);
select is(
  public.refund_reconciliation_scope_lock_key(
    'midnight-customer@example.test',
    '93300000-0000-4000-8000-000000000001'
  ),
  public.refund_reconciliation_scope_lock_key(
    'MIDNIGHT-CUSTOMER@example.test',
    '93300000-0000-4000-8000-000000000001'
  ),
  'The reconciliation lock key is case-insensitive and independent of incident date'
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect(
    'reconcile_lock_a',
    local_connection
  );
  perform extensions.dblink_connect(
    'reconcile_lock_b',
    local_connection
  );
  perform extensions.dblink_exec('reconcile_lock_a', 'begin');
  perform extensions.dblink_exec('reconcile_lock_b', 'begin');
  perform extensions.dblink_exec(
    'reconcile_lock_a',
    format(
      'do $lock$ begin perform pg_advisory_xact_lock(%s); end $lock$;',
      public.refund_reconciliation_scope_lock_key(
        'concurrent-customer@example.test',
        '93300000-0000-4000-8000-000000000001'
      )
    )
  );
end;
$$;
select is(
  (
    select acquired
    from extensions.dblink(
      'reconcile_lock_b',
      format(
        'select pg_try_advisory_xact_lock(%s)',
        public.refund_reconciliation_scope_lock_key(
          'CONCURRENT-CUSTOMER@example.test',
          '93300000-0000-4000-8000-000000000001'
        )
      )
    ) as result(acquired boolean)
  ),
  false,
  'A second database session cannot enter the same reconciliation scope concurrently'
);
do $$
begin
  perform extensions.dblink_exec('reconcile_lock_a', 'commit');
end;
$$;
select is(
  (
    select acquired
    from extensions.dblink(
      'reconcile_lock_b',
      format(
        'select pg_try_advisory_xact_lock(%s)',
        public.refund_reconciliation_scope_lock_key(
          'concurrent-customer@example.test',
          '93300000-0000-4000-8000-000000000001'
        )
      )
    ) as result(acquired boolean)
  ),
  true,
  'The waiting reconciliation scope becomes available after the first transaction commits'
);
do $$
begin
  perform extensions.dblink_exec('reconcile_lock_b', 'rollback');
  perform extensions.dblink_disconnect('reconcile_lock_a');
  perform extensions.dblink_disconnect('reconcile_lock_b');
end;
$$;

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000005',
    '93300000-0000-4000-8000-000000000002',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Different machine fixture',
    '2026-08-05 18:05:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  ),
  (
    '94000000-0000-4000-8000-000000000006',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'different-customer@example.test', 'Different customer fixture',
    '2026-08-05 18:05:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  ),
  (
    '94000000-0000-4000-8000-000000000007',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'same-email-customer@example.test', 'Outside window fixture',
    '2026-08-06 06:30:00+00', 'card', 700, '4242',
    'needs_review', 'manual_review', 'gmail'
  );
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000005' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A different machine does not create a false-positive review'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000006' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A different customer does not create a false-positive review'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000007' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  0,
  'A purchase outside the six-hour window does not create a false-positive review'
);
select ok(
  (
    public.admin_get_refund_reconciliation_health() ->> 'pendingReviewCount'
  )::integer >= 1
  and (
    public.admin_get_refund_reconciliation_health() ->> 'payloadRedacted'
  )::boolean,
  'Aggregate health reports pending work without raw customer facts'
);
select ok(
  pg_get_functiondef(
    'public.reconcile_refund_email_case_candidates()'::regprocedure
  ) like '%pg_advisory_xact_lock%'
  and pg_get_constraintdef(
    (
      select oid from pg_constraint
      where conname = 'refund_case_reconciliation_pair_unique'
    )
  ) like '%UNIQUE%',
  'Concurrent intake is serialized and the case pair is unique'
);
select ok(
  pg_get_functiondef(
    'public.assert_refund_adjustment_reconciliation_safe()'::regprocedure
  ) like '%before settlement%'
  and pg_get_functiondef(
    'public.assert_refund_case_nayax_reconciliation_safe()'::regprocedure
  ) like '%before provider execution%',
  'Settlement and provider guards both fail closed'
);

select set_config(
  'request.jwt.claim.sub',
  '93000000-0000-4000-8000-000000000002',
  true
);
select ok(
  pg_temp.capture_error($sql$
    select public.admin_get_refund_case_reconciliation(
      '94000000-0000-4000-8000-000000000001'
    )
  $sql$) like '%Refund case access required%',
  'An unassigned manager cannot read reconciliation context'
);

insert into public.refund_cases (
  id, reporting_machine_id, reporting_location_id, customer_email,
  issue_summary, incident_at, payment_method, payment_amount_cents,
  card_last4, card_wallet_used, status, correlation_status, intake_source
) values
  (
    '94000000-0000-4000-8000-000000000010',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'two-purchases@example.test', 'First distinct purchase fixture',
    '2026-08-06 18:00:00+00', 'card', 800, '5151', false,
    'needs_review', 'manual_review', 'form'
  ),
  (
    '94000000-0000-4000-8000-000000000011',
    '93300000-0000-4000-8000-000000000001',
    '93200000-0000-4000-8000-000000000001',
    'TWO-PURCHASES@example.test', 'Second distinct purchase fixture',
    '2026-08-06 18:06:00+00', 'card', 800, '5151', false,
    'needs_review', 'manual_review', 'gmail'
  );

select is(
  (
    select status
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000011' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'pending',
  'Similar customer reports begin as one possible-duplicate review'
);

update public.refund_cases
set matched_nayax_transaction_id = '123456789'
where id = '94000000-0000-4000-8000-000000000010';

select is(
  (
    select status
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000011' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'pending',
  'One exact transaction identity is not enough to clear the review'
);

update public.refund_cases
set matched_nayax_transaction_id = '123456790'
where id = '94000000-0000-4000-8000-000000000011';

select is(
  (
    select status
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000011' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'confirmed_distinct',
  'Different exact Nayax transactions automatically confirm different purchases'
);
select ok(
  not public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000010'
  )
  and not public.refund_case_has_unresolved_reconciliation(
    '94000000-0000-4000-8000-000000000011'
  ),
  'Both legitimate purchases are released from the review hold'
);
select is(
  (
    select count(*)::integer
    from public.refund_case_events
    where refund_case_id in (
      '94000000-0000-4000-8000-000000000010',
      '94000000-0000-4000-8000-000000000011'
    )
      and event_type = 'refund_reconciliation_auto_resolved'
  ),
  2,
  'Each released case receives an immutable resolution event'
);
select ok(
  not exists (
    select 1
    from public.refund_case_events
    where refund_case_id in (
      '94000000-0000-4000-8000-000000000010',
      '94000000-0000-4000-8000-000000000011'
    )
      and event_type = 'refund_reconciliation_auto_resolved'
      and (
        metadata ->> 'payload_redacted' is distinct from 'true'
        or metadata ->> 'provider_transaction_ids_redacted' is distinct from 'true'
        or metadata::text like '%12345678%'
      )
  ),
  'Automatic resolution evidence is redacted and stores no transaction ID'
);

update public.refund_cases
set incident_at = '2026-08-06 18:07:00+00'
where id = '94000000-0000-4000-8000-000000000011';

select is(
  (
    select status
    from public.refund_case_reconciliation_reviews
    where '94000000-0000-4000-8000-000000000011' in (
      left_refund_case_id, right_refund_case_id
    )
  ),
  'confirmed_distinct',
  'Later clue changes cannot revive a customer-wide block after exact transactions differ'
);

select * from finish();
rollback;
