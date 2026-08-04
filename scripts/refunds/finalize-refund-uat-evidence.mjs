#!/usr/bin/env node

import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_MACHINE_READABLE_ARTIFACTS,
  validateMachineReadableEvidence,
} from './refund-uat-evidence.mjs';

const __filename = fileURLToPath(import.meta.url);
const MAX_FRAGMENT_BYTES = 16 * 1024;

export const EXPECTED_FRAGMENT_ARTIFACTS = [
  'refund-portal-assertions.json',
  'refund-database-counts.json',
  'refund-gmail-mime-roles.json',
  'refund-gmail-kill-fragment.json',
  'refund-manager-aging-kill-fragment.json',
  'refund-provider-outcomes.json',
];

const isPlainObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const assertExactKeys = (value, expectedKeys, label) => {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} contains unsupported or missing fields.`);
  }
};

const assertLiteral = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label} is invalid.`);
};

const assertSanitized = (name, payload) => {
  const serialized = JSON.stringify(payload);
  if (
    serialized.includes('@') ||
    /\b(?:https?:\/\/|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\b/i.test(serialized) ||
    /\b\d{12,19}\b/.test(serialized)
  ) {
    throw new Error(`${name} contains identity, provider, or payment-like data.`);
  }
};

export function validateGmailKillFragment(payload) {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'executableCoverage',
    'switches',
    'requiresIntegrationAggregation',
    'passed',
  ], 'Gmail kill-switch fragment');
  assertLiteral(payload.schemaVersion, 2, 'Gmail kill-switch fragment schemaVersion');
  assertLiteral(
    payload.evidenceType,
    'gmail_kill_switch_fragment',
    'Gmail kill-switch fragment evidenceType'
  );
  assertLiteral(
    payload.evidenceMode,
    'synthetic_executable_transport',
    'Gmail kill-switch fragment evidenceMode'
  );
  assertLiteral(payload.passed, true, 'Gmail kill-switch fragment passed flag');
  assertLiteral(
    payload.requiresIntegrationAggregation,
    true,
    'Gmail kill-switch integration requirement'
  );
  assertExactKeys(payload.executableCoverage, [
    'gmailOutbound',
    'customerContact',
    'managerAging',
    'intakeAvailability',
    'portalAvailability',
  ], 'Gmail kill-switch executable coverage');
  assertLiteral(payload.executableCoverage.gmailOutbound, true, 'Gmail outbound executable coverage');
  assertLiteral(payload.executableCoverage.customerContact, true, 'Customer-contact executable coverage');
  assertLiteral(payload.executableCoverage.managerAging, false, 'Manager-aging fragment coverage');
  assertLiteral(payload.executableCoverage.intakeAvailability, false, 'Intake fragment coverage');
  assertLiteral(payload.executableCoverage.portalAvailability, false, 'Portal fragment coverage');
  assertExactKeys(payload.switches, ['gmailOutbound', 'customerContact'], 'Gmail kill-switch groups');
  assertExactKeys(payload.switches.gmailOutbound, [
    'disabled',
    'deliveryClaimCount',
    'firstContactClaimCount',
    'providerFetchCount',
    'providerSendCount',
  ], 'Gmail outbound kill switch');
  assertLiteral(payload.switches.gmailOutbound.disabled, true, 'Gmail outbound disabled flag');
  assertLiteral(payload.switches.gmailOutbound.deliveryClaimCount, 0, 'Gmail delivery-claim count');
  assertLiteral(payload.switches.gmailOutbound.firstContactClaimCount, 0, 'Gmail first-contact claim count');
  assertLiteral(payload.switches.gmailOutbound.providerFetchCount, 0, 'Gmail provider-fetch count');
  assertLiteral(payload.switches.gmailOutbound.providerSendCount, 0, 'Gmail provider-send count');
  assertExactKeys(payload.switches.customerContact, [
    'disabled',
    'deliveryClaimCount',
    'providerFetchCount',
    'providerSendCount',
  ], 'Customer-contact kill switch');
  assertLiteral(payload.switches.customerContact.disabled, true, 'Customer-contact disabled flag');
  assertLiteral(payload.switches.customerContact.deliveryClaimCount, 0, 'Customer-contact delivery-claim count');
  assertLiteral(payload.switches.customerContact.providerFetchCount, 0, 'Customer-contact provider-fetch count');
  assertLiteral(payload.switches.customerContact.providerSendCount, 0, 'Customer-contact provider-send count');
  assertSanitized('refund-gmail-kill-fragment.json', payload);
  return payload;
}

