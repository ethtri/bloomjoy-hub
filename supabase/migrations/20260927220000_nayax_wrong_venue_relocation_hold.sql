-- Withdraw two current-location links and suppress the six scheduled Nayax
-- facts that immutable DTM history proves belong to earlier venue windows.
-- The provider facts and receipts stay in place so a later, exact effective
-- venue mapping can move the retained facts and restore the original metrics.

create or replace function private.preserve_nayax_relocation_hold_metrics()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'nayax_scheduled_report'
    and new.raw_payload #>> '{relocationHold,status}' = 'held_wrong_venue'
    and new.raw_payload #>> '{relocationHold,basis}' =
      'completed_dtm_relocation_candidate' then
    new.net_sales_cents := 0;
    new.transaction_count := 0;
    new.item_quantity := 0;
    new.tax_cents := 0;
  end if;

  return new;
end;
$$;

revoke all on function private.preserve_nayax_relocation_hold_metrics()
  from public, anon, authenticated, service_role;

create trigger machine_sales_fact_relocation_hold_metrics
before insert or update of
  net_sales_cents,
  transaction_count,
  item_quantity,
  tax_cents,
  raw_payload
on public.machine_sales_facts
for each row execute function private.preserve_nayax_relocation_hold_metrics();

create or replace function private.apply_nayax_wrong_venue_relocation_hold_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_fact_ids uuid[];
  target_inventory_ids uuid[];
  target_fact_count integer;
  target_inventory_count integer;
  target_original_cents bigint;
  conflicting_inventory_count integer;
  active_authority_boundary_count integer;
  changed_fact_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('nayax-wrong-venue-relocation-hold-v1')
  );

  select pg_catalog.array_agg(candidate.fact_id order by candidate.fact_id)
  into target_fact_ids
  from (
    select distinct fact.id as fact_id
    from public.nayax_dtm_export_rows dtm
    join public.nayax_dtm_export_completions completion
      on completion.file_digest = dtm.file_digest
    join public.machine_sales_facts fact
      on fact.source = 'nayax_scheduled_report'
     and fact.source_order_hash = dtm.source_order_hash
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key = 'TGPACI_USA_DB'
     and inventory.nayax_machine_id = dtm.provider_machine_id
     and inventory.reporting_machine_id = fact.reporting_machine_id
    where dtm.mapping_disposition = 'relocation_candidate'
      and dtm.history_scope_disposition = 'in_scope'
      and dtm.financial_disposition = 'eligible'
      and dtm.disposition = 'held_relocation'
      and dtm.settlement_amount_cents > 0
      and fact.payment_method = 'credit'
      and fact.raw_payload ->> 'providerMachineId' = dtm.provider_machine_id
      and fact.raw_payload ->> 'actorId' = dtm.provider_actor_id
      and fact.raw_payload ->> 'siteId' = dtm.provider_site_id
      and fact.raw_payload ->> 'transactionId' = dtm.provider_transaction_id
      and dtm.settlement_amount_cents = coalesce(
        (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
        fact.net_sales_cents
      )
  ) candidate;

  target_fact_count := coalesce(pg_catalog.cardinality(target_fact_ids), 0);

  -- Empty disposable databases do not contain the reviewed production evidence.
  if target_fact_count = 0 then
    return jsonb_build_object('skipped', true, 'heldFactCount', 0);
  end if;

  select
    coalesce(pg_catalog.sum(
      coalesce(
        (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
        fact.net_sales_cents
      )
    ), 0)
  into target_original_cents
  from public.machine_sales_facts fact
  where fact.id = any(target_fact_ids);

  if target_fact_count <> 6 or target_original_cents <> 17490 then
    raise exception
      'Expected exactly 6 reviewed relocation facts totaling 17490 cents; found % totaling %',
      target_fact_count,
      target_original_cents;
  end if;

  select pg_catalog.array_agg(candidate.inventory_id order by candidate.inventory_id)
  into target_inventory_ids
  from (
    select distinct inventory.id as inventory_id
    from public.nayax_dtm_export_rows dtm
    join public.nayax_dtm_export_completions completion
      on completion.file_digest = dtm.file_digest
    join public.machine_sales_facts fact
      on fact.source = 'nayax_scheduled_report'
     and fact.source_order_hash = dtm.source_order_hash
     and fact.id = any(target_fact_ids)
    join public.refund_nayax_machine_inventory inventory
      on inventory.account_key = 'TGPACI_USA_DB'
     and inventory.nayax_machine_id = dtm.provider_machine_id
     and inventory.reporting_machine_id = fact.reporting_machine_id
    where dtm.mapping_disposition = 'relocation_candidate'
      and dtm.history_scope_disposition = 'in_scope'
      and dtm.financial_disposition = 'eligible'
      and dtm.disposition = 'held_relocation'
      and dtm.settlement_amount_cents = coalesce(
        (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer,
        fact.net_sales_cents
      )
  ) candidate;

  target_inventory_count := coalesce(
    pg_catalog.cardinality(target_inventory_ids),
    0
  );

  if target_inventory_count <> 2 then
    raise exception
      'Expected exactly 2 reviewed current inventory links; found %',
      target_inventory_count;
  end if;

  select count(*)::integer
  into conflicting_inventory_count
  from public.refund_nayax_machine_inventory inventory
  where inventory.id = any(target_inventory_ids)
    and (
      not inventory.provider_is_active
      or inventory.reporting_machine_id is null
      or inventory.refund_category is null
      or inventory.exclusion_reason is not null
      or not (
        inventory.reconciliation_state = 'published'
        or (
          inventory.reconciliation_state = 'needs_setup'
          and inventory.setup_reason = 'historical_effective_location_link_required'
        )
      )
    );

  if conflicting_inventory_count <> 0 then
    raise exception 'A reviewed relocation inventory link changed unexpectedly';
  end if;

  select count(*)::integer
  into active_authority_boundary_count
  from public.refund_nayax_machine_inventory inventory
  join public.reporting_machines machine
    on machine.id = inventory.reporting_machine_id
  where inventory.id = any(target_inventory_ids)
    and machine.nayax_card_sales_started_on is not null;

  if active_authority_boundary_count <> 0 then
    raise exception 'Reviewed relocation machines unexpectedly have active card-authority boundaries';
  end if;

  if exists (
    select 1
    from public.machine_sales_facts target
    join public.machine_sales_facts sunze
      on sunze.reporting_machine_id = target.reporting_machine_id
     and sunze.sale_date = target.sale_date
     and sunze.source = 'sunze_browser'
    where target.id = any(target_fact_ids)
  ) then
    raise exception 'Reviewed wrong-venue windows unexpectedly contain Sunze facts';
  end if;

  if exists (
    select 1
    from public.machine_sales_facts target
    join public.machine_sales_facts projection
      on projection.reporting_machine_id = target.reporting_machine_id
     and projection.sale_date = target.sale_date
     and projection.source = 'card_authority_daily'
     and (
       projection.net_sales_cents <> 0
       or projection.transaction_count <> 0
       or projection.item_quantity <> 0
       or projection.tax_cents <> 0
     )
    where target.id = any(target_fact_ids)
  ) then
    raise exception 'Reviewed wrong-venue windows unexpectedly contain active card projections';
  end if;

  update public.refund_nayax_machine_inventory inventory
  set
    reconciliation_state = 'needs_setup',
    setup_reason = 'historical_effective_location_link_required',
    exclusion_reason = null,
    decision_reason =
      'Completed immutable DTM history proves a prior venue window; confirm the effective location link before publishing (#1478/#1479).',
    updated_at = statement_timestamp()
  where inventory.id = any(target_inventory_ids)
    and (
      inventory.reconciliation_state is distinct from 'needs_setup'
      or inventory.setup_reason is distinct from 'historical_effective_location_link_required'
      or inventory.exclusion_reason is not null
      or inventory.decision_reason is distinct from
        'Completed immutable DTM history proves a prior venue window; confirm the effective location link before publishing (#1478/#1479).'
    );

  update public.machine_sales_facts fact
  set
    net_sales_cents = 0,
    transaction_count = 0,
    item_quantity = 0,
    tax_cents = 0,
    raw_payload = fact.raw_payload
      || case
        when fact.raw_payload ? '_salesAuthorityOriginal' then '{}'::jsonb
        else jsonb_build_object(
          '_salesAuthorityOriginal',
          jsonb_build_object(
            'netSalesCents', fact.net_sales_cents,
            'transactionCount', fact.transaction_count,
            'itemQuantity', fact.item_quantity,
            'taxCents', fact.tax_cents
          )
        )
      end
      || jsonb_build_object(
        'relocationHold',
        jsonb_build_object(
          'status', 'held_wrong_venue',
          'basis', 'completed_dtm_relocation_candidate',
          'originalReportingMachineId', fact.reporting_machine_id,
          'originalReportingLocationId', fact.reporting_location_id,
          'payloadRedacted', true,
          'issues', jsonb_build_array(1478, 1479)
        )
      ),
    updated_at = statement_timestamp()
  where fact.id = any(target_fact_ids)
    and (
      fact.net_sales_cents <> 0
      or fact.transaction_count <> 0
      or fact.item_quantity <> 0
      or fact.tax_cents <> 0
      or fact.raw_payload #>> '{relocationHold,status}' is distinct from 'held_wrong_venue'
      or not (fact.raw_payload ? '_salesAuthorityOriginal')
    );

  get diagnostics changed_fact_count = row_count;

  if exists (
    select 1
    from public.machine_sales_facts fact
    where fact.id = any(target_fact_ids)
      and (
        fact.net_sales_cents <> 0
        or fact.transaction_count <> 0
        or fact.item_quantity <> 0
        or fact.tax_cents <> 0
        or fact.raw_payload #>> '{relocationHold,status}' is distinct from 'held_wrong_venue'
        or fact.raw_payload #>> '{relocationHold,basis}' is distinct from
          'completed_dtm_relocation_candidate'
      )
  ) then
    raise exception 'A reviewed wrong-venue fact remained financially active';
  end if;

  if (
    select coalesce(pg_catalog.sum(
      (fact.raw_payload #>> '{_salesAuthorityOriginal,netSalesCents}')::integer
    ), 0)
    from public.machine_sales_facts fact
    where fact.id = any(target_fact_ids)
  ) <> 17490 then
    raise exception 'Reviewed wrong-venue original metrics were not retained';
  end if;

  return jsonb_build_object(
    'skipped', false,
    'heldFactCount', target_fact_count,
    'heldOriginalCents', target_original_cents,
    'inventoryLinksWithdrawn', target_inventory_count,
    'factsChanged', changed_fact_count
  );
end;
$$;

revoke all on function private.apply_nayax_wrong_venue_relocation_hold_v1()
  from public, anon, authenticated, service_role;

comment on function private.apply_nayax_wrong_venue_relocation_hold_v1() is
  'One-time #1478/#1479 repair. Recovery requires an exact effective venue mapping, then a forward correction that moves each retained fact and restores its _salesAuthorityOriginal metrics before republishing the existing inventory link.';

select private.apply_nayax_wrong_venue_relocation_hold_v1();
