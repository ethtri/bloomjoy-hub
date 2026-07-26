#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  ensureSafeReadConfiguration,
  loadEnv,
  qrToReportedTimeBucket,
  text,
} from './refund-nayax-shadow.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PILOT_DAYS = 31;
const PAGE_SIZE = 500;
const MAX_ROWS_PER_TABLE = 5_000;
const PILOT_POLICY_VERSION = '2026-07-26.v2';
const RECOMMENDATION_STATES = [
  'high_confidence',
  'ambiguous',
  'manual_exception',
  'no_safe_match',
  'not_evaluated',
];
const CONFIDENCE_CLASSES = ['strong_card', 'unique_qr_time', 'ambiguous_manual', 'unknown'];
const DISAGREEMENT_REASONS = [
  'closer_time',
  'correct_amount',
  'correct_card',
  'customer_confirmation',
  'provider_data_issue',
  'other_review_reason',
  'unknown',
];

const resolvePath = (value) => path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
const emptyCounts = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const safeCode = (value, fallback = 'unknown') => {
  const normalized = text(value, 80).toLowerCase();
  return /^[a-z0-9_]+$/.test(normalized) ? normalized : fallback;
};
const safeVersion = (value) => {
  const normalized = text(value, 80).toLowerCase();
  return /^[a-z0-9_.-]+$/.test(normalized) ? normalized : '';
};
const increment = (counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
};
const parseTimestamp = (value, label) => {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
};

export function parsePilotArgs(argv) {
  const args = {
    envFiles: ['.env', '.env.local'],
    projectRef: '',
    cohortFile: '',
    observationsFile: '',
    start: '',
    end: '',
    outputFile: '',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--help' || value === '-h') {
      args.help = true;
    } else if (value === '--env-file' && next) {
      args.envFiles.push(next);
      index += 1;
    } else if (value === '--project-ref' && next) {
      args.projectRef = next.trim();
      index += 1;
    } else if (value === '--cohort-file' && next) {
      args.cohortFile = next.trim();
      index += 1;
    } else if (value === '--observations-file' && next) {
      args.observationsFile = next.trim();
      index += 1;
    } else if (value === '--start' && next) {
      args.start = next.trim();
      index += 1;
    } else if (value === '--end' && next) {
      args.end = next.trim();
      index += 1;
    } else if (value === '--output-file' && next) {
      args.outputFile = next.trim();
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }

  if (!args.help && (!args.projectRef || !args.cohortFile || !args.observationsFile || !args.start || !args.end)) {
    throw new Error(
      '--project-ref, --cohort-file, --observations-file, --start, and --end are required.',
    );
  }
  if (!args.help) {
    const start = parseTimestamp(args.start, '--start');
    const end = parseTimestamp(args.end, '--end');
    const durationDays = (end.getTime() - start.getTime()) / 86_400_000;
    if (durationDays <= 0 || durationDays > MAX_PILOT_DAYS) {
      throw new Error(`Pilot window must be greater than zero and no longer than ${MAX_PILOT_DAYS} days.`);
    }
    args.start = start.toISOString();
    args.end = end.toISOString();
  }
  return args;
}

function readJsonFile(filePath, label) {
  const absolutePath = resolvePath(filePath);
  if (!fs.existsSync(absolutePath)) throw new Error(`${label} was not found.`);
  try {
    return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
  } catch {
    throw new Error(`${label} must contain valid JSON.`);
  }
}

export function validateCohort(input) {
  const machineIds = Array.isArray(input?.machineIds) ? input.machineIds.map((value) => text(value, 80)) : [];
  if (input?.schemaVersion !== '2026-07-26.v1') {
    throw new Error('Cohort file schemaVersion must be 2026-07-26.v1.');
  }
  if (input?.sponsorApprovedPilotCohort !== true) {
    throw new Error('Cohort file must record sponsorApprovedPilotCohort=true.');
  }
  if (machineIds.length !== 6 || new Set(machineIds).size !== 6 || machineIds.some((id) => !UUID_PATTERN.test(id))) {
    throw new Error('Cohort file must contain exactly six unique machine UUIDs.');
  }
  return { machineIds };
}

const nonNegativeInteger = (value, label) => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
};

