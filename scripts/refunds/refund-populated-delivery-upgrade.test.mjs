import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPopulatedDeliveryUpgradeTest, writePopulatedDeliveryUpgradeTest, HISTORICAL_MESSAGE_GUARDS, readHistoricalMessageGuards } from './refund-populated-delivery-upgrade.mjs';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(repoRoot, 'supabase/migrations', name), 'utf8').replaceAll('\r\n', '\n');
const sources = {
  historicalGuardMigration: read('20260901202359_refund_provider_delay_evidence_1069.sql'),
  deliveryMigration: read('20260901070000_refund_transactional_delivery_truth.sql'),
};

test('populated upgrade embeds actual guard and entire current delivery prefix without rewriting SQL', () => {
  const sql = buildPopulatedDeliveryUpgradeTest(sources);
  const guardStart = sources.historicalGuardMigration.indexOf('create or replace function public.guard_refund_customer_status_message()');
  const guardEnd = sources.historicalGuardMigration.indexOf('\nrevoke all on function public.guard_refund_customer_status_message()');
  const prefixEnd = sources.deliveryMigration.indexOf('\ncreate table if not exists public.refund_transactional_delivery_events');
  assert.ok(sql.includes(sources.historicalGuardMigration.slice(guardStart, guardEnd).trim()));
  assert.ok(sql.includes(sources.deliveryMigration.slice(0, prefixEnd).trim()));
  assert.ok(sql.includes('23514:Automatic customer status update requires current deterministic evidence'));
  assert.ok(sql.includes('Fresh replay final guard and populated-upgrade guard are identical'));
  assert.ok(sql.includes('Pending-to-SENT delivery still fails with contact disabled'));
  assert.ok(sql.includes('public.service_bind_refund_transactional_delivery('));
  assert.ok(sql.includes('public.service_record_refund_transactional_delivery_event('));
  assert.ok(sql.includes('Status-preserving delivered metadata requires a matching recorded event'));
  assert.ok(sql.includes('A later verified complaint advances already-failed automatic status delivery truth'));
  assert.ok(sql.trimEnd().endsWith('rollback;'));
  assert.doesNotMatch(sql, /disable\s+trigger|session_replication_role|__HISTORICAL_GUARD__|__ORIGINAL_BACKFILL__|__CURRENT_DELIVERY_PREFIX__/iu);
});

test('changed source text reaches the fixture rather than being hidden by copied test logic', () => {
  const sentinel = '-- exact source sentinel';
  const sql = buildPopulatedDeliveryUpgradeTest({
    ...sources,
    deliveryMigration: `${sentinel}\n${sources.deliveryMigration}`,
  });
  assert.ok(sql.includes(sentinel));
});

test('every historical message guard is extracted from its actual applied migration', () => {
  const guards = readHistoricalMessageGuards(repoRoot);
  for (const [file, name] of HISTORICAL_MESSAGE_GUARDS) {
    const source = read(file);
    const start = source.indexOf(`create or replace function public.${name}()`);
    const end = source.indexOf('\n$$;', start);
    assert.ok(guards.includes(source.slice(start, end + 4)));
  }
  const sql = buildPopulatedDeliveryUpgradeTest({ ...sources, historicalMessageGuards: guards });
  assert.ok(sql.includes(guards));
  for (const family of ['more_info', 'no_safe_match', 'reminder', 'information_received', 'appeal_received',
    'wallet_correction', 'wallet_correction_reminder', 'card_approved', 'card_completed', 'legacy', 'internal', 'manual']) {
    assert.ok(sql.includes(`'${family}'`), `${family} must be represented`);
  }
  assert.ok(sql.includes('does not rewrite advanced follow-up cycle'));
  assert.ok(sql.includes('probe_old_family_backfill'));
});

test('missing extraction boundaries and SQL delimiter collisions fail closed', () => {
  assert.throws(() => buildPopulatedDeliveryUpgradeTest({ ...sources, historicalGuardMigration: '' }), /boundaries/);
  assert.throws(() => buildPopulatedDeliveryUpgradeTest({ ...sources, deliveryMigration: '' }), /boundaries/);
  assert.throws(() => buildPopulatedDeliveryUpgradeTest({ ...sources, deliveryMigration: `-- $delivery_upgrade$\n${sources.deliveryMigration}` }), /Unsafe/);
});

test('temporary fixture never overwrites an existing test and is not a repository persona test', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'refund-populated-upgrade-test-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'supabase/tests'), { recursive: true });
    const written = writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot);
    assert.equal(written.testRelativePath, 'supabase/tests/refund_populated_delivery_upgrade.sql');
    assert.equal(fs.readFileSync(written.testPath, 'utf8'), buildPopulatedDeliveryUpgradeTest(sources));
    assert.throws(() => writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot), /EEXIST/);
    assert.equal(fs.existsSync(path.join(repoRoot, written.testRelativePath)), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
