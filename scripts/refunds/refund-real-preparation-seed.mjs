import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const REAL_PREPARATION_SEED_FILENAME = 'refund-real-preparation-seed.json';

/** Export one synthetic, actually prepared Manager RPC result from disposable DB. */
export async function writeRealRefundPreparationSeed({ dbPort, outputDir }) {
  const client = new pg.Client({
    host: '127.0.0.1', port: dbPort, database: 'postgres',
    user: 'postgres', password: 'postgres',
  });
  const caseId = 'd8760000-0000-4000-8000-000000000001';
  const managerId = '11111111-1111-4111-8111-111111111111';
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`
      insert into auth.users (id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
      values ('11111111-1111-4111-8111-111111111111','authenticated','authenticated',
        'refund-manager@example.test','{}','{}');
      insert into public.customer_accounts (id,name,account_type)
      values ('d8720000-0000-4000-8000-000000000001','Prepared browser seed','internal');
      insert into public.reporting_locations (id,account_id,name,timezone)
      values ('d8730000-0000-4000-8000-000000000001',
        'd8720000-0000-4000-8000-000000000001','Prepared browser location','America/Los_Angeles');
      insert into public.reporting_machines
        (id,account_id,location_id,machine_label,status,sunze_machine_id)
      values ('d8740000-0000-4000-8000-000000000001',
        'd8720000-0000-4000-8000-000000000001',
        'd8730000-0000-4000-8000-000000000001',
        'Prepared cash machine','active','PREP-BROWSER-CASH');
      insert into public.reporting_machine_refund_managers
        (reporting_machine_id,manager_user_id,manager_email,grant_reason)
      values ('d8740000-0000-4000-8000-000000000001',
        '11111111-1111-4111-8111-111111111111',
        'refund-manager@example.test','Synthetic browser proof');
      insert into public.refund_cases
        (id,public_reference,reporting_machine_id,reporting_location_id,
         customer_email,issue_summary,incident_at,incident_timezone,
         payment_method,payment_amount_cents,refund_amount_cents,
         zelle_payment_contact,status,correlation_status)
      values ('d8760000-0000-4000-8000-000000000001','RF-UAT-REAL-PREP',
        'd8740000-0000-4000-8000-000000000001',
        'd8730000-0000-4000-8000-000000000001',
        'real-prep@example.invalid','Synthetic cash research',
        statement_timestamp()-interval '11 hours','America/Los_Angeles',
        'cash',900,900,'real-prep-zelle@example.invalid','needs_review','manual_review');
    `);

    await client.query('set local role service_role');
    const worker = await client.query('select public.service_prepare_due_refund_cash_cases(10) as result');
    await client.query('reset role');
    if (Number(worker.rows[0]?.result?.evaluated) !== 1) {
      throw new Error('Synthetic cash worker did not evaluate exactly one case.');
    }

    await client.query('set local role service_role');
    const prepared = await client.query(`
      select c.official_action_version::integer as "officialActionVersion",
        c.deterministic_fact_version::integer as "deterministicFactVersion",
        c.reporting_machine_id as "reportingMachineId",
        c.reporting_location_id as "reportingLocationId",
        c.status, c.decision, c.payment_method as "paymentMethod",
        c.payment_amount_cents as "paymentAmountCents",
        c.refund_amount_cents as "refundAmountCents",
        c.zelle_payment_contact as "zellePaymentContact",
        c.correlation_status as "correlationStatus",
        c.correlation_source as "correlationSource",
        c.correlation_confidence::double precision as "correlationConfidence",
        c.correlation_summary as "correlationSummary",
        c.cash_match_state as "cashMatchState",
        public.can_perform_refund_official_action($2,c.id) as "canPerformOfficialAction",
        public.refund_manager_preparation_snapshot(c.id,c.official_action_version) as proof
      from public.refund_cases c where c.id=$1
    `, [caseId, managerId]);
    await client.query('reset role');
    const { officialActionVersion, deterministicFactVersion, proof, ...caseRecord } = prepared.rows[0] ?? {};
    if (caseRecord.canPerformOfficialAction !== true ||
        proof?.schemaVersion !== 'refund_manager_preparation_v1' ||
        proof?.evidenceBasis !== 'cash_coverage_unavailable_researched' ||
        Number(proof?.officialActionVersion) !== Number(officialActionVersion) ||
        Number(proof?.deterministicFactVersion) !== Number(deterministicFactVersion)) {
      throw new Error('Synthetic completed preparation proof is missing or stale.');
    }

    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({ sub: managerId, role: 'authenticated' }),
    ]);
    const lifecycleResult = await client.query(
      'select public.get_refund_lifecycle_for_manager($1) as lifecycle', [caseId],
    );
    await client.query('reset role');
    const lifecycle = lifecycleResult.rows[0]?.lifecycle;
    if (lifecycle?.nextWork?.actor !== 'manager' ||
        lifecycle.nextWork.actionCode !== 'send_cash_refund_and_confirm' ||
        lifecycle.nextWork.isOpen !== true) {
      throw new Error('Authenticated mapped Manager projection is not the prepared cash action.');
    }

    const seed = {
      schemaVersion: 'refund_real_preparation_browser_seed_v1',
      source: 'disposable_db_completed_worker_and_authenticated_manager_rpc',
      caseId, publicReference: 'RF-UAT-REAL-PREP',
      managerId, officialActionVersion, deterministicFactVersion,
      caseRecord, preparationProof: proof, lifecycle,
    };
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, REAL_PREPARATION_SEED_FILENAME),
      `${JSON.stringify(seed, null, 2)}\n`, { flag: 'wx' });
    return seed;
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}
