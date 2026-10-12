-- #1375/#1350/#1758. October 3 current-company history policy (#1861) permits
-- an ordinary administrative correction, not a real sale/new financial owner.
-- Preserve original intake and reviewed evidence. No case, sale, link, contact,
-- decision, receipt or payment is rewritten by this migration.
create index admin_audit_log_catalog_association_idx
  on public.admin_audit_log(entity_id,created_at)
  where action in('reporting_machine.upserted','reporting_location.created');

create function private.refund_snapcase_reviewed_catalog_association(
  p_case_id uuid, p_sales_fact_id uuid
)
returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  c public.refund_cases;
  m public.reporting_machines;
  original_location public.reporting_locations;
  current_location public.reporting_locations;
  move public.admin_audit_log;
  reviewed public.refund_sunze_cash_correlation_attempts;
  historical_digest text;
begin
  select * into c from public.refund_cases where id=p_case_id;
  select * into m from public.reporting_machines where id=c.reporting_machine_id;
  select * into original_location from public.reporting_locations where id=c.reporting_location_id;
  select * into current_location from public.reporting_locations where id=m.location_id;
  if c.id is null or m.id is null
    or c.reporting_location_id=m.location_id
    or c.case_population<>'customer' or c.intake_source<>'form'
    or c.payment_method<>'cash'
    or c.matched_sales_fact_id is distinct from p_sales_fact_id
    or c.intake_selection_kind is distinct from 'exact_machine'
    or c.intake_selection_machine_ids is distinct from array[m.id]
    or c.intake_selection_key is distinct from public.refund_public_selection_key('machine|'||m.id::text)
    or m.status<>'active' or m.management_archived_at is not null
    or original_location.id is null or current_location.id is null
    or original_location.status<>'active' or current_location.status<>'active'
    or original_location.account_id=m.account_id
    or current_location.account_id<>m.account_id
    or current_location.name is distinct from 'Unmapped Hub '||m.id::text
    or current_location.city is not null or current_location.state is not null
    or c.incident_time_resolution is distinct from 'exact'
    or c.incident_timezone is distinct from original_location.timezone
    or current_location.timezone is distinct from original_location.timezone
  then return false; end if;

  -- This proves source association, not workflow/payment eligibility. Approval,
  -- settlement or an outcome hold must not change the source identity or hide
  -- accepted purchase evidence. Existing consumers enforce their own authority,
  -- reconciliation, contact-budget and terminal-state boundaries.

  -- A single recorded company correction is the supported chain. A second
  -- association change, relocation, explicit transfer/date or other changed
  -- machine field requires separate review; machine identity alone is no proof.
  if (select count(*) from public.admin_audit_log a
    where a.entity_type='reporting_machine' and a.entity_id=m.id::text
      and a.action='reporting_machine.upserted' and a.created_at>c.created_at
      and (a.before->>'location_id' is distinct from a.after->>'location_id'
        or a.before->>'account_id' is distinct from a.after->>'account_id'))<>1
  then return false; end if;
  select * into move from public.admin_audit_log a
  where a.entity_type='reporting_machine' and a.entity_id=m.id::text
    and a.action='reporting_machine.upserted' and a.created_at>c.created_at
    and a.actor_user_id is not null
    and a.before->>'id'=m.id::text and a.after->>'id'=m.id::text
    and a.before->>'location_id'=original_location.id::text
    and a.after->>'location_id'=current_location.id::text
    and a.before->>'account_id'=original_location.account_id::text
    and a.after->>'account_id'=m.account_id::text
    and (a.before-array['account_id','location_id','updated_at'])=
        (a.after-array['account_id','location_id','updated_at'])
    and a.after->>'machine_type'=m.machine_type
    and a.after->>'sunze_machine_id' is not distinct from m.sunze_machine_id
    and a.after->>'nayax_machine_id' is not distinct from m.nayax_machine_id
    and a.after->>'nayax_account_key' is not distinct from m.nayax_account_key
    and a.meta->>'reason'='Reporting machine identity updated'
    and a.meta-array['reason','promoted_sunze_pending_sales']='{}'::jsonb
    and exists(select 1 from public.admin_audit_log creation
      where creation.action='reporting_location.created'
        and creation.entity_type='reporting_location'
        and creation.entity_id=current_location.id::text
        and creation.actor_user_id=a.actor_user_id and creation.created_at=a.created_at
        and creation.before='{}'::jsonb
        and creation.after-'updated_at'=to_jsonb(current_location)-'updated_at'
        and creation.meta=jsonb_build_object('reason','Reporting machine identity updated','machineId',m.id));
  if not found then return false; end if;

  -- Active selection must still be reviewed, same-fact and exact-sale. Retain
  -- the original pre-correction proof through an authorized source-reconciliation
  -- replacement; revocation/release for any other reason cannot reopen it.
  if not exists(select 1 from public.refund_sunze_cash_sale_links active
    where active.refund_case_id=c.id and active.sales_fact_id=p_sales_fact_id
      and active.released_at is null and active.link_origin='reviewed'
      and active.case_fact_version=c.deterministic_fact_version)
  then return false; end if;
  select attempt.* into reviewed
  from public.refund_sunze_cash_sale_links link
  join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=link.correlation_attempt_id
  join public.refund_sunze_cash_correlation_candidates candidate
    on candidate.attempt_id=attempt.id and candidate.sales_fact_id=link.sales_fact_id
  join public.machine_sales_facts sale on sale.id=candidate.sales_fact_id
  join private.snapcase_machine_mappings mapping on mapping.id::text=sale.raw_payload->>'mappingId'
  where link.refund_case_id=c.id and link.sales_fact_id=p_sales_fact_id
    and link.link_origin='reviewed' and link.case_fact_version=c.deterministic_fact_version
    and (link.released_at is null or (link.release_reason='source_reconciliation'
      and link.released_case_fact_version=c.deterministic_fact_version and link.released_at>move.created_at))
    and link.linked_at<move.created_at and attempt.evaluated_at<move.created_at
    and attempt.refund_case_id=c.id and attempt.case_fact_version=c.deterministic_fact_version
    and attempt.invalidated_at is null and attempt.policy_version='sunze_cash_correlation_v1'
    and attempt.reason_code='published_snapcase_cash_found'
    and attempt.match_state='multiple_possible_sales' and attempt.candidate_count=1
    and attempt.source_snapshot_key like 'snapcase:%'
    and candidate.selection_conflict is false
    and candidate.amount_cents=sale.net_sales_cents and candidate.payment_time=sale.payment_time
    and candidate.evidence_codes @> array['machine_exact','cash_payment','payment_success',
      'published_snapcase_cash','source_time_validated']
    and sale.reporting_machine_id=m.id
    and mapping.reporting_machine_id=m.id
    and mapping.mapped_at<=attempt.evaluated_at and mapping.updated_at<=attempt.evaluated_at
    and exists(select 1 from public.refund_case_events e
      where e.refund_case_id=c.id and e.event_type='sunze_cash_candidate_selected'
        and e.created_at<move.created_at and e.actor_user_id is not null
        and e.metadata->>'attemptId'=attempt.id::text)
  order by attempt.evaluated_at desc,attempt.id desc limit 1;
  if not found then return false; end if;

  -- Reconstruct the exact old source digest from CURRENT authoritative rows,
  -- substituting only the audited original internal Location. Changed provider
  -- revisions, mapping, amounts, times or scope cannot borrow the old review.
  -- The trusted-row query is the same as refund_current_sunze_cash_source_key.
    select md5(coalesce(string_agg(concat_ws(':',fact.id::text,fact.source_order_hash,
      fact.source_row_hash,fact.net_sales_cents::text,fact.payment_time::text,
      original_location.id::text,location.timezone,source.source_timezone),'|' order by fact.id),'empty'))
      into historical_digest
    from public.machine_sales_facts fact
    join public.reporting_machines machine on machine.id=fact.reporting_machine_id
    join public.reporting_locations location on location.id=machine.location_id
    join private.snapcase_machine_mappings mapping
      on mapping.id::text=fact.raw_payload->>'mappingId'
      and mapping.reporting_machine_id=machine.id
      and mapping.provider_account_id::text=fact.raw_payload->>'providerAccountId'
      and mapping.source_machine_id=fact.raw_payload->>'sourceMachineId'
    join private.snapcase_source_machines source
      on source.provider_account_id=mapping.provider_account_id
      and source.source_machine_id=mapping.source_machine_id
    join private.snapcase_sales_observations payment
      on payment.provider_account_id=mapping.provider_account_id
      and payment.source_machine_id=mapping.source_machine_id and payment.resource='payment'
      and payment.source_key=fact.raw_payload->>'sourcePaymentKey'
      and payment.revision_digest=fact.raw_payload->>'sourcePaymentRevisionDigest'
    where fact.reporting_machine_id=c.reporting_machine_id
      and machine.status='active' and location.status='active'
      and private.snapcase_mapping_target_eligible(machine)
      and fact.reporting_location_id=machine.location_id
      and source.source_timezone=location.timezone
      and exists(select 1 from pg_catalog.pg_timezone_names zone where zone.name=location.timezone)
      and fact.source='snapcase_cash' and fact.payment_method='cash'
      and fact.source_payment_status='success'
      and fact.raw_payload->>'publicationState'='active'
      and fact.raw_payload->>'contractVersion'='snapcase.financial.machine-local.v1'
      and fact.raw_payload->>'amountBasis'='gross_customer_charge_minor'
      and fact.raw_payload->>'timestampBasis'='confirmed_machine_local_timezone'
      and payment.source_status='success' and payment.normalized_tender='cash'
      and payment.source_tender_code='1' and payment.currency_code='USD'
      and coalesce(payment.refund_amount_minor,0)=0
      and not(payment.exception_codes && array[
        'amount_unit_unverified','currency_unverified','financial_tender_semantics_unverified',
        'invalid_amount_text','source_clock_offset_missing','source_time_semantics_unverified']::text[])
      and fact.net_sales_cents=payment.amount_minor and fact.net_sales_cents>0
      and fact.payment_time=payment.occurred_at
      and fact.sale_date=(payment.occurred_at at time zone location.timezone)::date
      and fact.sale_date between mapping.effective_start_date and coalesce(mapping.effective_end_date,'infinity'::date)
      and fact.payment_time between c.incident_at-interval '1 hour' and c.incident_at+interval '1 hour'
      and fact.source_order_hash=encode(extensions.digest(convert_to(
        'snapcase-cash-v1|'||mapping.provider_account_id::text||'|'||payment.source_key,'UTF8'),'sha256'),'hex')
      and fact.source_row_hash=encode(extensions.digest(convert_to(concat_ws('|',
        'snapcase-cash-publication-v1',payment.source_key,payment.revision_digest,
        mapping.id::text,mapping.mapped_at::text,'snapcase.financial.machine-local.v1'
      ),'UTF8'),'sha256'),'hex');
  return historical_digest<>md5('empty')
    and reviewed.source_snapshot_key='snapcase:'||historical_digest;
