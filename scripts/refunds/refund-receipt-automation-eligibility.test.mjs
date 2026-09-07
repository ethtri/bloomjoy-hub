import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8').replaceAll('\r\n', '\n');
const worker = read('supabase/functions/refund-case-automation-sweep/index.ts');
function actualHelpers(names, globals) {
  const ast = ts.createSourceFile('worker.ts', worker, ts.ScriptTarget.Latest, true);
  const declarations = ast.statements.filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .filter((declaration) => ts.isIdentifier(declaration.name) && names.includes(declaration.name.text));
  assert.equal(declarations.length, names.length);
  const source = declarations.map((declaration) => `const ${declaration.getText(ast)};`).join('\n');
  const code = ts.transpileModule(`${source}\nexports.result={${names.join(',')}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, ...globals }, { timeout: 1000 });
  return exports.result;
}

for (const [category, expected] of [
  ['authoritative_refund_receipt', 'authoritative_refund_receipt'],
  ['untrusted-private-provider-text', 'duplicate_action'],
  [undefined, 'duplicate_action'],
]) {
  test(`actual claim helper safely classifies ${category ?? 'ordinary replay'}`, async () => {
    const counters = { actionsAttempted: 0, actionsSuppressed: 0, actionsFailed: 0, reasonCounts: {} };
    const helpers = actualHelpers(['addReason', 'claimAction'], {
      supabase: { rpc: async (name) => {
        assert.equal(name, 'service_claim_refund_automation_action');
        return { data: { claimed: false, actionId: null, status: 'not_eligible', reasonCategory: category }, error: null };
      } },
    });
    const result = await helpers.claimAction('run', 'case', 'fixture:key', 'customer_status_update',
      'card_refund_pending', '2026-09-02T00:00:00Z', counters);
    assert.equal(result.claimed, false);
    assert.equal(result.actionId, null);
    assert.deepEqual(counters, { actionsAttempted: 0, actionsSuppressed: 1, actionsFailed: 0, reasonCounts: { [expected]: 1 } });
  });
}

test('actual reply sweep uses filtered server page and safely skips receipt/busy races', async () => {
  const calls = [];
  const counters = { actionsAttempted: 0, actionsFailed: 0 };
  const helpers = actualHelpers(['runCustomerReplyFollowUpSweep'], {
    textValue: (value) => typeof value === 'string' ? value : null,
    supabase: {
      from: () => { throw new Error('Unfiltered direct table page or unintended write'); },
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === 'service_list_refund_follow_up_customer_reply_candidates') {
          assert.equal(args.p_limit, 25);
          return { data: [{ id: 'cycle-1', refund_case_id: 'case-1' }, { id: 'cycle-2', refund_case_id: 'case-2' }], error: null };
        }
        assert.equal(name, 'service_claim_refund_follow_up_customer_reply');
        return { data: { claimed: false, reason: args.p_refund_case_id === 'case-1' ? 'authoritative_refund_receipt' : 'case_busy' }, error: null };
      },
    },
  });
  await helpers.runCustomerReplyFollowUpSweep('run', counters, '2026-09-02T00:00:00Z');
  assert.equal(calls.length, 3);
  assert.deepEqual(counters, { actionsAttempted: 0, actionsFailed: 0 });
});

test('actual reply sweep surfaces candidate-query errors without claiming or sending', async () => {
  const failure = new Error('synthetic candidate read unavailable');
  const helpers = actualHelpers(['runCustomerReplyFollowUpSweep'], {
    supabase: { rpc: async () => ({ data: null, error: failure }) },
  });
  await assert.rejects(helpers.runCustomerReplyFollowUpSweep('run', {}, 'window'), failure);
});

test('forward patch anchors match the current runtime source exactly once', () => {
  const core = read('supabase/migrations/20260902182311_refund_all_message_delivery_bookkeeping.sql');
  const payout = read('supabase/migrations/20260902004500_refund_payout_destination_follow_up.sql');
  const extract = (source, name) => {
    const start = source.indexOf(`create or replace function public.${name}(`);
    const end = source.indexOf('\n$$;', start);
    assert(start >= 0 && end > start);
    return source.slice(start, end);
  };
  const reminder = extract(core, 'service_claim_due_refund_follow_up_reminders');
  const payoutClaim = extract(payout, 'service_claim_due_refund_payout_destination_follow_ups');
  for (const [body, anchor] of [
    [reminder, "    where cycle.status = 'waiting'"],
    [reminder, '    update public.refund_follow_up_cycles'],
    [payoutClaim, "    where follow_up.status = 'reminder_sent'"],
    [payoutClaim, "\n    update public.refund_payout_destination_follow_ups follow_up\n    set status = 'manual_review',\n        manual_review_at = statement_timestamp(),"],
  ]) assert.equal(body.split(anchor).length, 2, anchor);
  const migration = read('supabase/migrations/20260902195754_refund_receipt_automation_eligibility.sql');
  assert.match(migration, /for update skip locked/g);
  // Manager authorization follows a permanent action-key claim; a transient
  // skip there would consume the ordinary milestone, so preserve that lock.
  assert.doesNotMatch(migration, /for share skip locked/);
  assert.doesNotMatch(migration, /disable trigger|update public\.refund_authoritative_receipts/);
});