export function validateObservations(input) {
  if (input?.schemaVersion !== '2026-07-26.v1') {
    throw new Error('Observations file schemaVersion must be 2026-07-26.v1.');
  }
  const physical = input?.physicalMachineChecks ?? {};
  const fixtures = input?.controlledFixtures ?? {};
  const operations = input?.operations ?? {};
  const rollback = input?.rollback ?? {};
  const result = {
    physicalMachineChecks: {
      expected: nonNegativeInteger(physical.expected, 'physicalMachineChecks.expected'),
      passed: nonNegativeInteger(physical.passed, 'physicalMachineChecks.passed'),
      failed: nonNegativeInteger(physical.failed, 'physicalMachineChecks.failed'),
    },
    controlledFixtures: {
      expected: nonNegativeInteger(fixtures.expected, 'controlledFixtures.expected'),
      passed: nonNegativeInteger(fixtures.passed, 'controlledFixtures.passed'),
      failed: nonNegativeInteger(fixtures.failed, 'controlledFixtures.failed'),
      knownFalsePositiveHighConfidence: nonNegativeInteger(
        fixtures.knownFalsePositiveHighConfidence,
        'controlledFixtures.knownFalsePositiveHighConfidence',
      ),
    },
    operations: {
      managerFrictionCount: nonNegativeInteger(
        operations.managerFrictionCount,
        'operations.managerFrictionCount',
      ),
      customerFrictionCount: nonNegativeInteger(
        operations.customerFrictionCount,
        'operations.customerFrictionCount',
      ),
      qrDamageOrReplacementCount: nonNegativeInteger(
        operations.qrDamageOrReplacementCount,
        'operations.qrDamageOrReplacementCount',
      ),
      fallbackRequiredCount: nonNegativeInteger(
        operations.fallbackRequiredCount,
        'operations.fallbackRequiredCount',
      ),
    },
    rollback: {
      qrIdentifiersDisabled: rollback.qrIdentifiersDisabled === true,
      recommendationsDisabled: rollback.recommendationsDisabled === true,
      directIntakeOperational: rollback.directIntakeOperational === true,
      managerQueueOperational: rollback.managerQueueOperational === true,
    },
    stopConditionTriggered: input?.stopConditionTriggered === true,
  };
  if (
    result.physicalMachineChecks.expected !== 6 ||
    result.physicalMachineChecks.passed + result.physicalMachineChecks.failed !== 6
  ) {
    throw new Error('Physical observations must account for all six pilot machines.');
  }
  if (
    result.controlledFixtures.expected < 9 ||
    result.controlledFixtures.passed + result.controlledFixtures.failed !==
      result.controlledFixtures.expected
  ) {
    throw new Error('Controlled observations must account for at least nine required fixtures.');
  }
  return result;
}

function latestEventByCase(events, eventType) {
  const result = new Map();
  for (const event of events) {
    if (event.event_type !== eventType) continue;
    const current = result.get(event.refund_case_id);
    if (!current || String(event.created_at).localeCompare(String(current.created_at)) > 0) {
      result.set(event.refund_case_id, event);
    }
  }
  return result;
}

function qrEvidenceFor(refundCase, claimsById) {
  if (!refundCase.refund_qr_claim_context_id) return { status: 'missing', openedAt: null };
  const claim = claimsById.get(refundCase.refund_qr_claim_context_id);
  const openedAtValue = text(claim?.opened_at, 120);
  const consumedAtValue = text(claim?.consumed_at, 120);
  const openedAt = new Date(openedAtValue);
  const consumedAt = new Date(consumedAtValue);
  if (
    !claim ||
    claim.reporting_machine_id !== refundCase.reporting_machine_id ||
    !openedAtValue ||
    !consumedAtValue ||
    Number.isNaN(openedAt.getTime()) ||
    Number.isNaN(consumedAt.getTime()) ||
    consumedAt.getTime() < openedAt.getTime()
  ) {
    return { status: 'invalid', openedAt: null };
  }
  return { status: 'verified', openedAt: openedAt.toISOString() };
}

