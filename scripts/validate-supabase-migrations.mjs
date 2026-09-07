#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createAuthenticatedEvidenceFragment } from './refunds/refund-uat-fragment-provenance.mjs';
import { getRefundGmailIntakeShadowOwnerQuerySnapshots } from './refunds/refund-gmail-intake-shadow-runner-clients.mjs';
import { writePopulatedDeliveryUpgradeTest, writeSettledCompletionDeliveryTest } from './refunds/refund-populated-delivery-upgrade.mjs';
import { writeReceiptWrapperParityTest } from './refunds/refund-receipt-wrapper-parity.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const testsDir = path.join(repoRoot, 'supabase', 'tests');
export const DATABASE_EVIDENCE_FILENAME = 'refund-database-counts.json';

function printHelp() {
  console.log(`Usage: npm run db:validate-migrations [-- --keep-temp] [--debug] [--evidence-dir <path>]

Validates Supabase migrations by applying them to a disposable local database.

Options:
  --debug                Pass --debug to Supabase CLI commands.
  --evidence-dir <path>  Write sanitized aggregate test evidence after a complete pass.
  --keep-temp            Leave the temporary Supabase project on disk for troubleshooting.
  --help                 Show this help text.
`);
}

function log(message = '') {
  process.stderr.write(`${message}\n`);
}

export function parseArgs(argv) {
  const options = {
    debug: false,
    evidenceDir: null,
    keepTemp: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--debug') {
      options.debug = true;
      continue;
    }

    if (arg === '--evidence-dir') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('--evidence-dir requires a path.');
      }
      options.evidenceDir = path.resolve(process.cwd(), value);
      index += 1;
      continue;
    }

    if (arg === '--keep-temp') {
      options.keepTemp = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

function run(
  command,
  args,
  { allowFailure = false, relayOutput = false, stdio = 'pipe', cwd = repoRoot } = {}
) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio,
    shell: false,
  });

  if (relayOutput && stdio === 'pipe') {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
  }

  if (result.error) {
    if (allowFailure) {
      return result;
    }

    throw result.error;
  }

  if (!allowFailure && result.status !== 0) {
    const error = new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
    error.result = result;
    throw error;
  }

  return result;
}

function requireCommand(command, args, installHint) {
  const result = run(command, args, { allowFailure: true });

  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(`${command} is not installed or is not on PATH. ${installHint}`);
  }

  if (result.status !== 0) {
    const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
    throw new Error(`${command} check failed.${stderr}`);
  }

  return result.stdout.trim();
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Supabase migrations directory not found: ${migrationsDir}`);
  }

  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
}

function getSqlFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return getSqlFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.sql') ? [entryPath] : [];
    })
    .sort();
}

function normalizeSqlLineEndings(directory) {
  for (const sqlFile of getSqlFiles(directory)) {
    const source = fs.readFileSync(sqlFile, 'utf8');
    const normalized = source.replaceAll('\r\n', '\n');
    if (normalized !== source) {
      fs.writeFileSync(sqlFile, normalized, 'utf8');
    }
  }
}

export function prepareCorrectionMigrationWindowsRegression(tempSupabaseDir) {
  // Apply the actual migration with Windows checkout bytes in every disposable
  // validation, including Linux CI. Do not let general LF normalization mask a
  // dollar-quoted source-match failure seen by the production Windows deploy.
  for (const name of ['20260903200000_refund_correction_message_delivery.sql', '20260904182000_refund_owner_nonrefund_adoption.sql']) {
    const migrationPath = path.join(tempSupabaseDir, 'migrations', name);
    const source = fs.readFileSync(migrationPath, 'utf8');
    fs.writeFileSync(migrationPath, source.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n'), 'utf8');
  }
}

export function prepareRefundRequestBoundaryReceiptRegression(tempSupabaseDir) {
  const fixturePath = path.join(
    tempSupabaseDir,
    'migrations',
    '202609051903115_refund_request_boundary_receipt_fixture.sql',
  );
  fs.writeFileSync(fixturePath, `
-- Disposable production-shape fixture: the next migration must preserve the
-- confirmed receipt case while clearing the unconfirmed legacy execution claim.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data)
values('fb110000-0000-4000-8000-000000000001','authenticated','authenticated',
  'request-boundary-receipt@example.invalid','{}','{}');
