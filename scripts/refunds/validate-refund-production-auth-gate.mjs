#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REFUND_AUTH_CONFIG_READ_TOKEN_ENV,
  REFUND_PRODUCTION_PROJECT_REF,
  readHostedRefundTotpState,
  requireCanonicalRefundTotpSourceClosed,
  requireHostedRefundTotpState,
  requireOwnerHeldAuthConfigReadToken,
} from './refund-auth-control-plane.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const canonicalSource = `
[auth.mfa.totp]
enroll_enabled = false
verify_enabled = true

[auth.email]
enable_confirmations = true
`;
const readCanonicalFixture = () => canonicalSource;
const exactProject = {
  projectRef: REFUND_PRODUCTION_PROJECT_REF,
  confirmedProjectRef: REFUND_PRODUCTION_PROJECT_REF,
};
const sentinelToken = 'owner-private-token-never-print-this-value';

assert.deepEqual(
  requireCanonicalRefundTotpSourceClosed({ readFileSync: readCanonicalFixture }),
  { enrollmentEnabled: false, verificationEnabled: true },
  'Canonical source must parse as enrollment-off and verification-on'
);
for (const unsafeSource of [
  canonicalSource.replace('enroll_enabled = false', 'enroll_enabled = true'),
  canonicalSource.replace('verify_enabled = true', 'verify_enabled = false'),
  canonicalSource.replace('[auth.mfa.totp]', '[auth.mfa.phone]'),
  canonicalSource.replace('verify_enabled = true', 'enroll_enabled = false'),
]) {
  assert.throws(
    () => requireCanonicalRefundTotpSourceClosed({
      readFileSync: () => unsafeSource,
    }),
    /Canonical Supabase Auth TOTP source/u,
    'Any open, disabled-verification, missing, or duplicate canonical source must fail'
  );
}

assert.equal(
  requireOwnerHeldAuthConfigReadToken({
    [REFUND_AUTH_CONFIG_READ_TOKEN_ENV]: sentinelToken,
  }),
  sentinelToken
);
assert.throws(
  () => requireOwnerHeldAuthConfigReadToken({ SUPABASE_ACCESS_TOKEN: sentinelToken }),
  new RegExp(REFUND_AUTH_CONFIG_READ_TOKEN_ENV),
  'The generic or Edge drift token name must not substitute for the owner-held Auth token'
);

const calls = [];
const liveClosed = await readHostedRefundTotpState({
  ...exactProject,
  accessToken: sentinelToken,
  fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        mfa_totp_enroll_enabled: false,
        mfa_totp_verify_enabled: true,
        unrelated_private_configuration: sentinelToken,
      }),
    };
  },
});
assert.deepEqual(liveClosed, { enrollmentEnabled: false, verificationEnabled: true });
assert.equal(calls.length, 1, 'The gate must make exactly one hosted request');
assert.equal(
  calls[0].url,
  `https://api.supabase.com/v1/projects/${REFUND_PRODUCTION_PROJECT_REF}/config/auth`
);
assert.equal(calls[0].options.method, 'GET', 'The hosted request must be GET-only');
assert.equal(
  Object.prototype.hasOwnProperty.call(calls[0].options, 'body'),
  false,
  'The hosted read must have no request body'
);
assert.equal(calls[0].options.redirect, 'error');
assert.equal(calls[0].options.cache, 'no-store');
requireHostedRefundTotpState(liveClosed, false);

let mismatchedProjectFetches = 0;
await assert.rejects(
  readHostedRefundTotpState({
    projectRef: REFUND_PRODUCTION_PROJECT_REF,
    confirmedProjectRef: 'a'.repeat(20),
    accessToken: sentinelToken,
    fetchImpl: async () => {
      mismatchedProjectFetches += 1;
      throw new Error('must not fetch');
    },
  }),
  /must exactly match/u
);
await assert.rejects(
  readHostedRefundTotpState({
    projectRef: 'a'.repeat(20),
    confirmedProjectRef: 'a'.repeat(20),
    accessToken: sentinelToken,
    fetchImpl: async () => {
      mismatchedProjectFetches += 1;
      throw new Error('must not fetch');
    },
  }),
  /pinned to the Bloomjoy Hub production project/u
);
assert.equal(mismatchedProjectFetches, 0, 'Wrong or unconfirmed projects must fail before fetch');

for (const unsafeState of [
  { enrollmentEnabled: true, verificationEnabled: true },
  { enrollmentEnabled: false, verificationEnabled: false },
]) {
  assert.throws(
    () => requireHostedRefundTotpState(unsafeState, false),
    /Live Auth check failed/u
  );
}

let nonOkJsonWasRead = false;
await assert.rejects(
  readHostedRefundTotpState({
    ...exactProject,
    accessToken: sentinelToken,
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      json: async () => {
        nonOkJsonWasRead = true;
        return { secret: sentinelToken };
      },
    }),
  }),
  (error) => {
    assert.match(error.message, /HTTP 403/u);
    assert.doesNotMatch(error.message, new RegExp(sentinelToken));
    return true;
  }
);
assert.equal(nonOkJsonWasRead, false, 'Failure bodies must not be read or logged');

await assert.rejects(
  readHostedRefundTotpState({
    ...exactProject,
    accessToken: sentinelToken,
    fetchImpl: async () => {
      throw new Error(`transport exposed ${sentinelToken}`);
    },
  }),
  (error) => {
    assert.match(error.message, /could not be read/u);
    assert.doesNotMatch(error.message, new RegExp(sentinelToken));
    return true;
  }
);

