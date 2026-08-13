create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;
set search_path = public, extensions;

-- Refuse to run anywhere except the disposable Supabase CLI database.
do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('synthetic_proof_local_guard', local_connection);
  perform extensions.dblink_disconnect('synthetic_proof_local_guard');
end;
$$;

begin;
select no_plan();

drop schema if exists refund_synthetic_proof_race_test cascade;
create schema refund_synthetic_proof_race_test;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '80200000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'proof-race-manager@example.test', '', now(),
  '{}'::jsonb, '{}'::jsonb, now(), now()
);

insert into public.customer_accounts (id, name, account_type)
values ('80210000-0000-4000-8000-000000000001', 'Synthetic proof race', 'customer');
insert into public.reporting_locations (id, account_id, name, timezone)
values (
  '80220000-0000-4000-8000-000000000001',
  '80210000-0000-4000-8000-000000000001',
  'Synthetic proof race location', 'America/Los_Angeles'
);
insert into public.reporting_machines (id, account_id, location_id, machine_label)
values (
  '80230000-0000-4000-8000-000000000001',
  '80210000-0000-4000-8000-000000000001',
  '80220000-0000-4000-8000-000000000001',
  'Synthetic proof race machine'
);
insert into public.reporting_machine_refund_managers (
  id, reporting_machine_id, manager_user_id, manager_email, grant_reason
)
values (
  '80240000-0000-4000-8000-000000000001',
  '80230000-0000-4000-8000-000000000001',
  '80200000-0000-4000-8000-000000000001',
  'proof-race-manager@example.test', 'Synthetic proof concurrency'
);

create temporary table synthetic_proof_race_ingest as
select public.service_ingest_refund_gmail_message_v2(
  repeat('2', 64), 'synthetic-proof-race-thread', 'synthetic-proof-race-inbound',
  '<synthetic-proof-race-inbound@bloomjoysweets.com>', null, 'inbound', false,
  'etrifari+refundpilot-race@bloomjoysweets.com', 'Synthetic Race Customer',
  'info@bloomjoysweets.com', 'Synthetic proof concurrency',
  'Owner-controlled synthetic concurrency request.', false, now() - interval '1 hour',
  null, '[]'::jsonb, '{}'::text[],
  array[
    'info@bloomjoysweets.com',
    'support@bloomjoysweets.com',
    'refunds@bloomjoysweets.com'
  ]::text[],
  'direct_human', false, false, '{}'::text[]
) as result;

update public.refund_cases
set
  reporting_machine_id = '80230000-0000-4000-8000-000000000001',
  reporting_location_id = '80220000-0000-4000-8000-000000000001',
  incident_at = now() - interval '1 day',
  payment_method = 'card', payment_amount_cents = 500, status = 'needs_review'
where id = (select (result ->> 'caseId')::uuid from synthetic_proof_race_ingest);

create temporary table synthetic_proof_race_prepared as
select public.owner_prepare_refund_synthetic_gmail_proof(
  (select (result ->> 'caseId')::uuid from synthetic_proof_race_ingest),
  repeat('d', 64),
  'PREPARE_ONE_OWNER_CONTROLLED_SYNTHETIC_GMAIL_SEND'
) as result;

create function refund_synthetic_proof_race_test.authorize()
returns jsonb
language plpgsql
set search_path = public, auth
as $$
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  return public.service_authorize_refund_synthetic_gmail_proof(
    (select refund_case_id
     from public.refund_synthetic_gmail_proof_authorizations
     where cancelled_at is null),
    'etrifari+refundpilot-race@bloomjoysweets.com',
    repeat('d', 64), 'status_update', true
  );
exception when others then
  return jsonb_build_object('allowed', false, 'status', 'exception', 'error', sqlerrm);
end;
$$;

create table refund_synthetic_proof_race_test.results (
  connection_name text primary key,
  result jsonb not null
);
commit;

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_connect('synthetic_proof_race_a', local_connection);
  perform extensions.dblink_connect('synthetic_proof_race_b', local_connection);
end;
$$;

-- Hold the production advisory lock while both independent sessions begin.
-- Releasing this transaction makes them contend on the exact same one-shot row.
begin;
do $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('refund-synthetic-gmail-proof-exclusive-window', 800)
  );
  perform extensions.dblink_send_query(
    'synthetic_proof_race_a',
    'select refund_synthetic_proof_race_test.authorize()'
  );
  perform extensions.dblink_send_query(
    'synthetic_proof_race_b',
    'select refund_synthetic_proof_race_test.authorize()'
  );
end;
$$;
commit;

insert into refund_synthetic_proof_race_test.results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('synthetic_proof_race_a') as response(result jsonb);
insert into refund_synthetic_proof_race_test.results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('synthetic_proof_race_b') as response(result jsonb);

select is(
  (
    select count(*)::integer
    from refund_synthetic_proof_race_test.results
    where (result ->> 'allowed')::boolean
  ),
  1,
  'Exactly one of two concurrent sessions consumes the one-shot authorization'
);
select is(
  (
    select count(*)::integer
    from refund_synthetic_proof_race_test.results
    where result ->> 'status' = 'already_consumed'
  ),
  1,
  'The concurrent loser fails closed as an explicit replay'
);
select ok(
  (
    select count(*) = 1
      and count(*) filter (where consumed_at is not null) = 1
      and count(*) filter (where refund_case_message_id is null) = 1
    from public.refund_synthetic_gmail_proof_authorizations
    where cancelled_at is null
  ),
  'The race leaves one consumed authorization and creates no message binding'
);

do $$
begin
  perform extensions.dblink_disconnect('synthetic_proof_race_a');
  perform extensions.dblink_disconnect('synthetic_proof_race_b');
end;
$$;

begin;
select public.owner_close_refund_synthetic_gmail_proof(
  (select id from public.refund_synthetic_gmail_proof_authorizations
   where cancelled_at is null),
  'CLOSE_SYNTHETIC_GMAIL_PROOF_WINDOW'
);
delete from public.refund_synthetic_gmail_proof_authorizations
where refund_case_id = (
  select (result ->> 'caseId')::uuid from synthetic_proof_race_ingest
);
delete from public.refund_cases
where id = (select (result ->> 'caseId')::uuid from synthetic_proof_race_ingest);
delete from public.reporting_machine_refund_managers
where id = '80240000-0000-4000-8000-000000000001';
delete from public.reporting_machines
where id = '80230000-0000-4000-8000-000000000001';
delete from public.reporting_locations
where id = '80220000-0000-4000-8000-000000000001';
delete from public.customer_accounts
where id = '80210000-0000-4000-8000-000000000001';
delete from auth.users
where id = '80200000-0000-4000-8000-000000000001';
drop schema refund_synthetic_proof_race_test cascade;
commit;

select is(
  (
    select count(*)::integer
    from public.refund_synthetic_gmail_proof_authorizations
    where cancelled_at is null
  ),
  0,
  'Concurrency teardown leaves every proof gate closed'
);

select * from finish();
