import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/refund-populated-delivery-upgrade.sql', import.meta.url));
const familiesFixturePath = fileURLToPath(new URL('./fixtures/refund-populated-message-families.sql', import.meta.url));
export const HISTORICAL_MESSAGE_GUARDS = [
  ['202608040004_refund_nayax_provider_orchestration.sql', 'guard_nayax_attempt_completion_message'],
  ['20260812210000_refund_legacy_card_state_normalization.sql', 'guard_refund_legacy_state_message'],
  ['20260821100000_refund_branded_appeals.sql', 'guard_refund_denial_appeal_message'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'guard_refund_follow_up_message'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'guard_refund_follow_up_cycle'],
  ['202608030005_refund_deterministic_follow_up_cycles.sql', 'sync_refund_follow_up_cycle_from_message'],
];

export function readHistoricalMessageGuards(repoRoot) {
  return HISTORICAL_MESSAGE_GUARDS.map(([file, name]) => {
    const source = fs.readFileSync(path.join(repoRoot, 'supabase/migrations', file), 'utf8').replaceAll('\r\n', '\n');
    const start = source.indexOf(`create or replace function public.${name}()`);
    const end = source.indexOf('\n$$;', start);
    if (start < 0 || end < start) throw new Error(`Historical message guard boundary missing: ${name}`);
    return source.slice(start, end + 4);
  }).join('\n\n');
}
export const POPULATED_DELIVERY_UPGRADE_TEST = 'refund_populated_delivery_upgrade.sql';
export const SETTLED_COMPLETION_DELIVERY_TEST = 'refund_settled_completion_delivery.sql';

export function buildSettledCompletionDeliveryTest(orchestrationTest) {
  const normalized = orchestrationTest.replaceAll('\r\n', '\n');
  const boundary = normalized.indexOf('insert into public.refund_gmail_messages (\n  id, gmail_thread_id, refund_case_id, refund_case_message_id,');
  if (boundary < 0 || !normalized.slice(0, boundary).includes("'completion-claim-replay'")) {
    throw new Error('Exact settled orchestration fixture boundary is required.');
  }
  const prefix = normalized.slice(0, boundary).replace('select plan(61);', 'select no_plan();');
  if (/select plan\(/u.test(prefix) || /session_replication_role|disable\s+trigger/iu.test(prefix)) {
    throw new Error('Settled orchestration fixture must retain all enabled guards and use a dynamic plan.');
  }
  return `${prefix}\n${fs.readFileSync(fileURLToPath(new URL('./fixtures/refund-settled-completion-delivery.sql', import.meta.url)), 'utf8').replaceAll('\r\n', '\n')}`;
}

export function writeSettledCompletionDeliveryTest(repoRoot, tempRoot) {
  const source = buildSettledCompletionDeliveryTest(fs.readFileSync(path.join(repoRoot, 'supabase/tests/refund_nayax_provider_orchestration.sql'), 'utf8'));
  const testPath = path.join(tempRoot, 'supabase', 'tests', SETTLED_COMPLETION_DELIVERY_TEST);
  fs.writeFileSync(testPath, source, { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', SETTLED_COMPLETION_DELIVERY_TEST) };
}

export function buildPopulatedDeliveryUpgradeTest({ historicalGuardMigration, deliveryMigration, historicalMessageGuards = readHistoricalMessageGuards(fileURLToPath(new URL('../../', import.meta.url))) }) {
  const guardStart = historicalGuardMigration.indexOf('create or replace function public.guard_refund_customer_status_message()');
  const guardEnd = historicalGuardMigration.indexOf('\nrevoke all on function public.guard_refund_customer_status_message()', guardStart);
  const backfillStart = deliveryMigration.indexOf('update public.refund_case_messages message\nset\n');
  const backfillEnd = deliveryMigration.indexOf('\ncreate table if not exists public.refund_transactional_delivery_events', backfillStart);
  if (guardStart < 0 || guardEnd < guardStart || backfillStart < 0 || backfillEnd < backfillStart) {
    throw new Error('Exact historical guard and populated delivery migration boundaries are required.');
  }
  const replacements = {
    HISTORICAL_GUARD: historicalGuardMigration.slice(guardStart, guardEnd).trim(),
    ORIGINAL_BACKFILL: deliveryMigration.slice(backfillStart, backfillEnd).trim(),
    CURRENT_DELIVERY_PREFIX: deliveryMigration.slice(0, backfillEnd).trim(),
    HISTORICAL_FAMILY_GUARDS: historicalMessageGuards,
    FAMILY_ORIGINAL_BACKFILL: deliveryMigration.slice(backfillStart, backfillEnd).trim(),
    FAMILY_CURRENT_DELIVERY_PREFIX: deliveryMigration.slice(0, backfillEnd).trim(),
  };
  let fixture = fs.readFileSync(fixturePath, 'utf8').replaceAll('\r\n', '\n');
  fixture = fixture.replace('select * from finish();', () => `${fs.readFileSync(familiesFixturePath, 'utf8').replaceAll('\r\n', '\n')}\nselect * from finish();`);
  for (const [name, sql] of Object.entries(replacements)) {
    const marker = `/* __${name}__ */`;
    if (fixture.split(marker).length !== 2 || sql.includes('$delivery_upgrade$')) {
      throw new Error(`Unsafe or ambiguous populated-upgrade fixture source: ${name}.`);
    }
    fixture = fixture.replace(marker, () => sql);
  }
  if (/\/\* __[A-Z_]+__ \*\//u.test(fixture)) {
    throw new Error('Unresolved populated-upgrade fixture source.');
  }
  return fixture;
}

export function writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot) {
  const readMigration = (name) => fs.readFileSync(path.join(repoRoot, 'supabase', 'migrations', name), 'utf8').replaceAll('\r\n', '\n');
  const source = buildPopulatedDeliveryUpgradeTest({
    historicalGuardMigration: readMigration('20260901202359_refund_provider_delay_evidence_1069.sql'),
    deliveryMigration: readMigration('20260901070000_refund_transactional_delivery_truth.sql'),
    historicalMessageGuards: readHistoricalMessageGuards(repoRoot),
  });
  const testPath = path.join(tempRoot, 'supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST);
  fs.writeFileSync(testPath, source, { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST) };
}
