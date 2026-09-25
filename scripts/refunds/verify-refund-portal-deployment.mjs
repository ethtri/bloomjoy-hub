import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { successfulMainBuildRun, successfulProductionDeploymentSha, verifyServedPortal } from './refund-portal-provenance.mjs';

const REPOSITORY = 'ethtri/bloomjoy-hub';
const CANONICAL_ORIGIN = 'https://app.bloomjoyusa.com';
const deploymentId = process.argv[2];
if (!/^\d+$/.test(deploymentId ?? '') || process.argv.length !== 3)
  throw new Error('Usage: npm run refunds:release:verify-portal -- <successful Production deployment ID>');

function ghApi(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/${endpoint}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

const deployment = ghApi(`deployments/${deploymentId}`);
const statuses = ghApi(`deployments/${deploymentId}/statuses?per_page=1`);
const expectedSha = successfulProductionDeploymentSha(deployment, statuses, Number(deploymentId));
const runs = JSON.parse(execFileSync('gh', [
  'run', 'list', '--repo', REPOSITORY, '--workflow', 'ci.yml', '--branch', 'main',
  '--event', 'push', '--commit', expectedSha, '--status', 'success', '--limit', '10',
  '--json', 'databaseId,headSha,headBranch,event,conclusion',
], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const trustedRun = successfulMainBuildRun(runs, expectedSha);
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'refund-portal-source-'));
try {
  execFileSync('gh', [
    'run', 'download', String(trustedRun.databaseId), '--repo', REPOSITORY,
    '--name', `refund-portal-source-${expectedSha}`, '--dir', temporaryDirectory,
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  const trustedBuild = JSON.parse(await readFile(
    path.join(temporaryDirectory, 'refund-portal-build.json'), 'utf8'));
  const result = await verifyServedPortal({
    origin: CANONICAL_ORIGIN, expectedSha, trustedBuild,
  });
  console.log(JSON.stringify({ deploymentId: deployment.id,
    independentBuildRunId: trustedRun.databaseId, ...result }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
