-- Recover reviewed historical sales for a reporting machine that is inactive
-- even when Nayax still reports the provider device as active. The immutable
-- DTM row classification and exact inventory/reporting link are both required;
-- ordinary excluded inventory remains held.

create function private.promote_nayax_historical_inactive_sales(
  p_limit integer default 10000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  pending_sale record;
  v_promoted_fact_id uuid;
  promoted_rows integer := 0;
  normalized_limit integer := least(greatest(coalesce(p_limit, 10000), 1), 10000);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service historical Nayax sales promotion required';
  end if;

  for pending_sale in
    select
      pending.*,
      machine.id as mapped_machine_id,
      location.id as mapped_location_id,
      evidence.import_run_id as dtm_import_run_id
    from public.nayax_pending_sales pending
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key = pending.account_key
     and inventory.nayax_machine_id = pending.provider_machine_id
     and inventory.reconciliation_state = 'excluded'
     and inventory.reporting_machine_id is not null
    join public.reporting_machines machine
      on machine.id = inventory.reporting_machine_id
     and machine.nayax_machine_id = inventory.nayax_machine_id
     and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key
    join public.reporting_locations location
      on location.id = machine.location_id
    join lateral (
      select source_file.import_run_id
      from public.nayax_dtm_export_rows dtm_row
      join public.nayax_dtm_export_files source_file
        on source_file.file_digest = dtm_row.file_digest
      join public.nayax_dtm_export_completions completion
        on completion.file_digest = dtm_row.file_digest
      where dtm_row.source_order_hash = pending.source_order_hash
        and dtm_row.source_row_hash = pending.source_row_hash
        and dtm_row.provider_actor_id = pending.provider_actor_id
        and dtm_row.provider_machine_id = pending.provider_machine_id
        and dtm_row.provider_site_id = pending.provider_site_id
        and dtm_row.provider_transaction_id = pending.provider_transaction_id
        and dtm_row.mapping_disposition = 'historical_inactive_exact_link'
        and dtm_row.history_scope_disposition = 'in_scope'
        and dtm_row.provider_status in (12, 62, 63)
        and dtm_row.settlement_amount_cents = pending.settlement_amount_cents
        and dtm_row.settlement_amount_cents > 0
      order by dtm_row.file_digest
      limit 1
    ) evidence on true
    where pending.disposition = 'excluded'
    order by pending.provider_settled_at, pending.source_order_hash
    limit normalized_limit
    for update of pending skip locked
  loop
    v_promoted_fact_id := null;
    insert into public.machine_sales_facts as target (
      reporting_machine_id,
      reporting_location_id,
      sale_date,
      payment_method,
      net_sales_cents,
      transaction_count,
      source,
      source_order_hash,
      source_row_hash,
      import_run_id,
      source_trade_name,
      item_quantity,
      tax_cents,
      source_payment_status,
      payment_time,
      raw_payload
    ) values (
      pending_sale.mapped_machine_id,
      pending_sale.mapped_location_id,
      pending_sale.machine_settled_at::date,
      'credit',
      pending_sale.settlement_amount_cents,
      1,
      'nayax_scheduled_report',
      pending_sale.source_order_hash,
      pending_sale.source_row_hash,
      pending_sale.dtm_import_run_id,
      null,
      1,
      0,
      pending_sale.provider_status_name,
      pending_sale.provider_settled_at,
      pending_sale.normalized_sale || jsonb_build_object(
        'payloadRedacted', true,
        'manualDtmEvidence', true,
        'historicalInactiveExactLinkRecovery', true
      )
    )
    on conflict (source, source_order_hash)
      where source = 'nayax_scheduled_report'
        and source_order_hash is not null
    do update set
      reporting_machine_id = excluded.reporting_machine_id,
      reporting_location_id = excluded.reporting_location_id,
      sale_date = excluded.sale_date,
      payment_method = excluded.payment_method,
      net_sales_cents = excluded.net_sales_cents,
      transaction_count = excluded.transaction_count,
      source_row_hash = excluded.source_row_hash,
      import_run_id = excluded.import_run_id,
      source_payment_status = excluded.source_payment_status,
      payment_time = excluded.payment_time,
      raw_payload = excluded.raw_payload,
      updated_at = statement_timestamp()
    where private.nayax_provider_evidence_is_newer(
      target.raw_payload,
      excluded.raw_payload
    )
    returning id into v_promoted_fact_id;

    if v_promoted_fact_id is null then
      select fact.id into v_promoted_fact_id
      from public.machine_sales_facts fact
      where fact.source = 'nayax_scheduled_report'
        and fact.source_order_hash = pending_sale.source_order_hash;
    end if;

    if v_promoted_fact_id is null then
      raise exception 'Historical inactive Nayax sale promotion failed';
    end if;

    update public.nayax_pending_sales
    set disposition = 'promoted',
      disposition_reason = 'historical_inactive_exact_link',
      promoted_fact_id = v_promoted_fact_id,
      promotion_import_run_id = pending_sale.dtm_import_run_id,
      promoted_at = statement_timestamp()
    where source_order_hash = pending_sale.source_order_hash;

    promoted_rows := promoted_rows + 1;
  end loop;

  return promoted_rows;
end;
$$;

revoke all on function private.promote_nayax_historical_inactive_sales(integer)
  from public, anon, authenticated;
grant execute on function private.promote_nayax_historical_inactive_sales(integer)
  to service_role;

create or replace function private.promote_nayax_provider_refunds(p_limit integer default 10000)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row record;
  adjustment uuid;
  promoted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service refund promotion required';
  end if;

  for event_row in
    select
      event.*,
      inventory.reporting_machine_id as mapped_machine_id,
      machine.location_id as mapped_location_id
    from public.nayax_provider_refund_events event
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key = event.account_key
     and inventory.nayax_machine_id = event.provider_machine_id
     and (
       inventory.reconciliation_state = 'published'
       or (
         event.historical_inactive_exact_link
         and inventory.reconciliation_state = 'excluded'
         and inventory.reporting_machine_id is not null
         and exists (
           select 1
           from public.nayax_provider_refund_event_provenance provenance
           join public.nayax_dtm_export_rows dtm_row
             on dtm_row.file_digest = provenance.dtm_file_digest
            and dtm_row.source_row_hash = provenance.dtm_source_row_hash
           join public.nayax_dtm_export_completions completion
             on completion.file_digest = dtm_row.file_digest
           where provenance.refund_identity_hash = event.refund_identity_hash
             and provenance.origin = 'manual_dtm_export'
             and dtm_row.refund_identity_hash = event.refund_identity_hash
             and dtm_row.provider_actor_id = event.provider_actor_id
             and dtm_row.provider_machine_id = event.provider_machine_id
             and dtm_row.mapping_disposition = 'historical_inactive_exact_link'
             and dtm_row.history_scope_disposition = 'in_scope'
         )
       )
     )
    join public.reporting_machines machine
      on machine.id = inventory.reporting_machine_id
     and machine.nayax_machine_id = inventory.nayax_machine_id
     and upper(coalesce(machine.nayax_account_key, 'TGPACI_USA_DB')) = inventory.account_key
    where event.disposition = 'held_unmapped'
    order by event.machine_event_at, event.refund_identity_hash
    limit least(greatest(coalesce(p_limit, 10000), 1), 10000)
    for update of event skip locked
  loop
    insert into public.sales_adjustment_facts (
      reporting_machine_id,
      reporting_location_id,
      adjustment_date,
      adjustment_type,
      amount_cents,
      complaint_count,
      source,
      source_row_hash,
      source_reference,
      source_row_reference,
      match_status,
      match_confidence,
      notes,
      raw_payload
    ) values (
      event_row.mapped_machine_id,
      event_row.mapped_location_id,
      event_row.machine_event_at::date,
      'refund',
      event_row.amount_cents,
      0,
      'nayax_provider_refund',
      event_row.refund_identity_hash,
      'nayax_provider_refund',
      event_row.refund_identity_hash,
      'applied',
      1,
      'Nayax provider refund',
      jsonb_build_object(
        'refundEventHash', event_row.refund_identity_hash,
        'evidenceKind', event_row.evidence_kind,
        'payloadRedacted', true,
        'accountingDateMeaning', 'provider_machine_local_event_date'
      )
    )
    on conflict (source, source_row_hash) do nothing
    returning id into adjustment;

    if adjustment is null then
      select fact.id into adjustment
      from public.sales_adjustment_facts fact
      where fact.source = 'nayax_provider_refund'
        and fact.source_row_hash = event_row.refund_identity_hash;
    end if;

    update public.nayax_provider_refund_events
    set reporting_machine_id = event_row.mapped_machine_id,
      reporting_location_id = event_row.mapped_location_id,
      adjustment_id = adjustment,
      disposition = 'applied'
    where refund_identity_hash = event_row.refund_identity_hash;

    promoted := promoted + 1;
  end loop;

  return promoted;
end;
$$;

revoke all on function private.promote_nayax_provider_refunds(integer)
  from public, anon, authenticated;
grant execute on function private.promote_nayax_provider_refunds(integer)
  to service_role;

create or replace function public.service_promote_nayax_pending_sales(
  p_limit integer default 10000
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  refund_count integer;
  historical_inactive_count integer;
begin
  result := public.service_promote_nayax_pending_sales_pre_refund_v1(p_limit);
  historical_inactive_count := private.promote_nayax_historical_inactive_sales(p_limit);
  refund_count := private.promote_nayax_provider_refunds(p_limit);
  return result || jsonb_build_object(
    'promotedHistoricalInactiveRows', historical_inactive_count,
    'promotedRefundRows', refund_count
  );
end;
$$;

revoke all on function public.service_promote_nayax_pending_sales(integer)
  from public, anon, authenticated;
grant execute on function public.service_promote_nayax_pending_sales(integer)
  to service_role;
