-- Allow the operational missing-information template to include deterministic,
-- labeled reply fields. Historical v1 evidence remains valid and immutable.

alter table public.refund_customer_contact_settings
  drop constraint if exists refund_customer_contact_settings_template_version_check,
  add constraint refund_customer_contact_settings_template_version_check
    check (template_version in ('refund_follow_up_v1', 'refund_follow_up_v2'));

alter table public.refund_customer_contact_settings
  alter column template_version set default 'refund_follow_up_v2';

update public.refund_customer_contact_settings
set template_version = 'refund_follow_up_v2'
where singleton;

alter table public.refund_follow_up_cycles
  drop constraint if exists refund_follow_up_cycles_template_version_check,
  add constraint refund_follow_up_cycles_template_version_check
    check (template_version in ('refund_follow_up_v1', 'refund_follow_up_v2'));

alter table public.refund_case_messages
  drop constraint if exists refund_case_messages_safe_evidence_shape,
  add constraint refund_case_messages_safe_evidence_shape check (
    (
      delivery_kind is null
      and content_source is null
      and reason_code is null
      and template_version is null
      and follow_up_cycle_id is null
      and cardinality(requested_fields) = 0
    )
    or (
      delivery_kind = 'manual'
      and content_source in ('deterministic_template', 'manager_reviewed_gpt', 'manager_authored')
      and follow_up_cycle_id is null
      and (
        (
          message_type = 'more_info'
          and content_source in ('manager_reviewed_gpt', 'manager_authored')
          and reason_code = 'missing_information'
          and cardinality(requested_fields) > 0
          and template_version is null
        )
        or (
          message_type <> 'more_info'
          and reason_code is null
          and cardinality(requested_fields) = 0
          and (
            (content_source = 'deterministic_template' and template_version is not null)
            or (content_source <> 'deterministic_template' and template_version is null)
          )
        )
      )
    )
    or (
      delivery_kind = 'automatic'
      and content_source = 'deterministic_template'
      and (
        (
          reason_code in ('missing_information', 'no_safe_match')
          and template_version in ('refund_follow_up_v1', 'refund_follow_up_v2')
          and follow_up_cycle_id is not null
          and message_type in ('more_info', 'no_safe_match', 'reminder', 'information_received')
        )
        or (
          message_type in ('wallet_correction', 'wallet_correction_reminder')
          and reason_code is null
          and template_version = case message_type
            when 'wallet_correction' then 'refund_wallet_correction_v1'
            else 'refund_wallet_correction_reminder_v1'
          end
          and follow_up_cycle_id is null
          and cardinality(requested_fields) = 0
        )
      )
    )
  );

comment on column public.refund_customer_contact_settings.template_version is
  'Current deterministic follow-up template. v2 adds labeled, safely parseable reply fields; v1 remains valid historical evidence.';