insert into public.customer_accounts(id,name,account_type)
values('fb120000-0000-4000-8000-000000000001','Request boundary receipt fixture','internal');
insert into public.reporting_locations(id,account_id,name,timezone)
values('fb130000-0000-4000-8000-000000000001','fb120000-0000-4000-8000-000000000001',
  'Request boundary receipt fixture','America/Los_Angeles');
insert into public.reporting_machines(id,account_id,location_id,machine_label,nayax_machine_id,nayax_account_key)
values('fb140000-0000-4000-8000-000000000001','fb120000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','Request boundary receipt fixture',
  'BOUNDARY-RECEIPT-MACHINE','BOUNDARY-RECEIPT-ACCOUNT');
insert into public.refund_cases(id,public_reference,reporting_machine_id,reporting_location_id,
  customer_email,issue_summary,incident_at,payment_method,payment_amount_cents,refund_amount_cents,
  card_last4,status,correlation_status,correlation_source,correlation_confidence,
  matched_nayax_transaction_id,matched_nayax_site_id,matched_nayax_machine_auth_time,
  matched_nayax_amount_cents,matched_nayax_card_last4,matched_nayax_currency_code,
  nayax_recommendation_state,nayax_recommendation_policy_version,nayax_recommendation_evaluated_at,
  nayax_match_execution_eligible,nayax_refund_execution_status)
values
 ('fb150000-0000-4000-8000-000000000001','RF-BOUNDARY-RECEIPT','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','confirmed-boundary@example.invalid',
  'Confirmed receipt boundary migration fixture',statement_timestamp()-interval '3 days','card',963,963,
  '4242','needs_review','matched','nayax',1,'BOUNDARY-RECEIPT-TX',7,
  statement_timestamp()-interval '3 days',963,'4242','USD','high_confidence','fixture-v1',
  statement_timestamp(),true,'not_requested'),
 ('fb150000-0000-4000-8000-000000000002','RF-BOUNDARY-UNCONFIRMED','fb140000-0000-4000-8000-000000000001',
  'fb130000-0000-4000-8000-000000000001','unconfirmed-boundary@example.invalid',
  'Unconfirmed boundary migration fixture',statement_timestamp()-interval '3 days','card',963,963,
  '4242','needs_review','matched','nayax',1,'BOUNDARY-UNCONFIRMED-TX',8,
  statement_timestamp()-interval '3 days',963,'4242','USD','high_confidence','fixture-v1',
  statement_timestamp(),true,'not_requested');
insert into public.refund_authoritative_receipts(refund_case_id,reporting_machine_id,account_scope,
  provider_machine_id,original_transaction_id,original_amount_cents,refunded_amount_cents,currency_code,
  provider_status,evidence_reference_digest,recorded_by,attempt_binding_kind,current_provider_observation_reviewed)
values('fb150000-0000-4000-8000-000000000001','fb140000-0000-4000-8000-000000000001',
  'BOUNDARY-RECEIPT-ACCOUNT','BOUNDARY-RECEIPT-MACHINE','BOUNDARY-RECEIPT-TX',963,963,'USD',62,
  '${'a'.repeat(64)}','fb110000-0000-4000-8000-000000000001','no_attempt_integrity_hold',true);
