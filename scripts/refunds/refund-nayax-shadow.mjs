#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  buildNayaxRecommendation,
  extractNayaxRecords,
} from '../../supabase/functions/_shared/nayax-recommendation.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const DEFAULT_ENV_FILES = ['.env', '.env.local'];
const DEFAULT_NAYAX_BASE_URL = 'https://lynx.nayax.com/operational/v1';
const DEFAULT_NAYAX_ACCOUNT_KEY = 'TGPACI_USA_DB';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function text(value, maxLength = 200) {
  return value === null || value === undefined
    ? ''
    : String(value).trim().slice(0, maxLength);
}

export function parseEnvFile(contents) {
  const env = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

export function parseArgs(argv) {
  const args = {
    envFiles: [...DEFAULT_ENV_FILES],
    projectRef: '',
    caseId: '',
    windowHours: 6,
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
    } else if (value === '--case-id' && next) {
      args.caseId = next.trim();
      index += 1;
    } else if (value === '--window-hours' && next) {
      args.windowHours = Number(next);
      index += 1;
    } else if (value === '--output-file' && next) {
      args.outputFile = next.trim();
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${value}`);
    }
  }

  if (args.caseId && !UUID_PATTERN.test(args.caseId)) {
    throw new Error('--case-id must be a valid UUID.');
  }
  if (!Number.isInteger(args.windowHours) || args.windowHours < 1 || args.windowHours > 24) {
    throw new Error('--window-hours must be an integer from 1 to 24.');
  }
  return args;
}

function resolvePath(relativeOrAbsolutePath) {
  return path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.resolve(repoRoot, relativeOrAbsolutePath);
}

export function loadEnv(envFiles) {
  const env = {};
  for (const envFile of envFiles) {
    const absolutePath = resolvePath(envFile);
    if (!fs.existsSync(absolutePath)) continue;
    Object.assign(env, parseEnvFile(fs.readFileSync(absolutePath, 'utf8')));
  }
  return { ...env, ...process.env };
}

export function getSupabaseProjectRef(value) {
  try {
    const hostname = new URL(value).hostname;
    return hostname.match(/^([a-z0-9]+)\.supabase\.co$/i)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function ensureSafeReadConfiguration(env, expectedProjectRef) {
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && key.toUpperCase().includes('SERVICE_ROLE')) {
      throw new Error(`Refusing to run because ${key} looks client-exposed.`);
    }
  }

  const supabaseUrl = text(env.VITE_SUPABASE_URL || env.SUPABASE_URL, 400);
  const serviceRoleKey = text(env.SUPABASE_SERVICE_ROLE_KEY, 5000);
  const projectRef = getSupabaseProjectRef(supabaseUrl);
  if (!expectedProjectRef) throw new Error('--project-ref is required.');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL and service-role read credentials are required.');
  }
  if (projectRef !== expectedProjectRef) {
    throw new Error('The configured Supabase project does not match --project-ref.');
  }

  return { supabaseUrl, serviceRoleKey, projectRef };
}

function normalizeAccountKey(value) {
  return (
    text(value || DEFAULT_NAYAX_ACCOUNT_KEY, 80)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_') || DEFAULT_NAYAX_ACCOUNT_KEY
  );
}

function resolveNayaxToken(env, accountKey) {
  return text(
    env[`NAYAX_LYNX_API_TOKEN_${normalizeAccountKey(accountKey)}`] ||
      env.NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB ||
      env.NAYAX_LYNX_API_TOKEN,
    5000,
  );
}

function assertRead(result, label) {
  if (result.error) {
    const code = text(result.error.code || result.error.status || 'unknown', 40)
      .replace(/[^A-Za-z0-9_-]/g, '');
    throw new Error(`${label} failed (${code || 'unknown'}).`);
  }
  return result.data;
}

function providerTimeMs(record) {
  const value =
    record?.MachineAuthorizationTime ??
    record?.AuthorizationDateTimeGMT ??
    record?.AuthorizationDateTime;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function providerAmountCents(record) {
  const value = Number(record?.AuthorizationValue ?? record?.SettlementValue);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

function last4(value) {
  return text(value, 80).replace(/\D/g, '').slice(-4);
}

export function buildTimingDiagnostics({ providerRecords, refundCase, nowMs = Date.now() }) {
  const caseTimeMs = new Date(refundCase.incident_at).getTime();
  if (!Number.isFinite(caseTimeMs)) throw new Error('The refund case incident time is invalid.');

  const caseLast4 = last4(refundCase.card_last4);
  const caseAmountCents = Number(refundCase.payment_amount_cents);
  const timedRecords = providerRecords
    .map((record) => ({ record, timeMs: providerTimeMs(record) }))
    .filter(({ timeMs }) => timeMs !== null);
  const exactAmountRecords = timedRecords.filter(
    ({ record }) => providerAmountCents(record) === caseAmountCents,
  );
  const exactLast4Records = timedRecords.filter(
    ({ record }) => Boolean(caseLast4) && last4(record?.CardNumber) === caseLast4,
  );
  const exactAmountAndLast4Records = timedRecords.filter(
    ({ record }) =>
      providerAmountCents(record) === caseAmountCents &&
      Boolean(caseLast4) &&
      last4(record?.CardNumber) === caseLast4,
  );
  const nearestDeltaHours = (rows) =>
    rows.length === 0
      ? null
      : Number(
          (
            Math.min(...rows.map(({ timeMs }) => Math.abs(timeMs - caseTimeMs))) /
            3_600_000
          ).toFixed(2),
        );
  const providerTimes = timedRecords.map(({ timeMs }) => timeMs);

  return {
    caseAgeDays: Number(((nowMs - caseTimeMs) / 86_400_000).toFixed(1)),
    providerNewestAgeDays:
      providerTimes.length > 0
        ? Number(((nowMs - Math.max(...providerTimes)) / 86_400_000).toFixed(1))
        : null,
    providerOldestAgeDays:
      providerTimes.length > 0
        ? Number(((nowMs - Math.min(...providerTimes)) / 86_400_000).toFixed(1))
        : null,
    exactAmountRecordCount: exactAmountRecords.length,
    exactLast4RecordCount: exactLast4Records.length,
    exactAmountAndLast4RecordCount: exactAmountAndLast4Records.length,
    nearestExactAmountDeltaHours: nearestDeltaHours(exactAmountRecords),
    nearestExactLast4DeltaHours: nearestDeltaHours(exactLast4Records),
    nearestExactAmountAndLast4DeltaHours: nearestDeltaHours(exactAmountAndLast4Records),
  };
}

export function buildTransactionStates(rows, currentCaseId) {
  const states = {};
  for (const row of rows) {
    const transactionId = text(row.matched_nayax_transaction_id, 80);
    if (!transactionId) continue;
    if (
      row.status === 'completed' ||
      row.reporting_adjustment_id ||
      row.nayax_refund_execution_status === 'succeeded'
    ) {
      states[transactionId] = 'already_refunded';
    } else if (row.id !== currentCaseId && states[transactionId] !== 'already_refunded') {
      states[transactionId] = 'duplicate';
    }
  }
  return states;
}

export function buildShadowEvidence({
  projectRefMatches,
  providerStatus,
  providerRecords,
  recommendation,
  refundCase,
  mappingConsistent,
  nowMs,
}) {
  const top = recommendation.candidates[0] ?? null;
  const providerEvidenceCoverage = {
    siteIdPresentCount: providerRecords.filter((record) =>
      Number.isInteger(Number(record?.SiteID ?? record?.SiteId ?? record?.siteId)),
    ).length,
    machineAuthorizationTimePresentCount: providerRecords.filter((record) =>
      Boolean(text(record?.MachineAuthorizationTime ?? record?.AuthorizationDateTimeGMT, 120)),
    ).length,
    explicitPaymentStatusPresentCount: providerRecords.filter((record) =>
      Boolean(text(record?.PaymentStatus ?? record?.TransactionStatus ?? record?.Status, 80)),
    ).length,
    explicitRefundStatePresentCount: providerRecords.filter((record) =>
      record?.IsRefunded === true ||
      record?.isRefunded === true ||
      record?.Refunded === true ||
      Boolean(text(record?.RefundStatus ?? record?.refundStatus, 80)),
    ).length,
  };
  return {
    evidenceType: 'production_read_only_nayax_shadow',
    projectRefMatchesExpectedProduction: projectRefMatches,
    productionCasesAudited: 1,
    mappingConsistent,
    providerHttpStatus: providerStatus,
    providerRecordCount: providerRecords.length,
    providerEvidenceCoverage,
    providerParseableRecordCount: recommendation.providerParseableRecordCount,
    providerWindowRecordCount: recommendation.providerWindowRecordCount,
    candidateCount: recommendation.candidateCount,
    recommendationState: recommendation.recommendationState,
    oneClickEligible: recommendation.oneClickEligible,
    policyVersion: recommendation.policyVersion,
    topCandidate: top
      ? {
          recommendationRank: top.recommendationRank,
          isRecommended: top.isRecommended,
          selectionAllowed: top.selectionAllowed,
          oneClickEligible: top.oneClickEligible,
          matchStrength: top.matchStrength,
          matchFactors: top.matchFactors.map(({ key, outcome }) => ({ key, outcome })),
          manualReviewReasons: top.manualReviewReasons,
          hardExclusions: top.hardExclusions,
        }
      : null,
    timingDiagnostics: buildTimingDiagnostics({ providerRecords, refundCase, nowMs }),
    rawIdentifiersEmitted: false,
    customerDataEmitted: false,
    providerWriteAttempted: false,
    productionDataWritten: false,
  };
}

async function run(args) {
  const env = loadEnv(args.envFiles);
  const config = ensureSafeReadConfiguration(env, args.projectRef);
  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let caseQuery = supabase
    .from('refund_cases')
    .select(
      'id,status,incident_at,incident_time_resolution,payment_amount_cents,card_last4,card_wallet_used,reporting_machine_id,reporting_location_id',
    )
    .eq('payment_method', 'card');
  if (args.caseId) caseQuery = caseQuery.eq('id', args.caseId);
  const cases = assertRead(await caseQuery, 'Card case read').filter(
    (row) => !['completed', 'denied', 'closed'].includes(text(row.status, 40)),
  );
  if (cases.length !== 1) {
    throw new Error(
      `Expected exactly one open production card case; found ${cases.length}. Use --case-id privately when more than one exists.`,
    );
  }
  const refundCase = cases[0];

  const machine = assertRead(
    await supabase
      .from('reporting_machines')
      .select('id,location_id,nayax_machine_id,nayax_account_key,status')
      .eq('id', refundCase.reporting_machine_id)
      .maybeSingle(),
    'Machine mapping read',
  );
  const location = assertRead(
    await supabase
      .from('reporting_locations')
      .select('id,timezone')
      .eq('id', refundCase.reporting_location_id)
      .maybeSingle(),
    'Location mapping read',
  );
  const mappingConsistent = Boolean(
    machine &&
      location &&
      machine.status === 'active' &&
      machine.location_id === refundCase.reporting_location_id &&
      location.id === refundCase.reporting_location_id &&
      text(machine.nayax_machine_id, 120) &&
      text(location.timezone, 80),
  );
  if (!mappingConsistent) {
    throw new Error('The production case machine/location mapping is not shadow-ready.');
  }

  const token = resolveNayaxToken(env, machine.nayax_account_key);
  if (!token) throw new Error('The server-only Nayax read token is missing.');
  const baseUrl = text(env.NAYAX_LYNX_BASE_URL || DEFAULT_NAYAX_BASE_URL, 400).replace(
    /\/+$/,
    '',
  );
  const providerResponse = await fetch(
    `${baseUrl}/machines/${encodeURIComponent(text(machine.nayax_machine_id, 120))}/lastSales`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    },
  );
  if (!providerResponse.ok) {
    throw new Error(`Nayax read-only lookup returned HTTP ${providerResponse.status}.`);
  }
  const payload = await providerResponse.json();
  const recommendationInput = {
    payload,
    incidentAt: new Date(refundCase.incident_at).toISOString(),
    incidentTimeResolution: text(refundCase.incident_time_resolution, 40) || 'legacy_absolute',
    expectedMachineId: text(machine.nayax_machine_id, 120),
    locationTimezone: text(location.timezone, 80),
    requestAmountCents: Number(refundCase.payment_amount_cents),
    requestCardLast4: text(refundCase.card_last4, 20),
    cardWalletUsed: Boolean(refundCase.card_wallet_used),
    windowHours: args.windowHours,
  };
  const preliminary = buildNayaxRecommendation(recommendationInput);
  const transactionIds = preliminary.candidates.map((candidate) => candidate.transactionId);
  let linkedCases = [];
  if (transactionIds.length > 0) {
    linkedCases = assertRead(
      await supabase
        .from('refund_cases')
        .select(
          'id,status,matched_nayax_transaction_id,reporting_adjustment_id,nayax_refund_execution_status',
        )
        .in('matched_nayax_transaction_id', transactionIds),
      'Duplicate/refund-state read',
    );
  }
  const recommendation = buildNayaxRecommendation({
    ...recommendationInput,
    transactionStates: buildTransactionStates(linkedCases, refundCase.id),
  });
  const providerRecords = extractNayaxRecords(payload);
  const evidence = buildShadowEvidence({
    projectRefMatches: config.projectRef === args.projectRef,
    providerStatus: providerResponse.status,
    providerRecords,
    recommendation,
    refundCase,
    mappingConsistent,
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
  console.log(`Read-only production Nayax matcher shadow

Required:
  --project-ref <expected Supabase project ref>
  --env-file <server-only env file>

Optional:
  --case-id <private refund case UUID>  Required when more than one open card case exists.
  --window-hours <1-24>                Default: 6.
  --output-file <path>                 Writes sanitized aggregate evidence only.

This command performs Supabase reads and one Nayax Last Sales GET. It never writes
production data, calls a refund endpoint, prints raw provider identifiers, or emits
customer/card details.`);
}

if (path.resolve(process.argv[1] || '') === __filename) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
  } else {
    await run(args);
  }
}
