#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_MACHINE_READABLE_ARTIFACTS,
  EXPECTED_SCREENSHOTS,
  buildEvidence,
  parseArgs,
  validateMachineReadableEvidence,
} from './refund-uat-evidence.mjs';

const PNG_FIXTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sourceCommit = 'a'.repeat(40);
const generatedAt = '2026-07-22T00:00:00.000Z';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'refund-uat-evidence-'));

const machineFixtures = {
  'refund-portal-assertions.json': {
    schemaVersion: 1,
    evidenceType: 'portal_assertions',
    evidenceMode: 'synthetic_browser_mocks',
    passed: true,
    assertionCount: 120,
    failedAssertionCount: 0,
    navigationProviderCallCount: 0,
    navigationOfficialActionCallCount: 0,
  },
  'refund-database-counts.json': {
    schemaVersion: 1,
    evidenceType: 'database_counts',
    evidenceMode: 'disposable_local_database',
    passed: true,
    migrationCount: 126,
    testFileCount: 18,
    assertionCount: 852,
    failedAssertionCount: 0,
  },
  'refund-gmail-mime-roles.json': {
    schemaVersion: 1,
    evidenceType: 'gmail_mime_roles',
    evidenceMode: 'synthetic_unit_tests',
    passed: true,
    roleCounts: {
      customerTo: 1,
      managerCc: 2,
      mailboxTo: 0,
      unrelatedTo: 0,
      unrelatedCc: 0,
    },
    sourceThreadPinned: true,
    duplicateMessageCount: 0,
  },
  'refund-kill-switches.json': {
    schemaVersion: 1,
    evidenceType: 'kill_switches',
    evidenceMode: 'synthetic_fake_transport',
    passed: true,
    switches: {
      gmailOutbound: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
      customerContact: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
      managerAging: {
        disabled: true,
        deliveryClaimCount: 0,
        providerFetchCount: 0,
        providerSendCount: 0,
      },
    },
    intakeAvailable: true,
    portalAvailable: true,
  },
};

const writeCanonicalJson = (filePath, value) =>
  writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');