export function aggregatePilotEvidence({
  cases,
  qrClaims,
  events,
  observations,
  projectRefMatches,
  pilotWindow,
}) {
  const claimsById = new Map(qrClaims.map((claim) => [claim.id, claim]));
  const evaluations = latestEventByCase(events, 'nayax_recommendation_evaluated');
  const selections = latestEventByCase(events, 'nayax_match_selected');
  const lookupFailures = new Set(
    events.filter((event) => event.event_type === 'nayax_lookup_failed').map((event) => event.refund_case_id),
  );
  const setupNeeded = new Set(
    events.filter((event) => event.event_type === 'nayax_lookup_setup_needed').map((event) => event.refund_case_id),
  );
  const recommendationStates = emptyCounts(RECOMMENDATION_STATES);
  const highConfidenceByClass = emptyCounts(CONFIDENCE_CLASSES);
  const highConfidenceReasonCodes = {};
  const qrClaimEvidence = emptyCounts(['verified', 'missing', 'invalid']);
  const qrToReportedTimeDistribution = emptyCounts([
    'qr_before_reported_time',
    '0_to_5_minutes_after',
    '6_to_15_minutes_after',
    '16_to_30_minutes_after',
    '31_to_60_minutes_after',
    'over_60_minutes_after',
    'unavailable',
  ]);
  const paymentMethodSplit = { card: 0, walletCard: 0, nonWalletCard: 0, cash: 0 };
  const policyVersions = {};

  for (const refundCase of cases) {
    if (refundCase.payment_method === 'cash') {
      paymentMethodSplit.cash += 1;
    } else {
      paymentMethodSplit.card += 1;
      if (refundCase.card_wallet_used) paymentMethodSplit.walletCard += 1;
      else paymentMethodSplit.nonWalletCard += 1;
    }

    const qrEvidence = qrEvidenceFor(refundCase, claimsById);
    increment(qrClaimEvidence, qrEvidence.status);
    increment(
      qrToReportedTimeDistribution,
      qrToReportedTimeBucket(refundCase.incident_at, qrEvidence.openedAt),
    );

    const evaluation = evaluations.get(refundCase.id);
    const metadata = evaluation?.metadata ?? {};
    const state = RECOMMENDATION_STATES.includes(metadata.recommendation_state)
      ? metadata.recommendation_state
      : RECOMMENDATION_STATES.includes(refundCase.nayax_recommendation_state)
        ? refundCase.nayax_recommendation_state
        : 'not_evaluated';
    increment(recommendationStates, state);

    const policyVersion =
      safeVersion(metadata.policy_version) ||
      safeVersion(refundCase.nayax_recommendation_policy_version) ||
      'not_evaluated';
    increment(policyVersions, policyVersion);

    if (state === 'high_confidence') {
      const confidenceClass = CONFIDENCE_CLASSES.includes(metadata.confidence_class)
        ? metadata.confidence_class
        : 'unknown';
      increment(highConfidenceByClass, confidenceClass);
      const reasons = Array.isArray(metadata.reason_codes) ? metadata.reason_codes : [];
      for (const reason of reasons) increment(highConfidenceReasonCodes, safeCode(reason));
    }
  }

  const managerSelections = {
    total: selections.size,
    acceptedRecommended: 0,
    alternateSelected: 0,
    disagreementReasons: emptyCounts(DISAGREEMENT_REASONS),
  };
  for (const selection of selections.values()) {
    const metadata = selection.metadata ?? {};
    if (metadata.selected_recommended === true) {
      managerSelections.acceptedRecommended += 1;
    } else {
      managerSelections.alternateSelected += 1;
      const reason = DISAGREEMENT_REASONS.includes(metadata.disagreement_reason_code)
        ? metadata.disagreement_reason_code
        : 'unknown';
      increment(managerSelections.disagreementReasons, reason);
    }
  }

  const rollbackProven = Object.values(observations.rollback).every(Boolean);
  const controlledSetPass =
    observations.controlledFixtures.failed === 0 &&
    observations.controlledFixtures.knownFalsePositiveHighConfidence === 0;
  const physicalChecksPass =
    observations.physicalMachineChecks.passed === 6 &&
    observations.physicalMachineChecks.failed === 0;
  const stopConditionTriggered =
    observations.stopConditionTriggered ||
    observations.controlledFixtures.knownFalsePositiveHighConfidence > 0;
  const hasObservedCases = cases.length > 0;
  const policyVersionCurrent =
    Object.keys(policyVersions).every(
      (version) => version === PILOT_POLICY_VERSION || version === 'not_evaluated',
    ) && (policyVersions[PILOT_POLICY_VERSION] ?? 0) > 0;

  return {
    evidenceType: 'six_machine_qr_refund_shadow_pilot',
    evidenceSchemaVersion: '2026-07-26.v1',
    expectedPolicyVersion: PILOT_POLICY_VERSION,
    projectRefMatchesExpectedProduction: projectRefMatches,
    pilotWindow,
    approvedMachineCount: 6,
    totalCases: cases.length,
    paymentMethodSplit,
    qrClaimEvidence,
    qrToReportedTimeDistribution,
    recommendationStates,
    highConfidenceByClass,
    highConfidenceReasonCodes,
    managerSelections,
    lookupFailureCaseCount: lookupFailures.size,
    lookupSetupNeededCaseCount: setupNeeded.size,
    policyVersions,
    operatorRecordedObservations: observations,
    gates: {
      physicalChecksPass,
      controlledSetPass,
      rollbackProven,
      stopConditionTriggered,
      hasObservedCases,
      policyVersionCurrent,
      sponsorDecisionStillRequired: true,
      evidenceReadyForSponsorReview:
        projectRefMatches &&
        physicalChecksPass &&
        controlledSetPass &&
        rollbackProven &&
        hasObservedCases &&
        policyVersionCurrent &&
        !stopConditionTriggered,
    },
    rawIdentifiersEmitted: false,
    customerDataEmitted: false,
    providerWriteAttempted: false,
    productionDataWritten: false,
  };
}

