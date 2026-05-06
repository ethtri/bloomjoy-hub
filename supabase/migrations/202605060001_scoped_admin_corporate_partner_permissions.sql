-- Let Scoped Admins manage Corporate Partner permissions only inside their
-- current active machine scope. Super Admin behavior remains global.

create or replace function public.admin_has_full_current_partnership_machine_scope(
  p_user_id uuid,
  p_partnership_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_machine_ids uuid[];
  active_machine_count bigint := 0;
  out_of_scope_machine_count bigint := 0;
begin
  if p_user_id is null or p_partnership_id is null then
    return false;
  end if;

  if public.is_super_admin(p_user_id) then
    return true;
  end if;

  actor_machine_ids := coalesce(public.scoped_admin_machine_ids(p_user_id), '{}'::uuid[]);

  if coalesce(array_length(actor_machine_ids, 1), 0) = 0 then
    return false;
  end if;

  select
    count(distinct machine.id),
    count(distinct machine.id) filter (
      where not (machine.id = any(actor_machine_ids))
    )
  into active_machine_count, out_of_scope_machine_count
  from public.reporting_partnerships partnership
  join public.reporting_machine_partnership_assignments assignment
    on assignment.partnership_id = partnership.id
  join public.reporting_machines machine on machine.id = assignment.machine_id
  where partnership.id = p_partnership_id
    and partnership.status = 'active'
    and assignment.assignment_role = 'primary_reporting'
    and assignment.status = 'active'
    and assignment.effective_start_date <= current_date
    and (assignment.effective_end_date is null or assignment.effective_end_date >= current_date)
    and machine.status = 'active';

  return active_machine_count > 0 and out_of_scope_machine_count = 0;
end;
$$;

create or replace function public.admin_can_manage_corporate_partner_party(
  p_user_id uuid,
  p_party_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_party_id is not null
    and (
      public.is_super_admin(p_user_id)
      or exists (
        select 1
        from public.reporting_partnership_parties party
        join public.reporting_partnerships partnership
          on partnership.id = party.partnership_id
        join public.reporting_partners partner on partner.id = party.partner_id
        where party.id = p_party_id
          and partnership.status = 'active'
          and partner.status = 'active'
          and public.admin_has_full_current_partnership_machine_scope(
            p_user_id,
            partnership.id
          )
      )
    );
$$;

create or replace function public.admin_can_manage_corporate_partner(
  p_user_id uuid,
  p_partner_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
    and p_partner_id is not null
    and (
      public.is_super_admin(p_user_id)
      or (
        public.is_scoped_admin(p_user_id)
        and exists (
          select 1
          from public.reporting_partners partner
          where partner.id = p_partner_id
            and partner.status = 'active'
        )
        and exists (
          select 1
          from public.reporting_partnership_parties party
          join public.reporting_partnerships partnership
            on partnership.id = party.partnership_id
          where party.partner_id = p_partner_id
            and partnership.status = 'active'
            and public.admin_has_full_current_partnership_machine_scope(
              p_user_id,
              partnership.id
            )
        )
        and not exists (
          select 1
          from public.reporting_partnership_parties party
          join public.reporting_partnerships partnership
            on partnership.id = party.partnership_id
          where party.partner_id = p_partner_id
            and party.portal_access_enabled
            and partnership.status = 'active'
            and not public.admin_has_full_current_partnership_machine_scope(
              p_user_id,
              partnership.id
            )
        )
      )
    );
$$;

create or replace function public.admin_get_corporate_partner_access_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  actor_user_id uuid;
  actor_is_super_admin boolean;
  result jsonb;
begin
  actor_user_id := auth.uid();
  actor_is_super_admin := public.is_super_admin(actor_user_id);

  if actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not actor_is_super_admin and not public.is_scoped_admin(actor_user_id) then
    raise exception 'Admin access required';
  end if;

  select jsonb_build_object(
    'partners',
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'partnerId', partner.id,
          'partnerName', partner.name,
          'partnerType', partner.partner_type,
          'status', partner.status,
          'memberships', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', membership.id,
                'userId', membership.user_id,
                'memberEmail', membership.member_email,
                'status', membership.status,
                'startsAt', membership.starts_at,
                'expiresAt', membership.expires_at,
                'grantReason', membership.grant_reason,
                'revokedAt', membership.revoked_at,
                'revokeReason', membership.revoke_reason,
                'isActive', public.corporate_partner_membership_is_active(
                  membership.starts_at,
                  membership.expires_at,
                  membership.revoked_at,
                  membership.status
                )
              )
              order by membership.created_at desc
            )
            from public.corporate_partner_memberships membership
            where membership.partner_id = partner.id
          ), '[]'::jsonb),
          'portalPartnerships', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'partyId', party.id,
                'partnershipId', partnership.id,
                'partnershipName', partnership.name,
                'partnershipStatus', partnership.status,
                'portalAccessEnabled', party.portal_access_enabled,
                'machineCount', (
                  select count(distinct assignment.machine_id)::integer
                  from public.reporting_machine_partnership_assignments assignment
                  join public.reporting_machines machine on machine.id = assignment.machine_id
                  where assignment.partnership_id = partnership.id
                    and assignment.assignment_role = 'primary_reporting'
                    and assignment.status = 'active'
                    and assignment.effective_start_date <= current_date
                    and (
                      assignment.effective_end_date is null
                      or assignment.effective_end_date >= current_date
                    )
                    and machine.status = 'active'
                ),
                'machines', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'machineId', machine.id,
                      'machineLabel', machine.machine_label,
                      'accountId', account.id,
                      'accountName', account.name,
                      'locationId', location.id,
                      'locationName', location.name,
                      'status', machine.status
                    )
                    order by account.name, location.name, machine.machine_label
                  )
                  from public.reporting_machine_partnership_assignments assignment
                  join public.reporting_machines machine on machine.id = assignment.machine_id
                  join public.customer_accounts account on account.id = machine.account_id
                  left join public.reporting_locations location on location.id = machine.location_id
                  where assignment.partnership_id = partnership.id
                    and assignment.assignment_role = 'primary_reporting'
                    and assignment.status = 'active'
                    and assignment.effective_start_date <= current_date
                    and (
                      assignment.effective_end_date is null
                      or assignment.effective_end_date >= current_date
                    )
                    and machine.status = 'active'
                ), '[]'::jsonb)
              )
              order by partnership.name
            )
            from public.reporting_partnership_parties party
            join public.reporting_partnerships partnership
              on partnership.id = party.partnership_id
            where party.partner_id = partner.id
              and partnership.status = 'active'
              and (
                actor_is_super_admin
                or public.admin_can_manage_corporate_partner_party(actor_user_id, party.id)
              )
          ), '[]'::jsonb)
        )
        order by partner.name
      ),
      '[]'::jsonb
    )
  )
  into result
  from public.reporting_partners partner
  where partner.status = 'active'
    and (
      actor_is_super_admin
      or public.admin_can_manage_corporate_partner(actor_user_id, partner.id)
    );

  return coalesce(result, jsonb_build_object('partners', '[]'::jsonb));