export function validateManagerAgingKillFragment(payload) {
  assertExactKeys(payload, [
    'schemaVersion',
    'evidenceType',
    'evidenceMode',
    'passed',
    'disabled',
    'fetchCallCount',
    'claimCallCount',
    'reservationCallCount',
    'sendCallCount',
  ], 'Manager-aging kill-switch fragment');
  assertLiteral(payload.schemaVersion, 1, 'Manager-aging fragment schemaVersion');
  assertLiteral(
    payload.evidenceType,
    'manager_aging_kill_fragment',
    'Manager-aging fragment evidenceType'
  );
  assertLiteral(
    payload.evidenceMode,
    'synthetic_dependency_injection',
    'Manager-aging fragment evidenceMode'
  );
  assertLiteral(payload.passed, true, 'Manager-aging fragment passed flag');
  assertLiteral(payload.disabled, true, 'Manager-aging disabled flag');
  assertLiteral(payload.fetchCallCount, 0, 'Manager-aging fetch-call count');
  assertLiteral(payload.claimCallCount, 0, 'Manager-aging claim-call count');
  assertLiteral(payload.reservationCallCount, 0, 'Manager-aging reservation-call count');
  assertLiteral(payload.sendCallCount, 0, 'Manager-aging send-call count');
  assertSanitized('refund-manager-aging-kill-fragment.json', payload);
  return payload;
}

export function composeKillSwitchEvidence({ gmail, managerAging, portal }) {
  validateGmailKillFragment(gmail);
  validateManagerAgingKillFragment(managerAging);
  validateMachineReadableEvidence('refund-portal-assertions.json', portal);
  const evidence = {
    schemaVersion: 2,
    evidenceType: 'kill_switches',
    evidenceMode: 'synthetic_executable_integration',
    passed: true,
    executableCoverage: {
      gmailOutbound: gmail.executableCoverage.gmailOutbound,
      customerContact: gmail.executableCoverage.customerContact,
      managerAging: true,
      intakeAvailability: portal.intakeAvailable,
      portalAvailability: portal.portalAvailable,
    },
    switches: {
      gmailOutbound: { ...gmail.switches.gmailOutbound },
      customerContact: { ...gmail.switches.customerContact },
      managerAging: {
        disabled: managerAging.disabled,
        fetchCallCount: managerAging.fetchCallCount,
        claimCallCount: managerAging.claimCallCount,
        reservationCallCount: managerAging.reservationCallCount,
        sendCallCount: managerAging.sendCallCount,
      },
    },
    intakeAvailable: portal.intakeAvailable,
    portalAvailable: portal.portalAvailable,
  };
  validateMachineReadableEvidence('refund-kill-switches.json', evidence);
  return evidence;
}

export function parseFinalizeArgs(argv) {
  const args = { fragmentDir: '', artifactDir: '', freshAfter: '', help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--fragment-dir' && next) {
      args.fragmentDir = next;
      index += 1;
      continue;
    }
    if (arg === '--artifact-dir' && next) {
      args.artifactDir = next;
      index += 1;
      continue;
    }
    if (arg === '--fresh-after' && next) {
      args.freshAfter = next.trim();
      index += 1;
      continue;
    }
    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (!args.help && (!args.fragmentDir || !args.artifactDir || !args.freshAfter)) {
    throw new Error('--fragment-dir, --artifact-dir, and --fresh-after are required.');
  }
  args.fragmentDir = args.fragmentDir ? path.resolve(process.cwd(), args.fragmentDir) : '';
  args.artifactDir = args.artifactDir ? path.resolve(process.cwd(), args.artifactDir) : '';
  if (!args.help && args.fragmentDir === args.artifactDir) {
    throw new Error('Fragment and final artifact directories must be different.');
  }
  return args;
}

