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
  perform extensions.dblink_connect('gmail_intake_shadow_race_local_guard', local_connection);
  perform extensions.dblink_disconnect('gmail_intake_shadow_race_local_guard');
end;
$$;

begin;
select no_plan();

drop schema if exists refund_gmail_intake_shadow_race_test cascade;
create schema refund_gmail_intake_shadow_race_test;

create function refund_gmail_intake_shadow_race_test.authorize(p_digest text)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  return public.owner_authorize_refund_gmail_intake_shadow_dispatch(
    p_digest,
    repeat('f', 64),
    statement_timestamp() - interval '1 minute'
  );
exception when others then
  return jsonb_build_object(
    'authorized', false,
    'status', 'rejected',
    'payloadRedacted', true
  );
end;
$$;

create table refund_gmail_intake_shadow_race_test.results (
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
  perform extensions.dblink_connect('gmail_intake_shadow_race_a', local_connection);
  perform extensions.dblink_connect('gmail_intake_shadow_race_b', local_connection);
end;
$$;

-- Hold the exact production lock while both independent owner sessions begin.
-- Releasing this transaction forces them to contend at the global lane boundary.
begin;
do $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
  );
  perform extensions.dblink_send_query(
    'gmail_intake_shadow_race_a',
    $query$
      select refund_gmail_intake_shadow_race_test.authorize(repeat('1', 64))
    $query$
  );
  perform extensions.dblink_send_query(
    'gmail_intake_shadow_race_b',
    $query$
      select refund_gmail_intake_shadow_race_test.authorize(repeat('2', 64))
    $query$
  );
end;
$$;
commit;

insert into refund_gmail_intake_shadow_race_test.results (connection_name, result)
select 'a', result
from extensions.dblink_get_result('gmail_intake_shadow_race_a') as response(result jsonb);
insert into refund_gmail_intake_shadow_race_test.results (connection_name, result)
select 'b', result
from extensions.dblink_get_result('gmail_intake_shadow_race_b') as response(result jsonb);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('gmail_intake_shadow_race_a');
  perform extensions.dblink_disconnect('gmail_intake_shadow_race_b');
  perform extensions.dblink_connect(
    'gmail_intake_shadow_race_late',
    local_connection || ' application_name=gmail_intake_shadow_race_late'
  );
end;
$$;

select is(
  (
    select count(*)::integer
    from refund_gmail_intake_shadow_race_test.results
    where coalesce((result ->> 'authorized')::boolean, false)
  ),
  1,
  'Exactly one concurrent owner authorization succeeds'
);
select is(
  (
    select count(*)::integer
    from refund_gmail_intake_shadow_race_test.results
    where result ->> 'status' = 'rejected'
      and (result ->> 'authorized')::boolean is false
      and (result ->> 'payloadRedacted')::boolean
  ),
  1,
  'The concurrent loser fails closed before arming a second digest'
);
select is(
  (
    select count(*)::integer
    from public.refund_gmail_intake_shadow_dispatch_authorizations
    where run_key_digest in (repeat('1', 64), repeat('2', 64))
      and status = 'armed'
  ),
  1,
  'The race leaves exactly one armed authorization'
);

update public.refund_gmail_intake_shadow_dispatch_authorizations
set expires_at = statement_timestamp() - interval '1 second'
where run_key_digest in (repeat('1', 64), repeat('2', 64))
  and status = 'armed';

select is(
  public.owner_recover_expired_refund_gmail_intake_shadow_dispatches(),
  jsonb_build_object(
    'recoveredExpiredCount', 1,
    'armedAuthorizationCount', 0,
    'consumedRunningCount', 0,
    'payloadRedacted', true
  ),
  'No-target recovery cancels the expired hard-stop authorization without exposing its digest'
);

-- Simulate an authorize request that outlives the owner client timeout. Close
-- wins while the request is blocked and creates a tombstone before release.
begin;
select pg_advisory_xact_lock(
  hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
);
select extensions.dblink_send_query(
  'gmail_intake_shadow_race_late',
  $query$
    select refund_gmail_intake_shadow_race_test.authorize(repeat('3', 64))
  $query$
);
select is(
  public.owner_cancel_refund_gmail_intake_shadow_dispatch(repeat('3', 64)),
  jsonb_build_object(
    'closed', true,
    'status', 'cancelled',
    'payloadRedacted', true
  ),
  'Close on an absent row creates a redacted cancelled tombstone'
);
commit;