await assert.rejects(
  readHostedRefundTotpState({
    ...exactProject,
    accessToken: sentinelToken,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error(`malformed response contained ${sentinelToken}`);
      },
    }),
  }),
  (error) => {
    assert.match(error.message, /could not be parsed/u);
    assert.doesNotMatch(error.message, new RegExp(sentinelToken));
    return true;
  }
);

const controlPlaneSource = read('scripts/refunds/refund-auth-control-plane.mjs');
const deployGateSource = read('scripts/refunds/refund-production-auth-closed.mjs');
const ceremonyReadinessSource = read('scripts/refunds/refund-owner-totp-auth-readiness.mjs');
const combinedCheckerSource = [
  controlPlaneSource,
  deployGateSource,
  ceremonyReadinessSource,
].join('\n');
assert.match(controlPlaneSource, /method:\s*'GET'/u);
assert.doesNotMatch(combinedCheckerSource, /method:\s*['"](?:PATCH|POST|PUT|DELETE)['"]/iu);
assert.doesNotMatch(combinedCheckerSource, /body:\s*JSON\.stringify/iu);
assert.doesNotMatch(combinedCheckerSource, /console\.(?:log|error)\([^\n]*(?:accessToken|config)/iu);
assert.match(deployGateSource, /--phase must be predeploy or postdeploy/u);
assert.match(deployGateSource, /requireCanonicalRefundTotpSourceClosed/u);
assert.match(deployGateSource, /requireExactRefundProductionProject/u);
assert.match(deployGateSource, /requireHostedRefundTotpState\(state, false\)/u);

const deployGatePath = path.join(repoRoot, 'scripts', 'refunds', 'refund-production-auth-closed.mjs');
const runGateCli = (args) => spawnSync(process.execPath, [deployGatePath, ...args], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: {
    ...process.env,
    [REFUND_AUTH_CONFIG_READ_TOKEN_ENV]: '',
    SUPABASE_ACCESS_TOKEN: sentinelToken,
  },
});
const mismatchedConfirmationCli = runGateCli([
  '--project-ref', REFUND_PRODUCTION_PROJECT_REF,
  '--confirm-project-ref', 'a'.repeat(20),
  '--phase', 'predeploy',
]);
assert.equal(mismatchedConfirmationCli.status, 1);
assert.match(mismatchedConfirmationCli.stderr, /must exactly match/u);
assert.doesNotMatch(mismatchedConfirmationCli.stderr, new RegExp(sentinelToken));
const genericTokenOnlyCli = runGateCli([
  '--project-ref', REFUND_PRODUCTION_PROJECT_REF,
  '--confirm-project-ref', REFUND_PRODUCTION_PROJECT_REF,
  '--phase', 'postdeploy',
]);
assert.equal(genericTokenOnlyCli.status, 1);
assert.match(genericTokenOnlyCli.stderr, new RegExp(REFUND_AUTH_CONFIG_READ_TOKEN_ENV));
assert.doesNotMatch(genericTokenOnlyCli.stderr, new RegExp(sentinelToken));
const missingPhaseCli = runGateCli([
  '--project-ref', REFUND_PRODUCTION_PROJECT_REF,
  '--confirm-project-ref', REFUND_PRODUCTION_PROJECT_REF,
]);
assert.equal(missingPhaseCli.status, 1);
assert.match(missingPhaseCli.stderr, /--phase must be predeploy or postdeploy/u);
const unsupportedArgumentCli = runGateCli([
  `--${sentinelToken}`,
]);
assert.equal(unsupportedArgumentCli.status, 1);
assert.match(unsupportedArgumentCli.stderr, /Unsupported argument/u);
assert.doesNotMatch(unsupportedArgumentCli.stderr, new RegExp(sentinelToken));

const packageJson = JSON.parse(read('package.json'));
assert.equal(
  packageJson.scripts['refunds:production-auth-closed'],
  'node scripts/refunds/refund-production-auth-closed.mjs'
);
assert.match(
  packageJson.scripts.test,
  /refunds:validate-production-auth-gate/u,
  'The executable guard test must run in the standard test profile'
);

const runbook = read('Docs/PRODUCTION_RUNBOOK.md');
const predeployGateIndex = runbook.indexOf(
  'npm run refunds:production-auth-closed -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --phase predeploy'
);
const firstProductionWriteIndex = runbook.indexOf('   - `supabase db push`');
const finalRefundDeployIndex = runbook.indexOf(
  'supabase functions deploy refund-manager-totp-enrollment --no-verify-jwt'
);
const postdeployGateIndex = runbook.indexOf(
  'npm run refunds:production-auth-closed -- --project-ref ygbzkgxktzqsiygjlqyg --confirm-project-ref ygbzkgxktzqsiygjlqyg --phase postdeploy'
);
const postdeploySmokeIndex = runbook.indexOf(
  'Run the no-auth, no-body route smoke',
  finalRefundDeployIndex
);
assert(
  predeployGateIndex >= 0 && predeployGateIndex < firstProductionWriteIndex,
  'The live closed-state predeploy gate must precede the first production DB write'
);
assert(
  finalRefundDeployIndex >= 0 &&
    postdeployGateIndex > finalRefundDeployIndex &&
    postdeployGateIndex < postdeploySmokeIndex,
  'The live closed-state postdeploy gate must follow the final refund function and precede smoke/UAT'
);
assert.match(runbook, /Do not reuse or broaden `SUPABASE_EDGE_FUNCTIONS_READ_TOKEN`/u);
assert.match(runbook, /never auto-restores or changes Auth/u);

console.log('PASS: refund production Auth gate is exact-project, source-closed, and GET-only');
console.log('PASS: wrong project, missing confirmation, unsafe live state, and unsafe source fail closed');
console.log('PASS: predeploy and postdeploy runbook ordering is executable and enforced');
console.log('PASS: token values and hosted configuration bodies are never emitted');
