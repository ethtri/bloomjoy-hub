#!/usr/bin/env node

const DEFAULT_PROJECT_REF = 'ygbzkgxktzqsiygjlqyg';

const parseArgs = (argv) => {
  const result = { projectRef: DEFAULT_PROJECT_REF, expect: 'closed' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = argv[index + 1];
    if (argument === '--project-ref' && next) {
      result.projectRef = next.trim();
      index += 1;
    } else if (argument === '--expect' && next) {
      result.expect = next.trim().toLowerCase();
      index += 1;
    } else {
      throw new Error(`Unsupported argument: ${argument}`);
    }
  }
  if (!/^[a-z0-9]{20}$/.test(result.projectRef)) {
    throw new Error('Use an exact 20-character Supabase project reference.');
  }
  if (!['open', 'closed'].includes(result.expect)) {
    throw new Error('--expect must be open or closed.');
  }
  return result;
};

const main = async () => {
  const { projectRef, expect } = parseArgs(process.argv.slice(2));
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    throw new Error(
      'SUPABASE_ACCESS_TOKEN is required for this read-only owner-supervised control-plane check.'
    );
  }

  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/auth`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    }
  );
  if (!response.ok) {
    throw new Error(
      `Supabase Auth readiness could not be confirmed (HTTP ${response.status}). No configuration was changed.`
    );
  }

  const config = await response.json();
  const enrollmentEnabled = config?.mfa_totp_enroll_enabled === true;
  const verificationEnabled = config?.mfa_totp_verify_enabled === true;
  const expectedEnrollmentEnabled = expect === 'open';

  if (enrollmentEnabled !== expectedEnrollmentEnabled || !verificationEnabled) {
    throw new Error(
      `Supabase Auth is not in the expected ${expect} state. No configuration was changed.`
    );
  }

  console.log(
    `PASS: Supabase Auth TOTP enrollment is ${expect}; verification is enabled. Read-only check made no changes.`
  );
};

main().catch((error) => {
  console.error(`ERROR: ${error instanceof Error ? error.message : 'Readiness check failed.'}`);
  process.exit(1);
});
