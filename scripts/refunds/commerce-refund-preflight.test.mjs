import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const preflightPath = path.join(repoRoot, 'scripts/commerce-preflight.mjs');

const managerContract = {
  schemaVersion: 2,
  contractVersion: 'nayax-production-account-contract-v2',
  baseUrl: 'https://lynx.nayax.com/operational/v1',
  authorizationMode: 'bearer',
  amountUnit: 'major',
  amountRoundingMode: 'exact_cent',
  refundEmailListMode: 'omit',
  writeCredentialMode: 'separate',
  sameWriteTokenContractConfirmed: false,
  reconciliationMode: 'dtm_then_structured_resolution',
  requestResponses: [
    { result: 'True', status: 'Pending Approval', outcome: 'accepted' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
  ],
  approveResponses: [
    { result: 'True', status: 'Approved', outcome: 'succeeded' },
    { result: 'False', status: 'Duplicate', outcome: 'duplicate' },
    { result: 'False', status: 'Already Refunded', outcome: 'already_refunded' },
  ],
};

const inheritedEnvironment = Object.fromEntries(
  ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'PATHEXT', 'ComSpec']
    .map((key) => [key, process.env[key]])
    .filter(([, value]) => typeof value === 'string'),
);

const validEnvironment = {
  ...inheritedEnvironment,
  STRIPE_SECRET_KEY: 'configured',
  STRIPE_STICKS_PRICE_ID: 'configured',
  STRIPE_PLUS_PRICE_ID: 'configured',
  STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID: 'configured',
  STRIPE_WEBHOOK_SECRET: 'configured',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'configured',
  SUPABASE_SERVICE_ROLE_KEY: 'configured',
  RESEND_API_KEY: 'configured',
  INTERNAL_NOTIFICATION_FROM_EMAIL: 'ops@example.com',
  INTERNAL_NOTIFICATION_RECIPIENTS: 'ops@example.com',
  STRIPE_SUGAR_MEMBER_PRICE_ID: 'configured',
  STRIPE_SUGAR_NON_MEMBER_PRICE_ID: 'configured',
  STRIPE_STICKS_MEMBER_PRICE_ID: 'configured',
  WECOM_CORP_ID: 'configured',
  WECOM_AGENT_ID: '123',
  WECOM_AGENT_SECRET: 'configured',
  WECOM_ALERT_TO_USERIDS: 'configured',
  PUBLIC_INTAKE_ABUSE_HASH_SALT: 'configured',
  NAYAX_LYNX_BASE_URL: 'https://lynx.nayax.com/operational/v1',
  NAYAX_LYNX_API_TOKEN_TGPACI_USA_DB: 'reporting-token',
  NAYAX_REFUND_EXECUTION_ENABLED: 'false',
  NAYAX_REFUND_EXECUTION_DRY_RUN: 'true',
  NAYAX_REFUND_EXECUTION_KILL_SWITCH: 'true',
  NAYAX_REFUND_MANAGER_CONTRACT_JSON: JSON.stringify(managerContract),
  NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: 'false',
  NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: 'false',
  NAYAX_REFUND_MAX_AMOUNT_CENTS: '1000',
  NAYAX_REFUND_DAILY_AMOUNT_CAP_CENTS: '5000',
  NAYAX_REFUND_DAILY_COUNT_CAP: '10',
  NAYAX_REFUND_IDEMPOTENCY_SECRET: 'a'.repeat(43),
  NAYAX_REFUND_EXECUTOR_ASSERTION: 'b'.repeat(43),
  NAYAX_REFUND_REQUEST_WRITE_TOKEN_TEST_ACCOUNT: 'request-write-token',
  NAYAX_REFUND_APPROVE_WRITE_TOKEN_TEST_ACCOUNT: 'approve-write-token',
  REFUND_AUTOMATION_SWEEP_SECRET: 'configured',
};

const runPreflight = (overrides = {}) => {
  const env = { ...validEnvironment, ...overrides };
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'undefined') delete env[key];
  }
  return spawnSync(process.execPath, [preflightPath, '--include-refunds'], {
    cwd: repoRoot,
    env,
    encoding: 'utf8',
  });
};

test('active journal-v3 refund inputs pass while execution gates remain fail-closed', () => {
  const result = runPreflight();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /Commerce and refund operations preflight checks passed/);
});

test('obsolete pilot confirmation cannot substitute for active v3 contract inputs', () => {
  const result = runPreflight({
    NAYAX_REFUND_EXECUTION_PROVIDER_CONTRACT_CONFIRMED: 'true',
    NAYAX_REFUND_MANAGER_CONTRACT_JSON: undefined,
    NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED: undefined,
    NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED: undefined,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /NAYAX_REFUND_MANAGER_CONTRACT_JSON is missing/);
  assert.match(result.stdout, /NAYAX_REFUND_MANAGER_CONTRACT_CONFIRMED is missing/);
  assert.match(result.stdout, /NAYAX_REFUND_APPROVAL_SCOPE_CONFIRMED is missing/);
});

test('preflight requires a paired account-scoped request and approval credential', () => {
  const result = runPreflight({
    NAYAX_REFUND_APPROVE_WRITE_TOKEN_TEST_ACCOUNT: undefined,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Missing a paired account-scoped Nayax refund request\/approval write credential/);
  assert.match(result.stdout, /Missing NAYAX_REFUND_APPROVE_WRITE_TOKEN_TEST_ACCOUNT/);
});

test('QA manager contracts are rejected for production execution', () => {
  const result = runPreflight({
    NAYAX_REFUND_MANAGER_CONTRACT_JSON: JSON.stringify({
      ...managerContract,
      baseUrl: 'https://qa-lynx.nayax.com/operational/v1',
    }),
  });
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /NAYAX_REFUND_MANAGER_CONTRACT_JSON must use https:\/\/lynx\.nayax\.com\/operational\/v1/,
  );
});

test('credential shape and separate-token semantics match adapter construction', () => {
  const result = runPreflight({
    NAYAX_REFUND_APPROVE_WRITE_TOKEN_TEST_ACCOUNT: 'request-write-token',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /write credentials for TEST_ACCOUNT do not match the confirmed contract/);
});
