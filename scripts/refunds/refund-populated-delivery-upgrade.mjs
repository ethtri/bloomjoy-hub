import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturePath = fileURLToPath(new URL('./fixtures/refund-populated-delivery-upgrade.sql', import.meta.url));
export const POPULATED_DELIVERY_UPGRADE_TEST = 'refund_populated_delivery_upgrade.sql';

export function buildPopulatedDeliveryUpgradeTest({ historicalGuardMigration, deliveryMigration }) {
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
  };
  let fixture = fs.readFileSync(fixturePath, 'utf8').replaceAll('\r\n', '\n');
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
  });
  const testPath = path.join(tempRoot, 'supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST);
  fs.writeFileSync(testPath, source, { encoding: 'utf8', flag: 'wx' });
  return { testPath, testRelativePath: path.posix.join('supabase', 'tests', POPULATED_DELIVERY_UPGRADE_TEST) };
}
