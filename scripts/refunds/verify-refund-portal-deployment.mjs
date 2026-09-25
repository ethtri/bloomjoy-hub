import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { successfulMainBuildRun, successfulProductionDeploymentSha,
  verifiedVercelAliasDeployment, verifyServedPortal } from './refund-portal-provenance.mjs';

const REPOSITORY = 'ethtri/bloomjoy-hub';
const CANONICAL_ORIGIN = 'https://app.bloomjoyusa.com';
const CANONICAL_ALIAS = 'app.bloomjoyusa.com';
const VERCEL_PROJECT_ID = 'prj_YC3LjtHvqX2BAvFdt4iLV9ARs1bM';
const VERCEL_TEAM_ID = 'team_yYNgFg7KgTwoN97wCL7rhDIj';
const deploymentId = process.argv[2];
if (!/^\d+$/.test(deploymentId ?? '') || process.argv.length !== 3)
  throw new Error('Usage: npm run refunds:release:verify-portal -- <successful Production deployment ID>');

function ghApi(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/${endpoint}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
}

async function vercelApi(pathname, query = {}) {
  if (!process.env.VERCEL_TOKEN) throw new Error('VERCEL_TOKEN is required for independent alias verification');
  const url = new URL(pathname, 'https://api.vercel.com');
  url.searchParams.set('teamId', VERCEL_TEAM_ID);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, { redirect: 'manual', cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    headers: { authorization: `Bearer ${process.env.VERCEL_TOKEN}` } });
  if (!response.ok || response.redirected || response.url !== url.href)
    throw new Error(`Vercel deployment identity lookup failed (${response.status})`);
  if (!response.body) throw new Error('Vercel deployment identity response is empty');
  const chunks = [];
  let received = 0;
  for await (const chunk of response.body) {
    received += chunk.length;
    if (received > 2_000_000) throw new Error('Vercel deployment identity response is oversized');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const deployment = ghApi(`deployments/${deploymentId}`);
const statuses = ghApi(`deployments/${deploymentId}/statuses?per_page=1`);
const expectedSha = successfulProductionDeploymentSha(deployment, statuses, Number(deploymentId));
const alias = await vercelApi(`/v4/aliases/${CANONICAL_ALIAS}`,
  { projectId: VERCEL_PROJECT_ID, slug: 'snapcase' });
if (!/^dpl_[A-Za-z0-9]+$/.test(alias?.deploymentId ?? ''))
  throw new Error('Canonical alias has no valid Vercel deployment ID');
const vercelDeployment = await vercelApi(`/v13/deployments/${alias.deploymentId}`);
const vercelIdentity = verifiedVercelAliasDeployment(alias, vercelDeployment, {
  aliasName: CANONICAL_ALIAS, projectId: VERCEL_PROJECT_ID, expectedSha,
  githubStatusUrl: statuses[0].target_url,
});
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
  const aliasAfterReadback = await vercelApi(`/v4/aliases/${CANONICAL_ALIAS}`,
    { projectId: VERCEL_PROJECT_ID, slug: 'snapcase' });
  verifiedVercelAliasDeployment(aliasAfterReadback, vercelDeployment, {
    aliasName: CANONICAL_ALIAS, projectId: VERCEL_PROJECT_ID, expectedSha,
    githubStatusUrl: statuses[0].target_url,
  });
  console.log(JSON.stringify({ githubDeploymentId: deployment.id,
    deploymentIdentityVerified: true, vercelDeploymentId: vercelIdentity.deploymentId,
    vercelProjectId: vercelIdentity.projectId, vercelDeploymentUrl: vercelIdentity.deploymentUrl,
    independentBuildRunId: trustedRun.databaseId, ...result }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
