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
  const reviewedCardCaseId = 'd8760000-0000-4000-8000-000000000002';
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

    await client.query(`
      insert into public.reporting_machines
        (id,account_id,location_id,machine_label,status,nayax_machine_id,
         nayax_account_key,nayax_refunds_enabled)
      values ('d8740000-0000-4000-8000-000000000002',
        'd8720000-0000-4000-8000-000000000001',
        'd8730000-0000-4000-8000-000000000001',
        'Prepared reviewed card machine','active','REVIEWED-SEED-MACHINE',
        'REVIEWED_SEED_ACCOUNT',true);
      insert into public.reporting_machine_refund_managers
        (reporting_machine_id,manager_user_id,manager_email,grant_reason)
      values ('d8740000-0000-4000-8000-000000000002',
        '11111111-1111-4111-8111-111111111111',
        'refund-manager@example.test','Synthetic reviewed-set browser proof');
      insert into public.refund_nayax_machine_inventory
        (account_key,nayax_machine_id,reporting_machine_id)
      values ('REVIEWED_SEED_ACCOUNT','REVIEWED-SEED-MACHINE',
        'd8740000-0000-4000-8000-000000000002');
      insert into public.refund_cases
        (id,public_reference,reporting_machine_id,reporting_location_id,
         customer_email,issue_summary,incident_at,incident_timezone,
         incident_time_resolution,incident_time_confidence,payment_method,
         payment_amount_cents,card_last4,card_last4_provenance,
         payment_interaction,status,correlation_status,
         deterministic_fact_version,intake_source,intake_meta,
         customer_request_received_at,customer_request_received_source,
         nayax_lookup_generation,nayax_lookup_status,nayax_refund_execution_status)
      values ('d8760000-0000-4000-8000-000000000002','RF-UAT-REAL-REVIEWED',
        'd8740000-0000-4000-8000-000000000002',
        'd8730000-0000-4000-8000-000000000001',
        'real-reviewed@example.invalid','Two synthetic reviewed card purchases',
        '2026-09-12T20:00:00Z','America/Los_Angeles','exact','exact',
        'card',1000,'4242','physical_card','tap_card','needs_review','needs_nayax',
        1,'form','{}','2026-09-12T21:00:00Z','hosted_refund_intake',
        0,'not_started','not_requested');
    `);
    await client.query('set local role service_role');
    const cardStart = await client.query(
      `select public.service_begin_refund_nayax_lookup($1,1,'scheduled',null) as result`,
      [reviewedCardCaseId],
    );
    await client.query('reset role');
    if (Number(cardStart.rows[0]?.result?.lookupGeneration) !== 1) {
      throw new Error('Synthetic reviewed card lookup did not start.');
    }
    await client.query(`
      create function pg_temp.reviewed_seed_evidence(p_amount integer,p_rank integer)
      returns jsonb language sql stable as $$
      select jsonb_build_object(
        'source','nayax_api','selection_allowed',true,'is_recommended',false,
        'one_click_eligible',false,'recommendation_state','ambiguous',
        'confidence_class','ambiguous_manual','policy_version','2026-09-05.v11',
        'identifier_policy_version','2026-09-05.identifier.v2',
        'customer_fact_version',1,
        'customer_credential_class','customer_physical_contactless_pan',
        'provider_identifier_class','last_sales_present_identifier_unverified',
        'card_last4_comparison','exact_support','card_network_comparison','missing',
        'payment_interaction_comparison','unknown',
        'same_identifier_equivalence_proven',false,
        'identifier_review_state','exact_support',
        'customer_correction_fields','[]'::jsonb,'hard_exclusions','[]'::jsonb,
        'manual_review_reasons','[]'::jsonb,
        'reason_codes','["machine_exact","provider_sale_approved"]'::jsonb,
        'match_factors','[]'::jsonb
      ) || jsonb_build_object(
        'match_reason','One current machine sale reviewed with the request',
        'recommendation_rank',p_rank,'is_top_ranked',p_rank=1,
        'lookup_account_scope','REVIEWED_SEED_ACCOUNT',
        'lookup_provider_machine_id','REVIEWED-SEED-MACHINE',
        'provider_machine_id','REVIEWED-SEED-MACHINE',
        'machine_authorization_time_raw','2026-09-12T20:00:00Z',
        'machine_authorization_at','2026-09-12T20:00:00Z',
        'machine_authorization_time_source','MachineAuthorizationTime',
        'machine_time_resolution','exact','provider_time_resolution','exact',
        'provider_time_source','authorization_gmt',
        'authorized_at','2026-09-12T20:00:00Z',
        'customer_request_received_at','2026-09-12T21:00:00Z',
        'customer_request_received_source','hosted_refund_intake',
        'transaction_occurrence_proof_source',null,
        'transaction_occurrence_timestamp_source',null,
        'transaction_occurrence_timezone_basis',null,
        'transaction_occurrence_lower_bound_at',null,
        'transaction_occurrence_upper_bound_at',null,
        'request_receipt_lower_bound_at',null,'request_receipt_upper_bound_at',null,
        'request_time_boundary','occurrence_time_uncertain',
        'transaction_occurrence_comparable',false,
        'transaction_occurrence_semantics','unknown','time_delta_minutes',null,
        'amount_delta_cents',p_amount-1000,'provider_processing_time_delta_minutes',0,
        'payment_status','approved','payment_status_evidence','last_sales_contract',
        'provider_refund_state','clear','duplicate_provider_record',false,
        'card_last4','4242','currency_code','USD','amount_cents',p_amount)
      $$;
      insert into public.refund_nayax_lookup_candidates
        (token,refund_case_id,lookup_generation,actor_user_id,
         reporting_machine_id,provider_transaction_id,site_id,
         machine_authorization_time,amount_cents,card_last4,currency_code,
         evidence_summary,expires_at)
      values
        ('d8770000-0000-4000-8000-000000000001',
         'd8760000-0000-4000-8000-000000000002',1,null,
         'd8740000-0000-4000-8000-000000000002','REVIEWED-SEED-SALE-1',17,
         '2026-09-12T20:00:00Z',1090,'4242','USD',
         pg_temp.reviewed_seed_evidence(1090,1),now()+interval '1 hour'),
        ('d8770000-0000-4000-8000-000000000002',
         'd8760000-0000-4000-8000-000000000002',1,null,
         'd8740000-0000-4000-8000-000000000002','REVIEWED-SEED-SALE-2',17,
         '2026-09-12T20:00:00Z',1190,'4242','USD',
         pg_temp.reviewed_seed_evidence(1190,2),now()+interval '1 hour');
    `);
    await client.query('set local role service_role');
    const cardFinish = await client.query(`
      select public.service_commit_refund_nayax_lookup(
        $1,1,1,'multiple_matches','ambiguous','2026-09-05.v11',
        statement_timestamp(),'Two reviewed sales',null,2,'scheduled',null) as result
    `, [reviewedCardCaseId]);
    await client.query('reset role');
    if (cardFinish.rows[0]?.result?.applied !== true) {
      throw new Error('Synthetic reviewed card lookup did not complete.');
    }
    await client.query('set local role service_role');
    const cardProofResult = await client.query(`
      select public.refund_manager_preparation_snapshot(
        id,official_action_version) as proof
      from public.refund_cases where id=$1
    `, [reviewedCardCaseId]);
    await client.query('reset role');
    const cardProof = cardProofResult.rows[0]?.proof;
    if (cardProof?.evidenceBasis !== 'card_reviewed_candidate_set' ||
        cardProof?.candidateCount !== 2 ||
        cardProof?.eligibleCandidateTokens?.length !== 2) {
      throw new Error('Synthetic reviewed card preparation lacks two current safe purchases.');
    }
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({ sub: managerId, role: 'authenticated' }),
    ]);
    const managerOverviewResult = await client.query(
      'select public.admin_get_refund_operations_overview() as overview',
    );
    await client.query('reset role');
    const cardCase = managerOverviewResult.rows[0]?.overview?.cases?.find(
      (item) => item.id === reviewedCardCaseId,
    );
    if (cardCase?.canPerformOfficialAction !== true ||
        cardCase?.decision !== null ||
        cardCase?.matchedNayaxTransactionId != null ||
        cardCase?.lifecycle?.nextWork?.actor !== 'manager' ||
        cardCase?.lifecycle?.nextWork?.actionCode !== 'approve_or_deny_request' ||
        cardCase?.lifecycle?.nextWork?.preparationProofId !== cardProof.proofId ||
        JSON.stringify(cardCase.lifecycle.nextWork.eligibleCandidateTokens) !==
          JSON.stringify(cardProof.eligibleCandidateTokens) ||
        cardCase?.nayaxLookupCandidates?.length !== 2 ||
        JSON.stringify(cardCase.nayaxLookupCandidates
          .map((candidate) => candidate.candidateToken).sort()) !==
          JSON.stringify([...cardProof.eligibleCandidateTokens].sort())) {
      throw new Error('Authenticated Manager overview does not expose the current reviewed set.');
    }
    await client.query('set local role authenticated');
    await client.query(`select set_config('request.jwt.claims',$1,true)`, [
      JSON.stringify({ sub: managerId, role: 'authenticated' }),
    ]);
    const cardDecisionResult = await client.query(`
      select public.admin_approve_reviewed_nayax_candidate_v1(
        $1,$2,$3::uuid,$4::uuid) as result
    `, [reviewedCardCaseId, cardCase.officialActionVersion,
      cardProof.proofId, cardProof.eligibleCandidateTokens[1]]);
    await client.query('reset role');
    const cardFinalDecision = cardDecisionResult.rows[0]?.result;
    const cardAttemptResult = await client.query(`
      select count(*)::integer as count,
        bool_and(status='created' and provider_outcome is null) as provider_free
      from public.refund_case_nayax_refund_attempts where refund_case_id=$1
    `, [reviewedCardCaseId]);
    if (cardFinalDecision?.approved !== true ||
        cardFinalDecision?.providerCallMade !== false ||
        cardFinalDecision?.customerMessageCreated !== false ||
        cardFinalDecision?.selectedCandidateToken !== cardProof.eligibleCandidateTokens[1] ||
        !cardFinalDecision?.attemptId || cardAttemptResult.rows[0]?.count !== 1 ||
        cardAttemptResult.rows[0]?.provider_free !== true) {
      throw new Error('Synthetic reviewed card final decision did not create one protected attempt.');
    }

    const seed = {
      schemaVersion: 'refund_real_preparation_browser_seed_v1',
      source: 'disposable_db_completed_worker_and_authenticated_manager_rpc',
      caseId, publicReference: 'RF-UAT-REAL-PREP',
      managerId, officialActionVersion, deterministicFactVersion,
      caseRecord, preparationProof: proof, lifecycle,
      reviewedCard: {
        caseId: reviewedCardCaseId,
        publicReference: 'RF-UAT-REAL-REVIEWED',
        preparationProof: cardProof,
        caseRecord: cardCase,
        finalDecisionResult: cardFinalDecision,
      },
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