end;
$$;

create or replace function public.admin_grant_corporate_partner_membership(
  p_target_email text,
  p_partner_id uuid,
  p_reason text,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_is_super_admin boolean;
  normalized_email text;
  normalized_reason text;
  target_user_id uuid;
  before_row public.corporate_partner_memberships;
  after_row public.corporate_partner_memberships;
  action_name text;
begin
  current_user_id := auth.uid();
  current_user_is_super_admin := public.is_super_admin(current_user_id);

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not current_user_is_super_admin and not public.is_scoped_admin(current_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_email := public.normalize_corporate_partner_email(p_target_email);
  normalized_reason := trim(coalesce(p_reason, ''));

  if normalized_email = '' then
    raise exception 'Member email is required';
  end if;

  if p_partner_id is null then
    raise exception 'Partner is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Grant reason is required';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'Expiry must be in the future';
  end if;

  if not exists (
    select 1 from public.reporting_partners partner
    where partner.id = p_partner_id
      and partner.status = 'active'
  ) then
    raise exception 'Active partner not found';
  end if;

  if not public.admin_can_manage_corporate_partner(current_user_id, p_partner_id) then
    raise exception 'Scoped admin access does not include this Corporate Partner scope';
  end if;

  select auth_user.id
  into target_user_id
  from auth.users auth_user
  where public.normalize_corporate_partner_email(auth_user.email) = normalized_email
  limit 1;

  select *
  into before_row
  from public.corporate_partner_memberships membership
  where membership.partner_id = p_partner_id
    and public.normalize_corporate_partner_email(membership.member_email) = normalized_email
    and membership.revoked_at is null
  limit 1
  for update;

  if before_row.id is null then
    insert into public.corporate_partner_memberships (
      partner_id,
      user_id,
      member_email,
      status,
      starts_at,
      expires_at,
      grant_reason,
      granted_by
    )
    values (
      p_partner_id,
      target_user_id,
      normalized_email,
      'active',
      now(),
      p_expires_at,
      normalized_reason,
      current_user_id
    )
    returning * into after_row;

    action_name := 'corporate_partner_membership.granted';
  else
    update public.corporate_partner_memberships
    set
      user_id = coalesce(target_user_id, user_id),
      member_email = normalized_email,
      status = 'active',
      expires_at = p_expires_at,
      grant_reason = normalized_reason,
      granted_by = current_user_id
    where id = before_row.id
    returning * into after_row;

    action_name := 'corporate_partner_membership.updated';
  end if;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    action_name,
    'corporate_partner_membership',
    after_row.id::text,
    after_row.user_id,
    coalesce(to_jsonb(before_row), '{}'::jsonb),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'member_email', after_row.member_email,
      'reason', normalized_reason,
      'actor_authority',
      case when current_user_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'partnerId', after_row.partner_id,
    'userId', after_row.user_id,
    'memberEmail', after_row.member_email,
    'status', after_row.status,
    'startsAt', after_row.starts_at,
    'expiresAt', after_row.expires_at,
    'grantReason', after_row.grant_reason
  );
end;
$$;

create or replace function public.admin_revoke_corporate_partner_membership(
  p_membership_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_is_super_admin boolean;
  normalized_reason text;
  before_row public.corporate_partner_memberships;
  after_row public.corporate_partner_memberships;
begin
  current_user_id := auth.uid();
  current_user_is_super_admin := public.is_super_admin(current_user_id);

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not current_user_is_super_admin and not public.is_scoped_admin(current_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_membership_id is null then
    raise exception 'Membership is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Revoke reason is required';
  end if;

  select *
  into before_row
  from public.corporate_partner_memberships membership
  where membership.id = p_membership_id
    and membership.revoked_at is null
  limit 1
  for update;

  if before_row.id is null then
    raise exception 'Active Corporate Partner membership not found';
  end if;

  if not public.admin_can_manage_corporate_partner(current_user_id, before_row.partner_id) then
    raise exception 'Scoped admin access does not include this Corporate Partner membership';
  end if;

  update public.corporate_partner_memberships
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by = current_user_id,
    revoke_reason = normalized_reason
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    target_user_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    'corporate_partner_membership.revoked',
    'corporate_partner_membership',
    after_row.id::text,
    after_row.user_id,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'member_email', after_row.member_email,
      'reason', normalized_reason,
      'actor_authority',
      case when current_user_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return jsonb_build_object(
    'id', after_row.id,
    'partnerId', after_row.partner_id,
    'userId', after_row.user_id,
    'memberEmail', after_row.member_email,
    'status', after_row.status,
    'revokedAt', after_row.revoked_at,
    'revokeReason', after_row.revoke_reason
  );
end;
$$;

create or replace function public.admin_set_partnership_party_portal_access(
  p_party_id uuid,
  p_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
  current_user_is_super_admin boolean;
  normalized_reason text;
  before_row public.reporting_partnership_parties;
  after_row public.reporting_partnership_parties;
begin
  current_user_id := auth.uid();
  current_user_is_super_admin := public.is_super_admin(current_user_id);

  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  if not current_user_is_super_admin and not public.is_scoped_admin(current_user_id) then
    raise exception 'Admin access required';
  end if;

  normalized_reason := trim(coalesce(p_reason, ''));

  if p_party_id is null then
    raise exception 'Partnership party is required';
  end if;

  if normalized_reason = '' then
    raise exception 'Reason is required';
  end if;

  select *
  into before_row
  from public.reporting_partnership_parties party
  where party.id = p_party_id
  limit 1
  for update;

  if before_row.id is null then
    raise exception 'Partnership party not found';
  end if;

  if not public.admin_can_manage_corporate_partner_party(current_user_id, before_row.id) then
    raise exception 'Scoped admin access does not include this partnership party';
  end if;

  update public.reporting_partnership_parties
  set portal_access_enabled = coalesce(p_enabled, false)
  where id = before_row.id
  returning * into after_row;

  insert into public.admin_audit_log (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    before,
    after,
    meta
  )
  values (
    current_user_id,
    'reporting_partnership_party.portal_access_updated',
    'reporting_partnership_party',
    after_row.id::text,
    to_jsonb(before_row),
    to_jsonb(after_row),
    jsonb_build_object(
      'partner_id', after_row.partner_id,
      'partnership_id', after_row.partnership_id,
      'portal_access_enabled', after_row.portal_access_enabled,
      'reason', normalized_reason,
      'actor_authority',
      case when current_user_is_super_admin then 'super_admin' else 'scoped_admin' end
    )
  );

  return jsonb_build_object(
    'partyId', after_row.id,
    'partnerId', after_row.partner_id,
    'partnershipId', after_row.partnership_id,
    'portalAccessEnabled', after_row.portal_access_enabled
  );
end;
$$;

comment on function public.admin_has_full_current_partnership_machine_scope(uuid, uuid) is
  'Checks whether a Scoped Admin current machine grant fully covers an active partnership machine set.';
comment on function public.admin_can_manage_corporate_partner(uuid, uuid) is
  'Super Admins can manage any Corporate Partner; Scoped Admins can manage only partner records whose current portal-enabled access stays within their active machine scope.';
comment on function public.admin_can_manage_corporate_partner_party(uuid, uuid) is
  'Super Admins can manage any partnership party portal flag; Scoped Admins can manage only active parties fully covered by their current machine scope.';
comment on function public.admin_get_corporate_partner_access_options() is
  'Admin Corporate Partner grant context. Super Admin sees all active partners; Scoped Admin sees only partners manageable inside current machine scope.';

revoke execute on function public.admin_has_full_current_partnership_machine_scope(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_can_manage_corporate_partner(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.admin_can_manage_corporate_partner_party(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.admin_has_full_current_partnership_machine_scope(uuid, uuid)
  to service_role;
grant execute on function public.admin_can_manage_corporate_partner(uuid, uuid)
  to service_role;
grant execute on function public.admin_can_manage_corporate_partner_party(uuid, uuid)
  to service_role;

select pg_notify('pgrst', 'reload schema');