insert into refund_gmail_intake_shadow_race_test.results (connection_name, result)
select 'late', result
from extensions.dblink_get_result('gmail_intake_shadow_race_late') as response(result jsonb);

select ok(
  (
    select result ->> 'status' = 'rejected'
      and (result ->> 'authorized')::boolean is false
      and (result ->> 'payloadRedacted')::boolean
    from refund_gmail_intake_shadow_race_test.results
    where connection_name = 'late'
  )
  and (
    select count(*) = 1
      and min(status) = 'cancelled'
    from public.refund_gmail_intake_shadow_dispatch_authorizations
    where run_key_digest = repeat('3', 64)
  ),
  'Delayed authorization cannot arm after close created an absent-row tombstone'
);

do $$
declare
  local_connection text := 'host=db port=' || current_setting('port')
    || ' dbname=' || current_database()
    || ' user=postgres password=postgres sslmode=disable';
begin
  perform extensions.dblink_disconnect('gmail_intake_shadow_race_late');
  perform extensions.dblink_connect(
    'gmail_intake_shadow_race_late',
    local_connection || ' application_name=gmail_intake_shadow_race_late'
  );
end;
$$;

-- A pending authorize must also lose to no-target recovery. The durable
-- recovery epoch distinguishes it from a new authorize that begins after
-- recovery returns.
begin;
select pg_advisory_xact_lock(
  hashtextextended('refund-gmail-intake-shadow-dispatch-authorize', 854)
);
select extensions.dblink_send_query(
  'gmail_intake_shadow_race_late',
  $query$
    select refund_gmail_intake_shadow_race_test.authorize(repeat('4', 64))
  $query$
);
do $$
declare
  attempt integer;
begin
  for attempt in 1..100 loop
    exit when exists (
      select 1
      from pg_catalog.pg_stat_activity activity
      where activity.application_name = 'gmail_intake_shadow_race_late'
        and activity.wait_event_type = 'Lock'
    );
    perform pg_sleep(0.01);
  end loop;
  if not exists (
    select 1
    from pg_catalog.pg_stat_activity activity
    where activity.application_name = 'gmail_intake_shadow_race_late'
      and activity.wait_event_type = 'Lock'
  ) then
    raise exception 'Delayed authorization did not reach the production lock';
  end if;
end;
$$;
select is(
  public.owner_recover_expired_refund_gmail_intake_shadow_dispatches(),
  jsonb_build_object(
    'recoveredExpiredCount', 0,
    'armedAuthorizationCount', 0,
    'consumedRunningCount', 0,
    'payloadRedacted', true
  ),
  'No-target recovery records its epoch before releasing a pending authorize'
);
commit;

insert into refund_gmail_intake_shadow_race_test.results (connection_name, result)
select 'recovery_late', result
from extensions.dblink_get_result('gmail_intake_shadow_race_late') as response(result jsonb);

select ok(
  (
    select result ->> 'status' = 'rejected'
      and (result ->> 'authorized')::boolean is false
      and (result ->> 'payloadRedacted')::boolean
    from refund_gmail_intake_shadow_race_test.results
    where connection_name = 'recovery_late'
  )
  and not exists (
    select 1
    from public.refund_gmail_intake_shadow_dispatch_authorizations
    where run_key_digest = repeat('4', 64)
  ),
  'Recovery-first ordering rejects the already-pending authorization and leaves no arm'
);

do $$
begin
  perform extensions.dblink_disconnect('gmail_intake_shadow_race_late');
end;
$$;

begin;
delete from public.refund_gmail_intake_shadow_dispatch_authorizations
where run_key_digest in (repeat('1', 64), repeat('2', 64));
delete from public.refund_gmail_intake_shadow_dispatch_authorizations
where run_key_digest = repeat('3', 64);
drop schema refund_gmail_intake_shadow_race_test cascade;
commit;

select is(
  (
    select count(*)::integer
    from public.refund_gmail_intake_shadow_dispatch_authorizations
    where status = 'armed'
  ),
  0,
  'Concurrency teardown leaves no armed intake-shadow authorization'
);

select * from finish();