end;
$$;
revoke all on function private.refund_snapcase_reviewed_catalog_association(uuid,uuid)
  from public,anon,authenticated,service_role;

do $repair$
declare
  definition text;
  anchor text;
  replacement text;
  signature text;
begin
  foreach signature in array array[
    'public.service_correlate_sunze_cash_case(uuid,bigint,text,uuid,timestamptz)',
    'public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    anchor:='case_row.reporting_location_id=machine.location_id';
    if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
      raise exception 'Reviewed catalog association anchor changed: %',signature;
    end if;
    replacement:='(case_row.reporting_location_id=machine.location_id or
        private.refund_snapcase_reviewed_catalog_association(case_row.id,fact.id))';
    execute replace(definition,anchor,replacement);
  end loop;

  definition:=pg_get_functiondef('public.service_select_sunze_cash_candidate(uuid,uuid,uuid,bigint,bigint,uuid)'::regprocedure);
  anchor:='  if attempt_row.source_snapshot_key like ''snapcase:%'' then';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Reviewed catalog selection-lock anchor changed';
  end if;
  replacement:=$locks$  if attempt_row.source_snapshot_key like 'snapcase:%' then
    -- The existing case lock serializes supported link replacement/revocation.
    -- Also hold historical proof rows through source/currentness revalidation.
    perform 1 from public.reporting_locations where id=case_row.reporting_location_id for share;
    perform 1 from public.admin_audit_log
      where action in('reporting_machine.upserted','reporting_location.created')
        and entity_id in(case_row.reporting_machine_id::text,
          (select location_id::text from public.reporting_machines where id=case_row.reporting_machine_id))
      order by id for share;
    perform 1 from public.refund_sunze_cash_sale_links
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_attempts
      where refund_case_id=case_row.id order by id for share;
    perform 1 from public.refund_sunze_cash_correlation_candidates candidate
      join public.refund_sunze_cash_correlation_attempts attempt on attempt.id=candidate.attempt_id
      where attempt.refund_case_id=case_row.id
      order by candidate.attempt_id,candidate.sales_fact_id for share of candidate;
$locks$;
  execute replace(definition,anchor,replacement);

  -- Existing current-source checks drive correlation, read projection,
  -- reviewed selection and payout currentness. A narrow discriminator makes
  -- the old zero-candidate cache stale without changing its row or the policy.
  definition:=pg_get_functiondef('public.refund_current_sunze_cash_source_key(uuid,timestamptz,timestamptz)'::regprocedure);
  anchor:='return ''snapcase:''||snapshot_digest;';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'Reviewed catalog source-key anchor changed';
  end if;
  replacement:=$key$if exists(select 1 from public.refund_cases retained
      where retained.reporting_machine_id=p_reporting_machine_id
        and retained.incident_at=p_incident_at
        and retained.matched_sales_fact_id is not null
        and private.refund_snapcase_reviewed_catalog_association(retained.id,retained.matched_sales_fact_id)) then
      return 'snapcase:'||snapshot_digest||':reviewed_catalog_v1';
    end if;
    return 'snapcase:'||snapshot_digest;$key$;
  execute replace(definition,anchor,replacement);
end;
$repair$;

select pg_notify('pgrst','reload schema');
