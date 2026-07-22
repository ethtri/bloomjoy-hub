#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  EXPECTED_SCREENSHOTS,
  buildEvidence,
  parseArgs,
} from './refund-uat-evidence.mjs';

const PNG_FIXTURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const sourceCommit = 'a'.repeat(40);
const generatedAt = '2026-07-22T00:00:00.000Z';
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'refund-uat-evidence-'));

try {
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
    buildEvidence({ artifactDir: tempDir, output: path.join(tempDir, 'invalid.json'), sourceCommit: 'person@example.test', generatedAt }),
    /Source commit must be a Git SHA/
  );

  for (const name of EXPECTED_SCREENSHOTS) {
    await writeFile(path.join(tempDir, name), PNG_FIXTURE);
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
  ]);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.generatedAt, generatedAt);
  assert.equal(manifest.sourceCommit, sourceCommit);
  assert.equal(manifest.evidenceMode, 'synthetic_browser_mocks');
  assert.equal(manifest.containsProductionData, false);
  assert.equal(manifest.screenshotCount, EXPECTED_SCREENSHOTS.length);
  assert.deepEqual(
    manifest.screenshots.map((screenshot) => screenshot.name),
    EXPECTED_SCREENSHOTS
  );
  assert.ok(manifest.screenshots.every((screenshot) => screenshot.bytes === PNG_FIXTURE.length));
  assert.ok(manifest.screenshots.every((screenshot) => /^[a-f0-9]{64}$/.test(screenshot.sha256)));

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
} finally {
  await rm(tempDir, { recursive: true, force: true });
}

console.log('Refund UAT evidence validator passed.');
console.log(`- ${EXPECTED_SCREENSHOTS.length} required synthetic state screenshots`);
console.log('- PNG signature and SHA-256 manifest checks');
console.log('- missing/corrupt evidence fails closed');
console.log('- manifest excludes production and identity data');
