-- Ensure Adam keeps scoped-admin access to the active Merlin machine portfolio.
-- This backfills production-only or later-created Merlin venue rows whose labels
-- may be SEA LIFE, Peppa Pig, Madame Tussauds, LEGOLAND, or another Merlin name.

do $$
declare
  adam_user_id uuid;
  adam_grant_id uuid;
  merlin_machine_ids uuid[];
  ensured_scope_count integer := 0;
  merlin_match_patterns text[] := array[
    '%merlin%',
    '%sea life%',
    '%sealife%',
    '%peppa pig%',
    '%madame t%',
    '%tussaud%',
    '%legoland%'
  ];
  backfill_reason text := 'Backfill Adam scoped-admin access for active Merlin machines, including SEA LIFE, Peppa Pig, and Madame Tussauds.';
begin
  select users.id
  into adam_user_id
  from auth.users users
  where lower(users.email) = 'adam@bloomjoysweets.com'
  limit 1;

  if adam_user_id is null then
    insert into public.admin_audit_log (
      action,
      entity_type,
      meta
    )
    values (
      'admin_scoped_access.merlin_backfill_skipped',
      'admin_scoped_access_grant',
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'No auth.users row existed when Merlin scoped-admin backfill ran'
      )
    );

    return;
  end if;

  if public.is_super_admin(adam_user_id) then
    insert into public.admin_audit_log (
      action,
      entity_type,
      target_user_id,
      meta
    )
    values (
      'admin_scoped_access.merlin_backfill_skipped',
      'admin_scoped_access_grant',
      adam_user_id,
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'Target user is already a super-admin'
      )
    );

    return;
  end if;

  select coalesce(array_agg(distinct candidate.machine_id order by candidate.machine_id), '{}'::uuid[])
  into merlin_machine_ids
  from (
    select machine.id as machine_id
    from public.reporting_machines machine
    left join public.customer_accounts account on account.id = machine.account_id
    left join public.reporting_locations location on location.id = machine.location_id
    where coalesce(machine.status, 'active') = 'active'
      and (
        public.normalize_reporting_match_text(machine.machine_label) like any (merlin_match_patterns)
        or public.normalize_reporting_match_text(machine.sunze_machine_id) like any (merlin_match_patterns)
        or public.normalize_reporting_match_text(account.name) like any (merlin_match_patterns)
        or public.normalize_reporting_match_text(location.name) like any (merlin_match_patterns)
        or public.normalize_reporting_match_text(location.partner_name) like any (merlin_match_patterns)
        or exists (
          select 1
          from public.reporting_machine_aliases alias
          where alias.reporting_machine_id = machine.id
            and alias.status = 'active'
            and alias.normalized_alias like any (merlin_match_patterns)
        )
        or exists (
          select 1
          from public.reporting_machine_partnership_assignments assignment
          left join public.reporting_partnerships partnership
            on partnership.id = assignment.partnership_id
          left join public.reporting_partnership_parties party
            on party.partnership_id = partnership.id
          left join public.reporting_partners partner
            on partner.id = party.partner_id
          where assignment.machine_id = machine.id
            and coalesce(assignment.status, 'active') = 'active'
            and (
              public.normalize_reporting_match_text(partnership.name) like any (merlin_match_patterns)
              or public.normalize_reporting_match_text(partner.name) like any (merlin_match_patterns)
              or public.normalize_reporting_match_text(partner.legal_name) like any (merlin_match_patterns)
            )
        )
      )
  ) candidate;

  if coalesce(array_length(merlin_machine_ids, 1), 0) = 0 then
    insert into public.admin_audit_log (
      action,
      entity_type,
      target_user_id,
      meta
    )
    values (
      'admin_scoped_access.merlin_backfill_skipped',
      'admin_scoped_access_grant',
      adam_user_id,
      jsonb_build_object(
        'target_email',
        'adam@bloomjoysweets.com',
        'reason',
        'No active Merlin reporting machines matched the backfill criteria',
        'match_patterns',
        merlin_match_patterns
      )
    );

    return;
  end if;

  select grant_row.id
  into adam_grant_id
  from public.admin_scoped_access_grants grant_row
  where grant_row.user_id = adam_user_id
    and grant_row.role = 'scoped_admin'
    and grant_row.revoked_at is null
  limit 1;

  if adam_grant_id is null then
    insert into public.admin_scoped_access_grants (
      user_id,
      source,
      grant_reason
    )
    values (
      adam_user_id,
      'production_bootstrap',
      backfill_reason
    )
    returning id into adam_grant_id;
  else
    update public.admin_scoped_access_grants
    set
      expires_at = null,
      grant_reason = backfill_reason
    where id = adam_grant_id;
  end if;

  with ensured_scopes as (
    insert into public.admin_scoped_access_scopes (
      grant_id,
      scope_type,
      machine_id,
      grant_reason
    )
    select
      adam_grant_id,
      'machine',
      machine_id,
      backfill_reason
    from unnest(merlin_machine_ids) as selected(machine_id)
    on conflict (grant_id, machine_id)
      where scope_type = 'machine' and revoked_at is null
    do update
    set
      grant_reason = excluded.grant_reason,
      revoked_by = null,
      revoked_at = null,
      revoke_reason = null
    returning machine_id
  )
  select count(*)
  into ensured_scope_count
  from ensured_scopes;

  insert into public.admin_audit_log (
    action,
    entity_type,
    entity_id,
    target_user_id,
    after,
    meta
  )
  values (
    'admin_scoped_access.merlin_backfill_granted',
    'admin_scoped_access_grant',
    adam_grant_id::text,
    adam_user_id,
    jsonb_build_object(
      'grant_id',
      adam_grant_id,
      'target_email',
      'adam@bloomjoysweets.com',
      'machine_ids',
      merlin_machine_ids,
      'machine_count',
      coalesce(array_length(merlin_machine_ids, 1), 0)
    ),
    jsonb_build_object(
      'reason',
      backfill_reason,
      'scope',
      'active_merlin_reporting_machines',
      'ensured_scope_count',
      ensured_scope_count,
      'match_patterns',
      merlin_match_patterns
    )
  );
end;
$$;

select pg_notify('pgrst', 'reload schema');
