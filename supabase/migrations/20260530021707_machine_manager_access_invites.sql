alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_invite_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_invite_type_check
    check (invite_type in ('corporate_partner', 'technician', 'machine_manager'));

alter table public.access_invite_deliveries
  drop constraint if exists access_invite_deliveries_source_type_check;

alter table public.access_invite_deliveries
  add constraint access_invite_deliveries_source_type_check
    check (source_type in ('corporate_partner_membership', 'technician_grant', 'reporting_machine'));

comment on column public.access_invite_deliveries.invite_type is
  'User-facing invite preset. Supports Corporate Partner, Technician, and Machine Manager signup emails.';

comment on column public.access_invite_deliveries.source_type is
  'Source behind the invite: corporate_partner_membership, technician_grant, or reporting_machine for invite-only Machine Manager signup.';

select pg_notify('pgrst', 'reload schema');
