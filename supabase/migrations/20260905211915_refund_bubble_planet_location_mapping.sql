-- #1123: replace the shared placeholder location for the three reviewed
-- Bubble Planet machines with their current, first-party venue locations.
-- Provider identities and manager assignments stay attached to the same
-- machines. Existing cases retain their originally submitted location/time
-- facts; only future public selections use the corrected venue timezone.

create function public.reconcile_refund_bubble_planet_locations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  placeholder_id constant uuid := '33424c87-38f1-4ad5-9058-8a1814baa294';
  target_count integer;
  manager_count integer;
  manager_identity_count integer;
  location_record record;
  machine_record record;
  resolved_location_id uuid;
  created_location_count integer := 0;
  changed_machine_count integer := 0;
  manager_digest_before text;
  manager_digest_after text;
  before_mapping jsonb;
  after_mapping jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('refund_bubble_planet_locations_v1', 1123)
  );

  select count(*)::integer
  into target_count
  from public.reporting_machines machine
  where machine.id = any(array[
    '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
    '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
    '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
  ]);

  -- Disposable databases do not contain production inventory. A partial
  -- production-shaped set is unsafe and must not be inferred or repaired.
  if target_count = 0 then
    return jsonb_build_object('status', 'skipped_no_targets');
  end if;
  if target_count <> 3 then
    raise exception 'All three reviewed Bubble Planet machines are required'
      using errcode = 'P4680';
  end if;

  perform 1
  from public.reporting_machines machine
  where machine.id = any(array[
    '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
    '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
    '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
  ])
  order by machine.id
  for update;

  if not exists (
    select 1
    from public.reporting_locations location
    where location.id = placeholder_id
      and location.name = 'Unmapped Sunze Machines'
      and location.timezone = 'America/Los_Angeles'
      and location.status = 'active'
  ) then
    raise exception 'Reviewed Bubble Planet placeholder location has changed'
      using errcode = 'P4680';
  end if;

  if exists (
    select 1
    from (values
      ('9433f09f-9874-4904-b511-2fa55723e0d7'::uuid, 'Bubble Planet - Atlanta', '403158085'),
      ('20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid, 'Bubble Planet DC', '938197833'),
      ('7ae1695c-1394-4a11-843e-3bc594547fed'::uuid, 'Bubble Planet Seattle', '287196350')
    ) expected(machine_id, machine_label, provider_machine_id)
    left join public.reporting_machines machine on machine.id = expected.machine_id
    left join public.customer_accounts account on account.id = machine.account_id
    where machine.machine_label is distinct from expected.machine_label
      or machine.nayax_account_key is distinct from 'TGPACI_USA_DB'
      or machine.nayax_machine_id is distinct from expected.provider_machine_id
      or machine.status is distinct from 'active'
      or machine.refund_intake_enabled is distinct from true
      or machine.nayax_refunds_enabled is distinct from true
      or account.name is distinct from 'Bloomjoy Enterprises'
  ) then
    raise exception 'Reviewed Bubble Planet machine or provider identity has changed'
      using errcode = 'P4680';
  end if;

  -- Either this is the first application from the shared placeholder, or an
  -- exact replay of the three reviewed locations. Mixed/unknown locations stop.
  if exists (
    select 1
    from (values
      ('9433f09f-9874-4904-b511-2fa55723e0d7'::uuid, 'Bubble Planet Atlanta — Doraville, GA'),
      ('20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid, 'Bubble Planet DC — Washington, DC'),
      ('7ae1695c-1394-4a11-843e-3bc594547fed'::uuid, 'Bubble Planet Seattle — Bellevue, WA')
    ) expected(machine_id, location_name)
    join public.reporting_machines machine on machine.id = expected.machine_id
    join public.reporting_locations location on location.id = machine.location_id
    where machine.location_id <> placeholder_id
      and location.name is distinct from expected.location_name
  ) then
    raise exception 'A Bubble Planet machine has an unexpected current location'
      using errcode = 'P4680';
  end if;

  select
    count(*)::integer,
    count(distinct (manager.manager_user_id, lower(pg_catalog.btrim(manager.manager_email))))::integer,
    pg_catalog.md5(pg_catalog.string_agg(
      manager.reporting_machine_id::text || ':' || manager.manager_user_id::text || ':' ||
      lower(pg_catalog.btrim(manager.manager_email)), ',' order by manager.reporting_machine_id, manager.manager_user_id
    ))
  into manager_count, manager_identity_count, manager_digest_before
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = any(array[
      '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
      '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
      '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
    ])
    and manager.status = 'active'
    and manager.revoked_at is null;

  if manager_count <> 6 or manager_identity_count <> 2 or exists (
    select 1
    from public.reporting_machine_refund_managers manager
    where manager.reporting_machine_id = any(array[
        '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
        '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
        '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
      ])
      and manager.status = 'active'
      and manager.revoked_at is null
    group by manager.manager_user_id, lower(pg_catalog.btrim(manager.manager_email))
    having count(distinct manager.reporting_machine_id) <> 3
  ) or exists (
    select 1
    from public.reporting_machine_refund_managers manager
    left join auth.users manager_user on manager_user.id = manager.manager_user_id
    where manager.reporting_machine_id = any(array[
        '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
        '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
        '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
      ])
      and manager.status = 'active'
      and manager.revoked_at is null
      and lower(pg_catalog.btrim(manager.manager_email)) is distinct from
        lower(pg_catalog.btrim(manager_user.email))
  ) then
    raise exception 'Reviewed Bubble Planet manager route has changed'
      using errcode = 'P4680';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'machineLabel', machine.machine_label,
      'locationName', location.name,
      'city', location.city,
      'state', location.state,
      'timezone', location.timezone,
      'providerIdentityPreserved', true
    ) order by machine.machine_label
  )
  into before_mapping
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = any(array[
    '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
    '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
    '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
  ]);

  for location_record in
    select * from (values
      ('9433f09f-9874-4904-b511-2fa55723e0d7'::uuid, 'Bubble Planet Atlanta — Doraville, GA', 'Doraville', 'GA', 'America/New_York'),
      ('20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid, 'Bubble Planet DC — Washington, DC', 'Washington', 'DC', 'America/New_York'),
      ('7ae1695c-1394-4a11-843e-3bc594547fed'::uuid, 'Bubble Planet Seattle — Bellevue, WA', 'Bellevue', 'WA', 'America/Los_Angeles')
    ) reviewed(machine_id, location_name, city, state, timezone)
  loop
    select location.id
    into resolved_location_id
    from public.reporting_locations location
    join public.reporting_machines machine on machine.account_id = location.account_id
    where machine.id = location_record.machine_id
      and lower(pg_catalog.btrim(location.name)) = lower(location_record.location_name);

    if resolved_location_id is null then
      insert into public.reporting_locations (
        account_id, name, partner_name, city, state, timezone, status, notes
      )
      select
        machine.account_id,
        location_record.location_name,
        'Bubble Planet',
        location_record.city,
        location_record.state,
        location_record.timezone,
        'active',
        'Current first-party venue location verified for refund intake under issue #1123.'
      from public.reporting_machines machine
      where machine.id = location_record.machine_id
      returning id into resolved_location_id;
      created_location_count := created_location_count + 1;
    elsif not exists (
      select 1
      from public.reporting_locations location
      where location.id = resolved_location_id
        and location.name = location_record.location_name
        and location.partner_name = 'Bubble Planet'
        and location.city = location_record.city
        and location.state = location_record.state
        and location.timezone = location_record.timezone
        and location.status = 'active'
    ) then
      raise exception 'Existing Bubble Planet location conflicts with reviewed venue facts'
        using errcode = 'P4680';
    end if;

    update public.reporting_machines machine
    set location_id = resolved_location_id
    where machine.id = location_record.machine_id
      and machine.location_id is distinct from resolved_location_id;
    changed_machine_count := changed_machine_count + case when found then 1 else 0 end;
  end loop;

  select pg_catalog.md5(pg_catalog.string_agg(
    manager.reporting_machine_id::text || ':' || manager.manager_user_id::text || ':' ||
    lower(pg_catalog.btrim(manager.manager_email)), ',' order by manager.reporting_machine_id, manager.manager_user_id
  ))
  into manager_digest_after
  from public.reporting_machine_refund_managers manager
  where manager.reporting_machine_id = any(array[
      '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
      '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
      '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
    ])
    and manager.status = 'active'
    and manager.revoked_at is null;

  if manager_digest_after is distinct from manager_digest_before
    or (select count(*) from public.public_refund_selections_v2() selection
        where selection.display_label in (
          'Bubble Planet Atlanta — Doraville, GA',
          'Bubble Planet DC — Washington, DC',
          'Bubble Planet Seattle — Bellevue, WA'
        )) <> 3
    or exists (
      select 1
      from public.public_refund_selections_v2() selection
      where (selection.display_label in (
          'Bubble Planet Atlanta — Doraville, GA',
          'Bubble Planet DC — Washington, DC'
        ) and selection.location_timezone <> 'America/New_York')
        or (selection.display_label = 'Bubble Planet Seattle — Bellevue, WA'
          and selection.location_timezone <> 'America/Los_Angeles')
    ) then
    raise exception 'Corrected Bubble Planet public route failed verification'
      using errcode = 'P4680';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'machineLabel', machine.machine_label,
      'locationName', location.name,
      'city', location.city,
      'state', location.state,
      'timezone', location.timezone,
      'providerIdentityPreserved', true
    ) order by machine.machine_label
  )
  into after_mapping
  from public.reporting_machines machine
  join public.reporting_locations location on location.id = machine.location_id
  where machine.id = any(array[
    '9433f09f-9874-4904-b511-2fa55723e0d7'::uuid,
    '20d475a0-ab75-4a0e-8fa7-14306b63fe29'::uuid,
    '7ae1695c-1394-4a11-843e-3bc594547fed'::uuid
  ]);

  if changed_machine_count > 0 then
    insert into public.admin_audit_log (
      actor_user_id, action, entity_type, entity_id, before, after, meta
    ) values (
      null,
      'reporting_machine.refund_bubble_planet_location_repair',
      'reporting_machine_portfolio',
      'bubble-planet-locations-1123',
      before_mapping,
      after_mapping,
      jsonb_build_object(
        'issue', 1123,
        'evidenceClass', 'current_first_party_venue_location',
        'managerAssignmentsChanged', false,
        'providerIdentityChanged', false,
        'historicalCaseFactsChanged', false,
        'paymentActionTaken', false,
        'customerContacted', false,
        'payloadRedacted', true
      )
    );
  end if;

  return jsonb_build_object(
    'status', case when changed_machine_count = 0 then 'already_applied' else 'repaired' end,
    'createdLocationCount', created_location_count,
    'changedMachineCount', changed_machine_count,
    'managerAssignmentsChanged', false,
    'providerIdentityChanged', false,
    'historicalCaseFactsChanged', false
  );
end;
$$;

revoke all on function public.reconcile_refund_bubble_planet_locations()
  from public, anon, authenticated, service_role;

select public.reconcile_refund_bubble_planet_locations();