const readCanonicalFragment = async (fragmentDir, name, freshAfterMs) => {
  const filePath = path.join(fragmentDir, name);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`${name} must be a regular file.`);
  if (fileStat.mtimeMs < freshAfterMs) {
    throw new Error(`${name} was not freshly generated in this evidence run.`);
  }
  const contents = await readFile(filePath);
  if (contents.length === 0 || contents.length > MAX_FRAGMENT_BYTES) {
    throw new Error(`${name} must be a nonempty bounded JSON fragment.`);
  }
  let payload;
  try {
    payload = JSON.parse(contents.toString('utf8'));
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
  const canonical = `${JSON.stringify(payload, null, 2)}\n`;
  if (contents.toString('utf8') !== canonical) {
    throw new Error(`${name} must use canonical pretty-printed JSON with one trailing newline.`);
  }
  return payload;
};

export async function finalizeRefundUatEvidence({ fragmentDir, artifactDir, freshAfter }) {
  const freshAfterMs = Date.parse(freshAfter);
  if (!Number.isFinite(freshAfterMs)) {
    throw new Error('Evidence freshness boundary must be a valid ISO timestamp.');
  }
  if (path.resolve(fragmentDir) === path.resolve(artifactDir)) {
    throw new Error('Fragment and final artifact directories must be different.');
  }

  const entries = await readdir(fragmentDir, { withFileTypes: true });
  const actualNames = entries.map((entry) => entry.name).sort();
  const expectedNames = [...EXPECTED_FRAGMENT_ARTIFACTS].sort();
  if (
    entries.some((entry) => !entry.isFile()) ||
    JSON.stringify(actualNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error('Fragment directory must contain exactly the six reviewed evidence inputs.');
  }

  const fragments = Object.fromEntries(
    await Promise.all(
      EXPECTED_FRAGMENT_ARTIFACTS.map(async (name) => [
        name,
        await readCanonicalFragment(fragmentDir, name, freshAfterMs),
      ])
    )
  );
  validateMachineReadableEvidence(
    'refund-portal-assertions.json',
    fragments['refund-portal-assertions.json']
  );
  validateMachineReadableEvidence(
    'refund-database-counts.json',
    fragments['refund-database-counts.json']
  );
  validateMachineReadableEvidence(
    'refund-gmail-mime-roles.json',
    fragments['refund-gmail-mime-roles.json']
  );
  validateGmailKillFragment(fragments['refund-gmail-kill-fragment.json']);
  validateManagerAgingKillFragment(fragments['refund-manager-aging-kill-fragment.json']);
  validateMachineReadableEvidence(
    'refund-provider-outcomes.json',
    fragments['refund-provider-outcomes.json']
  );

  const finalArtifacts = {
    'refund-portal-assertions.json': fragments['refund-portal-assertions.json'],
    'refund-database-counts.json': fragments['refund-database-counts.json'],
    'refund-gmail-mime-roles.json': fragments['refund-gmail-mime-roles.json'],
    'refund-kill-switches.json': composeKillSwitchEvidence({
      gmail: fragments['refund-gmail-kill-fragment.json'],
      managerAging: fragments['refund-manager-aging-kill-fragment.json'],
      portal: fragments['refund-portal-assertions.json'],
    }),
    'refund-provider-outcomes.json': fragments['refund-provider-outcomes.json'],
  };

  assertExactKeys(
    finalArtifacts,
    EXPECTED_MACHINE_READABLE_ARTIFACTS,
    'Final machine-readable artifact set'
  );
  for (const [name, payload] of Object.entries(finalArtifacts)) {
    validateMachineReadableEvidence(name, payload);
  }

  await mkdir(artifactDir, { recursive: true });
  for (const name of EXPECTED_MACHINE_READABLE_ARTIFACTS) {
    try {
      await stat(path.join(artifactDir, name));
      throw new Error(`Refusing to overwrite an existing final evidence file: ${name}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  for (const name of EXPECTED_MACHINE_READABLE_ARTIFACTS) {
    await writeFile(
      path.join(artifactDir, name),
      `${JSON.stringify(finalArtifacts[name], null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
  }
  return finalArtifacts;
}

function printHelp() {
  console.log(`Finalize Refund Operations UAT evidence

Usage:
  npm run refunds:finalize-uat-evidence -- --fragment-dir output/refund-uat-fragments --artifact-dir output/refund-uat-evidence --fresh-after <ISO timestamp>`);
}

async function run() {
  const args = parseFinalizeArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const finalArtifacts = await finalizeRefundUatEvidence(args);
  console.log(`Finalized ${Object.keys(finalArtifacts).length} strict Refund UAT JSON artifacts.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