async function readPaged(queryFactory, label) {
  const rows = [];
  for (let offset = 0; offset < MAX_ROWS_PER_TABLE; offset += PAGE_SIZE) {
    const result = await queryFactory(offset, offset + PAGE_SIZE - 1);
    if (result.error) {
      const code = safeCode(result.error.code || result.error.status);
      throw new Error(`${label} failed (${code}).`);
    }
    rows.push(...(result.data ?? []));
    if ((result.data ?? []).length < PAGE_SIZE) return rows;
  }
  throw new Error(`${label} exceeded the ${MAX_ROWS_PER_TABLE}-row pilot safety limit.`);
}

const chunks = (values, size = 100) => {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

async function run(args) {
  const cohort = validateCohort(readJsonFile(args.cohortFile, 'Cohort file'));
  const observations = validateObservations(readJsonFile(args.observationsFile, 'Observations file'));
  const config = ensureSafeReadConfiguration(loadEnv(args.envFiles), args.projectRef);
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const cases = await readPaged(
    (from, to) =>
      supabase
        .from('refund_cases')
        .select(
          'id,reporting_machine_id,refund_qr_claim_context_id,incident_at,payment_method,card_wallet_used,nayax_recommendation_state,nayax_recommendation_policy_version,created_at',
        )
        .in('reporting_machine_id', cohort.machineIds)
        .gte('created_at', args.start)
        .lt('created_at', args.end)
        .order('created_at', { ascending: true })
        .range(from, to),
    'Pilot case read',
  );

  const qrClaims = [];
  const claimIds = [...new Set(cases.map((item) => item.refund_qr_claim_context_id).filter(Boolean))];
  for (const claimIdChunk of chunks(claimIds)) {
    const result = await supabase
      .from('refund_qr_claim_contexts')
      .select('id,reporting_machine_id,opened_at,consumed_at')
      .in('id', claimIdChunk);
    if (result.error) throw new Error(`QR claim read failed (${safeCode(result.error.code)}).`);
    qrClaims.push(...(result.data ?? []));
  }

  const events = [];
  for (const caseIdChunk of chunks(cases.map((item) => item.id))) {
    events.push(
      ...(await readPaged(
        (from, to) =>
          supabase
            .from('refund_case_events')
            .select('refund_case_id,event_type,metadata,created_at')
            .in('refund_case_id', caseIdChunk)
            .in('event_type', [
              'nayax_recommendation_evaluated',
              'nayax_match_selected',
              'nayax_lookup_failed',
              'nayax_lookup_setup_needed',
            ])
            .gte('created_at', args.start)
            .lt('created_at', args.end)
            .order('created_at', { ascending: true })
            .range(from, to),
        'Pilot event read',
      )),
    );
  }

  const evidence = aggregatePilotEvidence({
    cases,
    qrClaims,
    events,
    observations,
    projectRefMatches: config.projectRef === args.projectRef,
    pilotWindow: { start: args.start, end: args.end },
  });
  const output = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args.outputFile) {
    const outputFile = resolvePath(args.outputFile);
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, output, 'utf8');
  }
  process.stdout.write(output);
}

function printHelp() {
  console.log(`Build sanitized evidence for the six-machine QR refund shadow pilot

Required:
  --project-ref <expected Supabase project ref>
  --env-file <server-only env file>
  --cohort-file <private local JSON file>
  --observations-file <sanitized local JSON file>
  --start <ISO timestamp>
  --end <ISO timestamp, no more than 31 days after start>

Optional:
  --output-file <path>

The cohort file must use schemaVersion 2026-07-26.v1, record
sponsorApprovedPilotCohort=true, and contain exactly six private machine UUIDs.
Do not commit that file. The observations file contains aggregate counts only;
use Docs/REFUND_QR_SHADOW_PILOT_PACKET.md as its template.

This command performs bounded Supabase SELECTs only. It never calls Nayax,
writes production data, refunds a payment, or emits machine, case, transaction,
customer, or card identifiers.`);
}

if (path.resolve(process.argv[1] || '') === __filename) {
  const args = parsePilotArgs(process.argv.slice(2));
  if (args.help) printHelp();
  else await run(args);
}