`, 'utf8');
  return fixturePath;
}

export function getDatabaseEvidenceExpectations() {
  return {
    migrationCount: getMigrationFiles().length,
    testFileCount: getSqlFiles(testsDir).length,
  };
}

export function parseDatabaseTestSummary(output) {
  const summaries = [...output.matchAll(/\bFiles=(\d+),\s*Tests=(\d+)\b/g)];
  if (summaries.length !== 1) {
    throw new Error('Supabase database test output must contain exactly one aggregate Files/Tests summary.');
  }

  const testFileCount = Number.parseInt(summaries[0][1], 10);
  const assertionCount = Number.parseInt(summaries[0][2], 10);
  if (!Number.isSafeInteger(testFileCount) || testFileCount < 1) {
    throw new Error('Supabase database test summary contains an invalid file count.');
  }
  if (!Number.isSafeInteger(assertionCount) || assertionCount < 1) {
    throw new Error('Supabase database test summary contains an invalid assertion count.');
  }

  return { testFileCount, assertionCount };
}

export function buildDatabaseEvidence({ migrationCount, discoveredTestFileCount, testSummary }) {
  if (!Number.isSafeInteger(migrationCount) || migrationCount < 1) {
    throw new Error('Database evidence requires a positive migration count.');
  }
  if (!Number.isSafeInteger(discoveredTestFileCount) || discoveredTestFileCount < 1) {
    throw new Error('Database evidence requires at least one discovered SQL test file.');
  }
  if (testSummary.testFileCount !== discoveredTestFileCount) {
    throw new Error(
      `Supabase database test summary covered ${testSummary.testFileCount} file(s), but ${discoveredTestFileCount} SQL test file(s) were discovered.`
    );
  }

  return {
    schemaVersion: 1,
    evidenceType: 'database_counts',
    evidenceMode: 'disposable_local_database',
    passed: true,
    migrationCount,
    testFileCount: testSummary.testFileCount,
    assertionCount: testSummary.assertionCount,
    failedAssertionCount: 0,
  };
}

export function writeDatabaseEvidence(
  evidenceDir,
  evidence,
  runToken,
  generatedAt = new Date().toISOString()
) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const evidencePath = path.join(evidenceDir, DATABASE_EVIDENCE_FILENAME);
  const fragment = createAuthenticatedEvidenceFragment({
    filename: DATABASE_EVIDENCE_FILENAME,
    evidence,
    runToken,
    generatedAt,
  });
  fs.writeFileSync(evidencePath, `${JSON.stringify(fragment, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return evidencePath;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();

    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === 'object' && address?.port) {
          resolve(address.port);
        } else {
          reject(new Error('Unable to allocate a local port.'));
        }
      });
    });
  });
}

async function getDistinctPorts(count) {
  const ports = new Set();

  while (ports.size < count) {
    ports.add(await getFreePort());
  }

  return [...ports];
}

function writeTempSupabaseProject(tempRoot, projectId, dbPort, shadowPort) {
  const tempSupabaseDir = path.join(tempRoot, 'supabase');
  fs.mkdirSync(tempSupabaseDir, { recursive: true });

  fs.cpSync(migrationsDir, path.join(tempSupabaseDir, 'migrations'), {
    recursive: true,
  });
  if (fs.existsSync(testsDir)) {
    fs.cpSync(testsDir, path.join(tempSupabaseDir, 'tests'), {
      recursive: true,
    });
  }
  normalizeSqlLineEndings(tempSupabaseDir);
  prepareCorrectionMigrationWindowsRegression(tempSupabaseDir);
  const requestBoundaryReceiptFixturePath =
    prepareRefundRequestBoundaryReceiptRegression(tempSupabaseDir);

  const config = `project_id = "${projectId}"

[db]
port = ${dbPort}
shadow_port = ${shadowPort}
major_version = 15
`;

  fs.writeFileSync(path.join(tempSupabaseDir, 'config.toml'), config, 'utf8');
  fs.writeFileSync(path.join(tempSupabaseDir, 'seed.sql'), '', 'utf8');
  return { requestBoundaryReceiptFixturePath };
}

function writeRefundGmailIntakeShadowAdapterTest(tempRoot) {
  const postflight = getRefundGmailIntakeShadowOwnerQuerySnapshots().postflight;
  if (postflight?.parameterCount !== 2 || typeof postflight.sql !== 'string') {
    throw new Error('Gmail intake-shadow owner postflight query is unavailable.');
  }
  const runKey = `owner-intake-shadow:${'a'.repeat(64)}`;
  const ownerUserId = 'a1000000-0000-4000-8000-000000000001';
  const renderedQuery = postflight.sql
    .replace(/\$1\b/gu, `'${runKey}'::text`)
    .replace(/\$2\b/gu, `'${ownerUserId}'::uuid`);
  if (/\$[12]\b/u.test(renderedQuery)) {
    throw new Error('Gmail intake-shadow owner postflight parameters were not bound.');
  }
  const testRelativePath = path.posix.join(
    'supabase',
    'tests',
    'refund_gmail_intake_shadow_owner_adapter.sql',
  );
  const testPath = path.join(
    tempRoot,
    'supabase',
    'tests',
    'refund_gmail_intake_shadow_owner_adapter.sql',
  );
  fs.writeFileSync(testPath, `
begin;
select plan(1);
select is(
  (select count(*)::bigint from (
${renderedQuery}
  ) as exact_owner_adapter_query),
  1::bigint,
  'Exact Gmail intake-shadow owner postflight adapter query executes on PostgreSQL'
);
select * from finish();
rollback;
`, 'utf8');
  return { testPath, testRelativePath };
}

