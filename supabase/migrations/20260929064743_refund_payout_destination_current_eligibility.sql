-- The one-decision cash workflow asks for the payout destination while the
-- case is still undecided. Keep the historical approved-cash path working,
-- and admit only the current open cash lifecycle to the existing protected
-- message, reminder, and same-thread reply machinery.
create function public.refund_payout_destination_case_current(
  p_case public.refund_cases
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_case.payment_method = 'cash'
    and (
      p_case.decision = 'approved'
      or (
        p_case.decision is null
        and p_case.status in ('needs_review', 'waiting_on_customer')
        and coalesce(p_case.payment_amount_cents, 0) > 0
        and public.refund_purchase_correction_eligible(p_case)
        and not exists (
          select 1
          from public.refund_follow_up_cycles cycle
          where cycle.refund_case_id = p_case.id
            and cycle.case_fact_version = p_case.deterministic_fact_version
            and cycle.reason_code = 'no_safe_match'
            and cardinality(cycle.requested_fields) = 0
        )
      )
    ), false);
$$;
revoke all on function public.refund_payout_destination_case_current(
  public.refund_cases
) from public, anon, authenticated, service_role;

-- The current field contract is what the existing Edge sender uses to select
-- its approved deterministic template. Return the one supported payout field
-- for a current cash case, then preserve the full historical correction chain
-- for every other case.
alter function public.refund_purchase_correction_request_fields(uuid)
  rename to refund_correction_fields_pre_payout_current_v1;
revoke all on function public.refund_correction_fields_pre_payout_current_v1(uuid)
  from public, anon, authenticated, service_role;

create function public.refund_purchase_correction_request_fields(p_case_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  case_row public.refund_cases%rowtype;
begin
  select refund_case.* into case_row
  from public.refund_cases refund_case
  where refund_case.id = p_case_id;

  if case_row.id is not null
    and public.refund_payout_destination_case_current(case_row)
    and nullif(btrim(coalesce(case_row.zelle_payment_contact, '')), '') is null then
    return array['zelle_payment_contact']::text[];
  end if;

  return public.refund_correction_fields_pre_payout_current_v1(p_case_id);
end;
$$;
revoke all on function public.refund_purchase_correction_request_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.refund_purchase_correction_request_fields(uuid)
  to service_role;

-- The existing protected payout path was written before the one-decision cash
-- lifecycle. Change only its legacy approval predicates. Exact source matches
-- fail closed if any retained implementation changes before this migration.
do $migration$
declare
  source text;
  needle text;
  replacement text;
  occurrence_count integer;
begin
  select pg_get_functiondef(
    'public.service_enqueue_refund_manual_message_intent_pre_payout_recovery(uuid,bigint,uuid,uuid,text,text,text,text,text,text,text,text[],uuid,boolean,uuid)'::regprocedure
  ) into source;
  needle := '      or case_row.decision is distinct from ''approved''';
  occurrence_count := (length(source) - length(replace(source, needle, ''))) /
    length(needle);
  if occurrence_count <> 1 then
    raise exception 'Payout manual-intent eligibility changed';
  end if;
  replacement := '      or not public.refund_payout_destination_case_current(case_row)';
  execute replace(source, needle, replacement);

  select pg_get_functiondef(
    'public.guard_refund_payout_destination_message()'::regprocedure
  ) into source;
  needle := '    or case_row.decision is distinct from ''approved''';
  occurrence_count := (length(source) - length(replace(source, needle, ''))) /
    length(needle);
  if occurrence_count <> 1 then
    raise exception 'Payout message guard eligibility changed';
  end if;
  replacement := '    or not public.refund_payout_destination_case_current(case_row)';
  execute replace(source, needle, replacement);

  select pg_get_functiondef(
    'public.service_finish_refund_manual_message_delivery(uuid,uuid,text,text,text,integer,text)'::regprocedure
  ) into source;
  needle := '      and refund_case.decision = ''approved''';
  occurrence_count := (length(source) - length(replace(source, needle, ''))) /
    length(needle);
  if occurrence_count <> 1 then
    raise exception 'Payout follow-up creation eligibility changed';
  end if;
  replacement := '      and public.refund_payout_destination_case_current(refund_case)';
  execute replace(source, needle, replacement);

  select pg_get_functiondef(
    'public.service_claim_due_refund_payout_destination_follow_ups(integer,boolean)'::regprocedure
  ) into source;
  needle := '      and refund_case.decision = ''approved''';
  occurrence_count := (length(source) - length(replace(source, needle, ''))) /
    length(needle);
  if occurrence_count <> 3 then
    raise exception 'Payout reminder claim eligibility changed';
  end if;
  replacement := '      and public.refund_payout_destination_case_current(refund_case)';
  execute replace(source, needle, replacement);

  select pg_get_functiondef(
    'public.service_create_refund_payout_destination_reminder_message(uuid,uuid,text,text)'::regprocedure
  ) into source;
  needle := '    or case_row.decision is distinct from ''approved''';
  occurrence_count := (length(source) - length(replace(source, needle, ''))) /
    length(needle);
  if occurrence_count <> 1 then
    raise exception 'Payout reminder creation eligibility changed';
  end if;
  replacement := '    or not public.refund_payout_destination_case_current(case_row)';
  execute replace(source, needle, replacement);
end;
$migration$;

comment on function public.refund_payout_destination_case_current(
  public.refund_cases
) is
  'True for the historical approved-cash path or the current undecided open cash lifecycle that may use the existing protected payout-destination contact flow.';

comment on function public.refund_purchase_correction_request_fields(uuid) is
  'Returns the one payout-destination field for a current eligible cash case, otherwise delegates to the retained exact correction-field contract.';

select pg_notify('pgrst', 'reload schema');
