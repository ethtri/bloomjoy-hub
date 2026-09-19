import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REFUND_AUTH_CONFIG_READ_TOKEN_ENV,
  REFUND_PRODUCTION_PROJECT_REF,
  formatHostedRefundTotpPass,
  readHostedRefundTotpState,
  requireCanonicalRefundTotpSourceClosed,
  requireExactRefundProductionProject,
  requireHostedRefundTotpState,
  requireOwnerHeldAuthConfigReadToken,
} from './refund-auth-control-plane.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const exactProject = {
  projectRef: REFUND_PRODUCTION_PROJECT_REF,
  confirmedProjectRef: REFUND_PRODUCTION_PROJECT_REF,
};

test('production Auth gate requires the exact project twice', () => {
  assert.equal(requireExactRefundProductionProject(exactProject), REFUND_PRODUCTION_PROJECT_REF);
  for (const input of [
    { projectRef: '', confirmedProjectRef: '' },
    { projectRef: 'wrong', confirmedProjectRef: 'wrong' },
    { projectRef: 'a'.repeat(20), confirmedProjectRef: 'a'.repeat(20) },
    { projectRef: REFUND_PRODUCTION_PROJECT_REF, confirmedProjectRef: 'a'.repeat(20) },
  ]) {
    assert.throws(
      () => requireExactRefundProductionProject(input),
      /explicit 20-character|pinned|exactly match/
    );
  }
});

test('canonical Auth source accepts only closed enrollment with verification retained', () => {
  const readFileSync = () => [
    '[auth.mfa.totp]',
    'enroll_enabled = false',
    'verify_enabled = true',
    '[auth.external.google]',
  ].join('\n');
  assert.deepEqual(
    requireCanonicalRefundTotpSourceClosed({ readFileSync }),
    { enrollmentEnabled: false, verificationEnabled: true }
  );

  for (const source of [
    '',
    '[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true',
    '[auth.mfa.totp]\nenroll_enabled = false\nverify_enabled = false',
    '[auth.mfa.totp]\nenroll_enabled = false',
    '[auth.mfa.totp]\nenroll_enabled = false\nverify_enabled = true\n[auth.mfa.totp]\nenroll_enabled = false\nverify_enabled = true',
  ]) {
    assert.throws(
      () => requireCanonicalRefundTotpSourceClosed({ readFileSync: () => source }),
      /incomplete or ambiguous|not in the reviewed closed state/
    );
  }
});

test('repository canonical Auth source remains in the reviewed closed state', () => {
  assert.deepEqual(
    requireCanonicalRefundTotpSourceClosed({ repoRoot }),
    { enrollmentEnabled: false, verificationEnabled: true }
  );
});

test('production Auth gate requires an owner-held token without printing it', () => {
  assert.equal(
    requireOwnerHeldAuthConfigReadToken({ [REFUND_AUTH_CONFIG_READ_TOKEN_ENV]: '  private-token  ' }),
    'private-token'
  );
  assert.throws(
    () => requireOwnerHeldAuthConfigReadToken({}),
    new RegExp(`${REFUND_AUTH_CONFIG_READ_TOKEN_ENV} is required`)
  );
});

test('hosted Auth read is exact, read-only, and rejects unavailable or malformed state', async () => {
  const calls = [];
  const state = await readHostedRefundTotpState({
    ...exactProject,
    accessToken: 'private-token',
    fetchImpl: async (...args) => {
      calls.push(args);
      return {
        ok: true,
        json: async () => ({
          mfa_totp_enroll_enabled: false,
          mfa_totp_verify_enabled: true,
        }),
      };
    },
  });
  assert.deepEqual(state, { enrollmentEnabled: false, verificationEnabled: true });
  assert.deepEqual(calls, [[
    `https://api.supabase.com/v1/projects/${REFUND_PRODUCTION_PROJECT_REF}/config/auth`,
    {
      method: 'GET',
      headers: { Authorization: 'Bearer private-token', Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
    },
  ]]);

  const failureFixtures = [
    async () => { throw new Error('network'); },
    async () => ({ ok: false, status: 403 }),
    async () => ({ ok: true, json: async () => { throw new Error('json'); } }),
    async () => ({ ok: true, json: async () => ({ mfa_totp_enroll_enabled: false }) }),
  ];
  for (const fetchImpl of failureFixtures) {
    await assert.rejects(
      readHostedRefundTotpState({ ...exactProject, accessToken: 'private-token', fetchImpl }),
      /could not be read|could not be confirmed|could not be parsed|both required TOTP booleans/
    );
  }
});

test('hosted Auth assertion fails closed and reports only boolean state', () => {
  const closed = { enrollmentEnabled: false, verificationEnabled: true };
  assert.deepEqual(requireHostedRefundTotpState(closed, false), closed);
  for (const state of [
    { enrollmentEnabled: true, verificationEnabled: true },
    { enrollmentEnabled: false, verificationEnabled: false },
  ]) {
    assert.throws(() => requireHostedRefundTotpState(state, false), /Live Auth check failed/);
  }
  assert.equal(
    formatHostedRefundTotpPass({ state: closed, label: 'predeploy production Auth gate passed' }),
    'PASS: predeploy production Auth gate passed; enrollment=false; verification=true. Read-only check made no changes.'
  );
});
