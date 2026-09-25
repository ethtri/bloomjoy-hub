import { execFileSync } from 'node:child_process';
import { successfulProductionDeploymentSha, verifyServedPortal } from './refund-portal-provenance.mjs';

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
const result = await verifyServedPortal({ origin: CANONICAL_ORIGIN, expectedSha });
console.log(JSON.stringify({ deploymentId: deployment.id, ...result }, null, 2));
