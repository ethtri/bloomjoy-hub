import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { applyOwnerResolutionBoundary, buildReceiptWrapperParityTest, extractReceiptParityBody, COMPLETION_MIGRATION,
  CORE_DISPATCH_MIGRATION, OWNER_RESOLUTION_MIGRATION } from './refund-receipt-wrapper-parity.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (name) => fs.readFileSync(path.join(root, 'supabase/migrations', name), 'utf8');
test('source-derived runtime proof includes exact current core delegates and receipt outer wrappers', () => {
  const sql = buildReceiptWrapperParityTest(root);
  assert(sql.includes('select plan(20)'));
  for (const name of ['service_claim_refund_gmail_outbound_v3', 'service_mark_refund_transactional_delivery_attempt']) {
    const core = extractReceiptParityBody(read(CORE_DISPATCH_MIGRATION), name);
    const receipt = applyOwnerResolutionBoundary(extractReceiptParityBody(read(COMPLETION_MIGRATION), name), name,
      read(OWNER_RESOLUTION_MIGRATION));
    assert(sql.includes(`$receipt_parity$${core}$receipt_parity$`));
    assert(sql.includes(`$receipt_parity$${receipt}$receipt_parity$`));
    assert(core.includes('Follow-up reminder requires a non-failed original request'));
    assert(receipt.includes("errcode='P4663'"));
  }
  assert.doesNotMatch(sql, /disable\s+trigger|session_replication_role/iu);
  assert(sql.endsWith('rollback;\n'));
});
test('parity extraction fails closed on missing or unsafe source', () => {
  assert.throws(() => extractReceiptParityBody('', 'missing'), /Missing exact/);
  assert.throws(() => extractReceiptParityBody('create function public.f()\nreturns void as $$\n$receipt_parity$\n$$;', 'f'), /Unsafe/);
});
test('disposable runner proves wrapper composition before and after populated upgrade work', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/validate-supabase-migrations.mjs'), 'utf8');
  const first = source.indexOf('runReceiptWrapperParity();');
  const second = source.indexOf('runReceiptWrapperParity();', first + 1);
  assert(first >= 0 && second > first);
  assert(first < source.indexOf('writePopulatedDeliveryUpgradeTest(repoRoot, tempRoot)'));
  assert(second > source.indexOf('writeSettledCompletionDeliveryTest(repoRoot, tempRoot)'));
});
