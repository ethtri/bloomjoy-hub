#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);

export const EXPECTED_SCREENSHOTS = [
  'admin-machines-machine-managers.png',
  'refund-portal-demo-fallback.png',
  'refund-portal-gmail-draft-desktop.png',
  'refund-portal-gmail-draft-mobile.png',
  'refund-portal-uat-cash-confirmation.png',
  'refund-portal-uat-cash-desktop.png',
  'refund-portal-uat-cash-mobile.png',
  'refund-portal-uat-cash-success.png',
  'refund-portal-uat-confirmation.png',
  'refund-portal-uat-desktop.png',
  'refund-portal-uat-lookup-failed.png',
  'refund-portal-uat-mobile.png',
  'refund-portal-uat-multiple-candidates.png',
  'refund-portal-uat-no-match.png',
  'refund-portal-uat-processing.png',
  'refund-portal-uat-setup-needed.png',
  'refund-portal-uat-success.png',
  'refund-portal-uat-wallet-manual-review.png',
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function parseArgs(argv) {
  const args = {
    artifactDir: 'output/refund-uat-evidence',
    output: '',
    sourceCommit: process.env.GITHUB_SHA || 'local',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }

    if (arg === '--artifact-dir' && next) {
      args.artifactDir = next;
      index += 1;
      continue;
    }

    if (arg === '--output' && next) {
      args.output = next;
      index += 1;
      continue;
    }

    if (arg === '--source-commit' && next) {
      args.sourceCommit = next.trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  args.artifactDir = path.resolve(process.cwd(), args.artifactDir);
  args.output = path.resolve(
    process.cwd(),
    args.output || path.join(args.artifactDir, 'refund-uat-evidence.json')
  );
  return args;
}

function printHelp() {
  console.log(`Build sanitized Refund Operations browser-UAT evidence

Usage:
  npm run refunds:build-uat-evidence -- --artifact-dir output/refund-uat-evidence --source-commit <sha>

The input directory must contain all expected synthetic screenshots. The output
manifest contains filenames, sizes, SHA-256 digests, and no customer data.`);
}

function isPng(buffer) {
  return buffer.length >= PNG_SIGNATURE.length && buffer.subarray(0, 8).equals(PNG_SIGNATURE);
}

export async function buildEvidence({
  artifactDir,
  output,
  sourceCommit,
  generatedAt = new Date().toISOString(),
}) {
  if (!/^(?:[a-f0-9]{7,40}|local|working-tree)$/.test(sourceCommit)) {
    throw new Error('Source commit must be a Git SHA or the explicit local/working-tree marker.');
  }

  const directoryEntries = await readdir(artifactDir, { withFileTypes: true });
  const availableFiles = new Set(
    directoryEntries.filter((entry) => entry.isFile()).map((entry) => entry.name)
  );
  const missing = EXPECTED_SCREENSHOTS.filter((name) => !availableFiles.has(name));
  const unexpectedPngs = [...availableFiles].filter(
    (name) => name.toLowerCase().endsWith('.png') && !EXPECTED_SCREENSHOTS.includes(name)
  );

  if (missing.length > 0) {
    throw new Error(`Missing expected synthetic UAT screenshots: ${missing.join(', ')}`);
  }
  if (unexpectedPngs.length > 0) {
    throw new Error(`Unreviewed UAT screenshots are not included in the manifest: ${unexpectedPngs.join(', ')}`);
  }

  const screenshots = [];
  for (const name of EXPECTED_SCREENSHOTS) {
    const filePath = path.join(artifactDir, name);
    const [contents, fileStat] = await Promise.all([readFile(filePath), stat(filePath)]);

    if (!isPng(contents)) {
      throw new Error(`Expected a valid PNG signature for ${name}.`);
    }

    screenshots.push({
      name,
      bytes: fileStat.size,
      sha256: createHash('sha256').update(contents).digest('hex'),
    });
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    sourceCommit,
    evidenceMode: 'synthetic_browser_mocks',
    containsProductionData: false,
    screenshotCount: screenshots.length,
    screenshots,
  };

  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const manifest = await buildEvidence(args);
  console.log('Refund UAT evidence manifest built.');
  console.log(`- Synthetic screenshots: ${manifest.screenshotCount}`);
  console.log(`- Contains production data: ${manifest.containsProductionData ? 'yes' : 'no'}`);
  console.log(`- Source commit: ${manifest.sourceCommit}`);
  console.log(`- Manifest: ${args.output}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isMain) {
  run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: ${message}`);
    process.exit(1);
  });
}
