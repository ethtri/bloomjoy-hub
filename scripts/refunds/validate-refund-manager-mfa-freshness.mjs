#!/usr/bin/env node

import { createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, message) => {
  if (!condition) fail(message);
};

const readLocalStatus = () => {
  const result = spawnSync('supabase', ['status', '--output', 'json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    fail('Start the disposable local Supabase stack before running the real MFA experiment.');
  }
  const start = result.stdout.indexOf('{');
  const end = result.stdout.lastIndexOf('}');
  if (start < 0 || end <= start) fail('Unable to read local Supabase status.');
  return JSON.parse(result.stdout.slice(start, end + 1));
};

const decodeJwt = (token) => {
  const part = String(token || '').split('.')[1];
  if (!part) fail('Supabase Auth returned an invalid access token.');
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
};

const newestTotpTimestamp = (token) => {
  const payload = decodeJwt(token);
  const entries = Array.isArray(payload.amr)
    ? payload.amr.filter((entry) => entry?.method === 'totp')
    : [];
  const timestamps = entries
    .map((entry) => Number(entry?.timestamp))
    .filter(Number.isFinite);
  return {
    aal: payload.aal ?? 'aal1',
    timestamp: timestamps.length ? Math.max(...timestamps) : null,
    count: timestamps.length,
  };
};

const base32Decode = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of String(value || '').replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) fail('Supabase Auth returned malformed TOTP enrollment material.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
};

const totp = (secret, atMs = Date.now()) => {
  const counter = Math.floor(atMs / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
};

const nextTotpWindowDelayMs = () => {
  const elapsed = Math.floor(Date.now() / 1000) % 30;
  return (30 - elapsed) * 1000 + 1200;
};

const requireData = (result, label) => {
  if (result.error || !result.data) {
    const code = result.error?.code ? ` (${result.error.code})` : '';
    fail(`${label} failed${code}. Confirm this disposable local stack has a deliberately opened TOTP enrollment window.`);
  }
  return result.data;
};

const run = async () => {
  const status = readLocalStatus();
  const apiUrl = status.API_URL;
  const anonKey = status.ANON_KEY;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  assert(apiUrl && anonKey && serviceRoleKey, 'Local Supabase status is missing Auth credentials.');

  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `refund-mfa-${randomBytes(10).toString('hex')}@example.test`;
  const password = `Local-only-${randomBytes(18).toString('base64url')}!`;
  let userId = null;

  try {
    const created = requireData(
      await admin.auth.admin.createUser({ email, password, email_confirm: true }),
      'Synthetic user creation'
    );
    userId = created.user?.id ?? null;
    assert(userId, 'Synthetic user creation returned no user ID.');

    const userClient = createClient(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    requireData(await userClient.auth.signInWithPassword({ email, password }), 'First-factor sign-in');

    const enrollment = requireData(
      await userClient.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Local refund freshness experiment',
        issuer: 'Bloomjoy local experiment',
      }),
      'TOTP enrollment'
    );
    const factorId = enrollment.id;
    const secret = enrollment.totp?.secret;
    assert(factorId && secret, 'TOTP enrollment returned incomplete transient material.');

    const firstChallenge = requireData(
      await userClient.auth.mfa.challenge({ factorId }),
      'First TOTP challenge'
    );
    const firstVerification = requireData(
      await userClient.auth.mfa.verify({
        factorId,
        challengeId: firstChallenge.id,
        code: totp(secret),
      }),
      'First TOTP verification'
    );
    assert(firstVerification.access_token && firstVerification.refresh_token,
      'First TOTP verification returned no session tokens.');
    const firstProof = newestTotpTimestamp(firstVerification.access_token);
    assert(firstProof.aal === 'aal2' && firstProof.count >= 1 && firstProof.timestamp,
      'First TOTP verification did not produce an AAL2 token with TOTP AMR.');

    const refreshed = requireData(
      await userClient.auth.refreshSession({ refresh_token: firstVerification.refresh_token }),
      'Refresh-only session rotation'
    );
    const refreshProof = newestTotpTimestamp(refreshed.session?.access_token);
    assert(refreshProof.aal === 'aal2', 'Refresh unexpectedly downgraded the verified session.');
    assert(refreshProof.timestamp === firstProof.timestamp,
      'Refresh-only unexpectedly advanced the TOTP AMR timestamp.');

    const passwordOnlyClient = createClient(apiUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const passwordOnly = requireData(
      await passwordOnlyClient.auth.signInWithPassword({ email, password }),
      'Password-only re-login'
    );
    const passwordProof = newestTotpTimestamp(passwordOnly.session?.access_token);
    assert(passwordProof.aal === 'aal1' && passwordProof.timestamp === null,
      'Password-only login unexpectedly inherited TOTP authority.');

    const intentNotBeforeEpoch = Math.floor(Date.now() / 1000);
    assert(firstProof.timestamp <= intentNotBeforeEpoch,
      'The old AAL2 proof was unexpectedly newer than the synthetic action intent.');
    await new Promise((resolve) => setTimeout(resolve, nextTotpWindowDelayMs()));

    const secondChallenge = requireData(
      await userClient.auth.mfa.challenge({ factorId }),
      'Repeated TOTP challenge'
    );
    const secondVerification = requireData(
      await userClient.auth.mfa.verify({
        factorId,
        challengeId: secondChallenge.id,
        code: totp(secret),
      }),
      'Repeated TOTP verification'
    );
    const secondProof = newestTotpTimestamp(secondVerification.access_token);
    assert(secondProof.aal === 'aal2' && secondProof.timestamp,
      'Repeated TOTP verification returned no AAL2 TOTP proof.');
    assert(secondProof.timestamp > firstProof.timestamp,
      'Repeated TOTP verification did not advance the AMR timestamp.');
    assert(secondProof.timestamp > intentNotBeforeEpoch,
      'Repeated TOTP verification was not strictly newer than the action intent.');

    const secondRefresh = requireData(
      await userClient.auth.refreshSession({
        refresh_token: secondVerification.refresh_token,
      }),
      'Second refresh-only rotation'
    );
    const secondRefreshProof = newestTotpTimestamp(secondRefresh.session?.access_token);
    assert(secondRefreshProof.timestamp === secondProof.timestamp,
      'A later refresh-only rotation unexpectedly advanced TOTP authority.');

    console.log('PASS real local Supabase Auth TOTP freshness experiment');
    console.log('PASS repeated verification advanced the TOTP AMR timestamp');
    console.log('PASS refresh-only rotation preserved, but did not advance, TOTP AMR');
    console.log('PASS password-only login did not inherit TOTP authority');
    console.log('PASS old AAL2 proof was older than the new action intent');
  } finally {
    if (userId) {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
    }
  }
};

run().catch((error) => {
  console.error(`FAIL real local Supabase MFA experiment: ${error instanceof Error ? error.message : 'unknown error'}`);
  process.exit(1);
});