try {
  assert.equal(EXPECTED_SCREENSHOTS.length, 31, 'Evidence must enumerate all 31 reviewed screenshots');
  assert.deepEqual(
    EXPECTED_MACHINE_READABLE_ARTIFACTS,
    Object.keys(machineFixtures),
    'Evidence must enumerate the four strict machine-readable artifacts in canonical order'
  );

  const parsed = parseArgs([
    '--artifact-dir',
    tempDir,
    '--source-commit',
    sourceCommit,
  ]);
  assert.equal(parsed.artifactDir, path.resolve(tempDir));
  assert.equal(parsed.output, path.join(path.resolve(tempDir), 'refund-uat-evidence.json'));
  assert.equal(parsed.sourceCommit, sourceCommit);
  assert.throws(() => parseArgs(['--unknown']), /Unknown or incomplete argument/);
  await assert.rejects(
    buildEvidence({
      artifactDir: tempDir,
      output: path.join(tempDir, 'invalid.json'),
      sourceCommit: 'person@example.test',
      generatedAt,
    }),
    /Source commit must be a Git SHA/
  );

  for (const name of EXPECTED_SCREENSHOTS) {
    await writeFile(path.join(tempDir, name), PNG_FIXTURE);
  }
  for (const [name, payload] of Object.entries(machineFixtures)) {
    await writeCanonicalJson(path.join(tempDir, name), payload);
  }

  const output = path.join(tempDir, 'manifest.json');
  const manifest = await buildEvidence({
    artifactDir: tempDir,
    output,
    sourceCommit,
    generatedAt,
  });

  assert.deepEqual(Object.keys(manifest), [
    'schemaVersion',
    'generatedAt',
    'sourceCommit',
    'evidenceMode',
    'containsProductionData',
    'screenshotCount',
    'screenshots',
    'machineReadableArtifactCount',
    'machineReadableArtifacts',
  ]);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.generatedAt, generatedAt);
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.evidenceMode, 'synthetic_and_disposable_local_only');
  assert.equal(manifest.containsProductionData, false);
  assert.equal(manifest.screenshotCount, EXPECTED_SCREENSHOTS.length);
  assert.deepEqual(
    manifest.screenshots.map((screenshot) => screenshot.name),
    EXPECTED_SCREENSHOTS
  );
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.bytes === PNG_FIXTURE.length));
  assert.ok(manifest.screenshots.every((screenshot) => /^[a-f0-9]{64}$/.test(screenshot.sha256)));
  assert.equal(manifest.machineReadableArtifactCount, EXPECTED_MACHINE_READABLE_ARTIFACTS.length);
  assert.deepEqual(
    manifest.machineReadableArtifacts.map((artifact) => artifact.name),
    EXPECTED_MACHINE_READABLE_ARTIFACTS
  );
  assert.ok(manifest.machineReadableArtifacts.every((artifact) => artifact.schemaVersion === 1));
  assert.ok(manifest.machineReadableArtifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)));

  const writtenManifest = JSON.parse(await readFile(output, 'utf8'));
  assert.deepEqual(writtenManifest, manifest);
  assert.equal(JSON.stringify(writtenManifest).includes('@'), false);

  await rm(path.join(tempDir, EXPECTED_SCREENSHOTS[0]));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Missing expected synthetic UAT screenshots/
  );
  await writeFile(path.join(tempDir, EXPECTED_SCREENSHOTS[0]), Buffer.from('not a png'));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /valid PNG signature/
  );
  await writeFile(path.join(tempDir, EXPECTED_SCREENSHOTS[0]), PNG_FIXTURE);

  await writeFile(path.join(tempDir, 'unreviewed-state.png'), PNG_FIXTURE);
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT screenshots/
  );
  await rm(path.join(tempDir, 'unreviewed-state.png'));

  const missingMachineName = EXPECTED_MACHINE_READABLE_ARTIFACTS[0];
  await rm(path.join(tempDir, missingMachineName));
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Missing expected machine-readable UAT evidence/
  );
  await writeCanonicalJson(path.join(tempDir, missingMachineName), machineFixtures[missingMachineName]);

  const portalWithFreeText = {
    ...machineFixtures['refund-portal-assertions.json'],
    note: 'human-authored explanation',
  };
  assert.throws(
    () => validateMachineReadableEvidence('refund-portal-assertions.json', portalWithFreeText),
    /unsupported or missing fields/,
    'Free-text fields must fail the exact portal schema'
  );
  const portalWithProviderId = {
    ...machineFixtures['refund-portal-assertions.json'],
    providerTransactionId: 'provider-123',
  };
  assert.throws(
    () => validateMachineReadableEvidence('refund-portal-assertions.json', portalWithProviderId),
    /unsupported or missing fields/,
    'Provider identifiers must fail the exact portal schema'
  );
  const mimeWithAddress = structuredClone(machineFixtures['refund-gmail-mime-roles.json']);
  mimeWithAddress.roleCounts.managerCc = 4;
  assert.throws(
    () => validateMachineReadableEvidence('refund-gmail-mime-roles.json', mimeWithAddress),
    /bounded aggregate count/,
    'MIME evidence must contain only bounded role counts'
  );

  await writeFile(
    path.join(tempDir, 'refund-kill-switches.json'),
    JSON.stringify(machineFixtures['refund-kill-switches.json']),
    'utf8'
  );
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /canonical pretty-printed JSON/
  );
  await writeCanonicalJson(
    path.join(tempDir, 'refund-kill-switches.json'),
    machineFixtures['refund-kill-switches.json']
  );

  await writeCanonicalJson(path.join(tempDir, 'unreviewed-details.json'), { schemaVersion: 1 });
  await assert.rejects(
    buildEvidence({ artifactDir: tempDir, output, sourceCommit, generatedAt }),
    /Unreviewed UAT artifacts/
  );
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Refund UAT evidence validator passed.');
console.log(`- ${EXPECTED_SCREENSHOTS.length} required synthetic state screenshots`);
console.log(`- ${EXPECTED_MACHINE_READABLE_ARTIFACTS.length} strict machine-readable artifacts`);
console.log('- PNG/JSON schema, canonical encoding, and SHA-256 manifest checks');
console.log('- missing, corrupt, free-text, identity, and provider-ID evidence fails closed');
console.log('- manifest excludes production and identity data');
