create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Refuse to run the committed two-session fixture anywhere except the
-- disposable Supabase CLI database.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('digest_mapping_local_guard', local_connection);
  perform extensions.dblink_disconnect('digest_mapping_local_guard');
end;
$$;

begin;
drop schema if exists refund_manager_digest_race_test cascade;
create schema refund_manager_digest_race_test;
create table refund_manager_digest_race_test.claim (value jsonb not null);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', '12820000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'digest-race-old@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('00000000-0000-0000-0000-000000000000', '12820000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'digest-race-new@example.test', '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.customer_accounts (id, name, account_type)
values ('12821000-0000-4000-8000-000000000001', 'Digest mapping race', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values ('12822000-0000-4000-8000-000000000001', '12821000-0000-4000-8000-000000000001', 'Digest race location', 'America/Los_Angeles');
insert into public.reporting_machines (
  id, account_id, location_id, machine_label, refund_public_display_label
) values (
  '12823000-0000-4000-8000-000000000001',
  '12821000-0000-4000-8000-000000000001',
  '12822000-0000-4000-8000-000000000001',
  'Digest race private machine', 'Digest race public machine'
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12824000-0000-4000-8000-000000000001',
  '12823000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000001',
  'digest-race-old@example.test', 'Digest mapping race'
);
insert into public.refund_cases (
  id, public_reference, reporting_machine_id, reporting_location_id,
  customer_email, issue_summary, incident_at, payment_method,
  payment_amount_cents, status, automation_state, deterministic_fact_version
) values (
  '12825000-0000-4000-8000-000000000001', 'RF-DIGEST-RACE',
  '12823000-0000-4000-8000-000000000001',
  '12822000-0000-4000-8000-000000000001',
  'digest-race-customer@example.test', 'Synthetic digest race',
  '2026-09-10T12:00:00Z', 'card', 700, 'needs_review', 'under_review', 1
);
insert into public.refund_manager_attention_states (
  refund_case_id, attention_version, attention_started_at, case_status,
  correlation_status, deterministic_fact_version
) values (
  '12825000-0000-4000-8000-000000000001', 1,
  '2026-09-10T12:00:00Z', 'needs_review', 'pending', 1
)
on conflict (refund_case_id) do update
set attention_version = excluded.attention_version,
    attention_started_at = excluded.attention_started_at,
    case_status = excluded.case_status,
    correlation_status = excluded.correlation_status,
    deterministic_fact_version = excluded.deterministic_fact_version;
select public.service_begin_refund_manager_notification(
  '12825000-0000-4000-8000-000000000001', 'customer_reply',
  'digest-race-customer@example.test', array['refunds@example.test'],
  array['ops@example.test']
);
update public.refund_manager_digest_settings set delivery_enabled = true where singleton;
insert into refund_manager_digest_race_test.claim
select public.service_begin_next_refund_manager_digest('2026-09-10T15:00:00Z');
commit;

select plan(4);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('digest_mapping_start', local_connection);
end;
$$;

create temporary table digest_mapping_remote_backend as
select pid from extensions.dblink(
  'digest_mapping_start', 'select pg_backend_pid()'
) as response(pid integer);

-- Hold the canonical assignment lock, start provider authorization in a second
-- session, then replace the mapping before releasing it. Provider-start must
-- wait and re-read the committed mapping instead of sending to the stale owner.
begin;
select pg_advisory_xact_lock(hashtext('machine_manager:12823000-0000-4000-8000-000000000001'));
select extensions.dblink_send_query(
  'digest_mapping_start',
  format(
    'select public.service_mark_refund_manager_digest_provider_started(%L::uuid,%L::uuid,%L,%L)::text',
    (select value ->> 'batchId' from refund_manager_digest_race_test.claim),
    (select value ->> 'claimToken' from refund_manager_digest_race_test.claim),
    (select value ->> 'mappingFingerprint' from refund_manager_digest_race_test.claim),
    (select value ->> 'recipient' from refund_manager_digest_race_test.claim)
  )
);
select pg_sleep(0.2);
select is(
  extensions.dblink_is_busy('digest_mapping_start'), 1,
  'Provider-start remains blocked while a concurrent mapping mutation owns the shared lock'
);
select is(
  (
    select lower(coalesce(activity.wait_event, ''))
    from pg_catalog.pg_stat_activity activity
    where activity.pid = (select pid from digest_mapping_remote_backend)
  ),
  'advisory',
  'Provider-start waits on the canonical machine-manager advisory lock'
);
update public.reporting_machine_refund_managers
set status = 'revoked', revoked_at = now(), revoke_reason = 'Digest mapping race replacement'
where id = '12824000-0000-4000-8000-000000000001';
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
) values (
  '12824000-0000-4000-8000-000000000002',
  '12823000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000002',
  'digest-race-new@example.test', 'Digest mapping race replacement'
);
commit;

create temporary table digest_mapping_race_result (value boolean not null);
insert into digest_mapping_race_result
select value::boolean
from extensions.dblink_get_result('digest_mapping_start') as response(value text);
select is(
  (select value from digest_mapping_race_result), false,
  'Provider-start rejects the stale recipient after the replacement commits'
);
select ok(
  exists (
    select 1 from public.refund_manager_digest_batches batch
    where batch.id = (
      select (value ->> 'batchId')::uuid from refund_manager_digest_race_test.claim
    )
      and batch.status = 'known_not_sent'
      and batch.provider_attempt_started_at is null
  ),
  'The revoke-wins race settles known-not-sent before any provider boundary'
);

select extensions.dblink_disconnect('digest_mapping_start');

begin;
update public.refund_manager_digest_settings set delivery_enabled = false where singleton;
delete from public.refund_manager_digest_batches
where manager_user_id in (
  '12820000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000002'
);
delete from public.refund_manager_notification_actions
where refund_case_id = '12825000-0000-4000-8000-000000000001';
delete from public.refund_manager_attention_states
where refund_case_id = '12825000-0000-4000-8000-000000000001';
delete from public.refund_cases where id = '12825000-0000-4000-8000-000000000001';
delete from public.reporting_machine_refund_managers
where reporting_machine_id = '12823000-0000-4000-8000-000000000001';
delete from public.reporting_machines where id = '12823000-0000-4000-8000-000000000001';
delete from public.reporting_locations where id = '12822000-0000-4000-8000-000000000001';
delete from public.customer_accounts where id = '12821000-0000-4000-8000-000000000001';
delete from auth.users where id in (
  '12820000-0000-4000-8000-000000000001',
  '12820000-0000-4000-8000-000000000002'
);
drop schema refund_manager_digest_race_test cascade;
commit;

select * from finish();