function writeRefundRequestBoundaryReceiptRegressionTest(tempRoot) {
  const testRelativePath = path.posix.join(
    'supabase',
    'tests',
    'refund_request_boundary_receipt_migration.sql',
  );
  const testPath = path.join(tempRoot, ...testRelativePath.split('/'));
  fs.writeFileSync(testPath, `
begin;
select plan(3);
select is(
  (select nayax_match_execution_eligible from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000001'),
  true,
  'Request-boundary migration preserves a confirmed receipt case exactly'
);
select is(
  (select nayax_match_execution_eligible from public.refund_cases
    where id='fb150000-0000-4000-8000-000000000002'),
  false,
  'Request-boundary migration clears an unconfirmed legacy execution claim'
);
select is(
  (select count(*)::integer from public.refund_authoritative_receipts
    where refund_case_id='fb150000-0000-4000-8000-000000000001'),
  1,
  'The confirmed authoritative receipt remains durable'
);
select * from finish();
rollback;
`, 'utf8');
  return { testPath, testRelativePath };
}

function stopSupabase(tempRoot, debug) {
  const args = ['stop', '--workdir', tempRoot, '--no-backup'];

  if (debug) {
    args.push('--debug');
  }

  const result = run('supabase', args, { allowFailure: true });

  if (result.error || result.status !== 0) {
    log('WARN: Unable to stop the disposable Supabase stack cleanly.');
    if (result.stdout) {
      log(result.stdout.trim());
    }
    if (result.stderr) {
      log(result.stderr.trim());
    }
  }

  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const migrationFiles = getMigrationFiles();
  const testFiles = getSqlFiles(testsDir);
  if (migrationFiles.length === 0) {
    throw new Error('No Supabase migration files found.');
  }

  const supabaseVersion = requireCommand(
    'supabase',
    ['--version'],
    'Install the Supabase CLI before running migration validation.'
  );
  const dockerVersion = requireCommand(
    'docker',
    ['info', '--format', '{{.ServerVersion}}'],
    'Install Docker and start the Docker daemon before running migration validation.'
  );

  const [dbPort, shadowPort] = await getDistinctPorts(2);
  const projectId = `bj-migrations-${crypto.randomBytes(4).toString('hex')}`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomjoy-supabase-migrations-'));

  log(`Supabase CLI: ${supabaseVersion}`);
  log(`Docker Engine: ${dockerVersion}`);
  log(`Validating ${migrationFiles.length} migration file(s) in disposable project ${projectId}.`);
  log(`Temporary workdir: ${tempRoot}`);

  let databaseEvidence = null;
  let validationError;

  try {
    const { requestBoundaryReceiptFixturePath } = writeTempSupabaseProject(
      tempRoot,
      projectId,
      dbPort,
      shadowPort,
    );

    const args = ['db', 'start', '--workdir', tempRoot];
    if (options.debug) {
      args.push('--debug');
    }

    run('supabase', args, { stdio: 'inherit' });
    log('\nSupabase migration apply validation passed.');

    const {
      testPath: requestBoundaryReceiptPath,
      testRelativePath: requestBoundaryReceiptRelativePath,
    } = writeRefundRequestBoundaryReceiptRegressionTest(tempRoot);
    const requestBoundaryReceiptArgs = [
      'test', 'db', requestBoundaryReceiptRelativePath, '--workdir', tempRoot,
    ];
    if (options.debug) requestBoundaryReceiptArgs.push('--debug');
    run('supabase', requestBoundaryReceiptArgs, { relayOutput: true, cwd: tempRoot });
    fs.rmSync(requestBoundaryReceiptPath);
    log('Request-boundary migration preserves confirmed receipts and clears only unconfirmed legacy claims.');

    // The production-shape rows must not change global counts in the repository's
    // ordinary persona tests. Remove only the temporary migration, then rebuild
    // the same disposable database from the unmodified repository migration set.
    fs.rmSync(requestBoundaryReceiptFixturePath);
    const resetArgs = ['db', 'reset', '--local', '--workdir', tempRoot];
    if (options.debug) resetArgs.push('--debug');
    run('supabase', resetArgs, { stdio: 'inherit' });
    log('Disposable database reset without the request-boundary production-shape fixture.');

    const { testPath: receiptParityPath, testRelativePath: receiptParityRelativePath } =
      writeReceiptWrapperParityTest(repoRoot, tempRoot);
    const runReceiptWrapperParity = () => {
      const args = ['test', 'db', receiptParityRelativePath, '--workdir', tempRoot];
      if (options.debug) args.push('--debug');
      run('supabase', args, { relayOutput: true, cwd: tempRoot });
    };
    runReceiptWrapperParity();
    log('Fresh receipt wrappers and current core delegates have exact source/privilege parity.');

    run(process.execPath, ['--test', path.join(__dirname, 'refunds', 'refund-populated-delivery-upgrade.test.mjs')], { relayOutput: true });
    const { testPath: populatedUpgradePath, testRelativePath: populatedUpgradeRelativePath } =
      writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot);
    const populatedUpgradeArgs = ['test', 'db', populatedUpgradeRelativePath, '--workdir', tempRoot];
    if (options.debug) populatedUpgradeArgs.push('--debug');
    run('supabase', populatedUpgradeArgs, { relayOutput: true, cwd: tempRoot });
    fs.rmSync(populatedUpgradePath);
    log('Populated out-of-order delivery migration regression passed with all triggers enabled.');

    const { testPath: settledDeliveryPath, testRelativePath: settledDeliveryRelativePath } =
      writeSettledCompletionDeliveryTest(repoRoot, tempRoot);
    const settledDeliveryArgs = ['test', 'db', settledDeliveryRelativePath, '--workdir', tempRoot];
    if (options.debug) settledDeliveryArgs.push('--debug');
    run('supabase', settledDeliveryArgs, { relayOutput: true, cwd: tempRoot });
    fs.rmSync(settledDeliveryPath);
    log('Settled token-bound completion delivery regression passed with all triggers enabled.');
    runReceiptWrapperParity();
    fs.rmSync(receiptParityPath);
    log('Receipt wrapper/core composition remains exact after populated upgrade regressions.');

    const { testPath: ownerAdapterTestPath, testRelativePath: ownerAdapterTestRelativePath } =
      writeRefundGmailIntakeShadowAdapterTest(tempRoot);
    const ownerAdapterArgs = [
      'test', 'db', ownerAdapterTestRelativePath, '--workdir', tempRoot,
    ];
    if (options.debug) ownerAdapterArgs.push('--debug');
    run('supabase', ownerAdapterArgs, { relayOutput: true, cwd: tempRoot });
    fs.rmSync(ownerAdapterTestPath);
    log('Gmail intake-shadow exact owner postflight adapter query passed.');

    if (testFiles.length > 0) {
      const testArgs = ['test', 'db', '--workdir', tempRoot];
      if (options.debug) {
        testArgs.push('--debug');
      }

      const testResult = run('supabase', testArgs, { relayOutput: true });
      const testSummary = parseDatabaseTestSummary(
        `${testResult.stdout ?? ''}\n${testResult.stderr ?? ''}`
      );
      databaseEvidence = buildDatabaseEvidence({
        migrationCount: migrationFiles.length,
        discoveredTestFileCount: testFiles.length,
        testSummary,
      });
      log('Supabase database persona tests passed.');
    } else if (options.evidenceDir) {
      throw new Error('Database evidence requires at least one SQL test file.');
    }
  } catch (error) {
    validationError = error;
  } finally {
    if (options.keepTemp) {
      log(`Keeping temporary workdir for troubleshooting: ${tempRoot}`);
      log(`Stop the disposable stack with: supabase stop --workdir "${tempRoot}" --no-backup`);
    } else {
      stopSupabase(tempRoot, options.debug);
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  if (validationError) {
    throw validationError;
  }

  if (options.evidenceDir) {
    if (!databaseEvidence) {
      throw new Error('Database evidence was not produced by the disposable test run.');
    }
    const evidencePath = writeDatabaseEvidence(
      options.evidenceDir,
      databaseEvidence,
      process.env.REFUND_UAT_EVIDENCE_RUN_TOKEN ?? ''
    );
    log(`Sanitized database evidence written: ${evidencePath}`);
  }
}

if (path.resolve(process.argv[1] ?? '') === __filename) {
  main().catch((error) => {
    console.error('\nSupabase migration apply validation failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
