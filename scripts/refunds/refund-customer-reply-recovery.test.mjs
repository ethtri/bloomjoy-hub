import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
// Execute the real handler and coordinator, not a copied approximation. The
// isolated context has no network, credentials, Deno, payment or email client.
function execute(source, globals = {}, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    exports, ...globals,
    require: (name) => {
      assert(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
  }, { timeout: 1000 });
  return exports;
}
const extraction = execute(read('supabase/functions/_shared/refund-email-fact-extraction.ts'));
const classification = execute(read('supabase/functions/_shared/refund-customer-fact-application.ts'));
const followUp = execute(read('supabase/functions/_shared/refund-deterministic-follow-up.ts'));
const sync = read('supabase/functions/refund-gmail-sync/index.ts');
const start = sync.indexOf('const applyDeterministicCustomerReplyFacts =');
const end = sync.indexOf('const sendGmailCaseActionNotice =', start);
assert(start >= 0 && end > start, 'Actual Gmail handler must be present');
const handlerSource = sync.slice(start, end) + '\nexports.apply = applyDeterministicCustomerReplyFacts;';

function harness() {
  const state = {
    current: {
      id: 'synthetic-case', deterministic_fact_version: 1, status: 'needs_review', decision: null,
      reporting_machine_id: 'synthetic-machine', reporting_location_id: 'synthetic-location',
      incident_at: '2020-01-01T20:00:00Z', incident_local_datetime: '2020-01-01T12:00',
      incident_timezone: 'America/Los_Angeles', incident_time_resolution: 'exact',
      payment_method: 'card', payment_amount_cents: 100, card_last4: '4242',
      card_last4_provenance: 'physical_card', card_network: null,
      card_wallet_used: false, payment_interaction: 'tap_card', wallet_provider: null,
    },
    ledger: new Map(), actions: new Set(), applications: 0, events: 0, lookups: 0,
    breakAfterCommit: false, receiptOverride: undefined, driftAfterReceipt: false,
  };
  async function rpc(name, args) {
    if (name === 'service_get_refund_gmail_fact_application_v1') {
      if (state.receiptOverride !== undefined) return state.receiptOverride;
      const entry = state.ledger.get(args.p_gmail_message_id);
      const receipt = !entry ? { outcome: 'not_applied' }
        : entry.factVersion !== state.current.deterministic_fact_version ? { outcome: 'stale' }
        : { outcome: 'already_applied', ...entry };
      if (state.driftAfterReceipt) state.current.deterministic_fact_version++;
      return receipt;
    }
    if (name === 'service_apply_refund_gmail_customer_facts_v1') {
      state.applications++;
      const prior = state.ledger.get(args.p_gmail_message_id);
      if (prior) return { outcome: 'already_applied', ...prior };
      assert.equal(args.p_expected_fact_version, state.current.deterministic_fact_version);
      Object.assign(state.current, args.p_updates);
      state.current.deterministic_fact_version++;
      state.events++;
      const entry = { factVersion: state.current.deterministic_fact_version, appliedFields: args.p_applied_fields };
      state.ledger.set(args.p_gmail_message_id, entry);
      if (state.breakAfterCommit) {
        state.breakAfterCommit = false;
        throw new Error('simulated interruption after atomic commit');
      }
      return { outcome: 'applied', ...entry };
    }
    if (name === 'service_start_refund_automation_run') return { runId: 'synthetic-run' };
    if (name === 'service_claim_refund_automation_action') {
      const claimed = !state.actions.has(args.p_action_key);
      state.actions.add(args.p_action_key);
      return { claimed, actionId: 'synthetic-action' };
    }
    if (name.startsWith('service_finish_refund_automation_')) return true;
    throw new Error(`Unexpected RPC: ${name}`);
  }
  const supabase = {
    from: (table) => {
      assert(['refund_cases', 'refund_follow_up_cycles'].includes(table), `Unexpected table: ${table}`);
      const chain = {
        select: () => chain, eq: () => chain, not: () => chain,
        order: () => chain, limit: () => chain,
        maybeSingle: async () => ({ data: table === 'refund_cases' ? { ...state.current } : null, error: null }),
      };
      return chain;
    },
    rpc: async (name, args) => ({ data: await rpc(name, args), error: null }),
  };
  const lookup = execute(read('supabase/functions/_shared/automatic-nayax-lookup.ts'), {}, {
    './refund-deterministic-follow-up.ts': followUp,
    './nayax-lookup.ts': {
      lookupNayaxCandidatesForRefundCase: async ({ expectedFactVersion }) => {
        assert.equal(expectedFactVersion, state.current.deterministic_fact_version);
        state.lookups++;
        return { configured: true };
      },
    },
    './nayax-lookup-persistence.ts': {
      beginNayaxLookup: async ({ expectedFactVersion }) => {
        assert.equal(expectedFactVersion, state.current.deterministic_fact_version);
        return 1;
      },
      persistNayaxLookupResult: async () => {},
      failNayaxLookup: async () => { throw new Error('Unexpected lookup failure'); },
    },
  });
  const { apply } = execute(handlerSource, { supabase, rpc, ...extraction, ...classification, ...lookup });
  const run = (sourceMessageId = 'verified-message', body = 'Card type: Visa') => apply({
    refundCaseId: 'synthetic-case', sourceMessageId, body, sensitiveDataRedacted: false,
  });
  return { state, run };
}

test('actual handler recovers committed facts once; settled and concurrent replay never rerank twice', async () => {
  const { state, run } = harness();
  state.breakAfterCommit = true;
  await assert.rejects(run(), /interruption/);
  assert.equal(state.current.card_network, 'visa');
  assert.equal(state.current.deterministic_fact_version, 2);
  assert.equal(state.lookups, 0);
  await Promise.all([run(), run()]);
  await run();
  assert.equal(state.applications, 1);
  assert.equal(state.events, 1);
  assert.equal(state.lookups, 1);
  assert.equal(state.actions.size, 1);
});

test('fresh application and unchanged arbitrary reply do not duplicate lookup', async () => {
  const { state, run } = harness();
  await run();
  await run('different-message');
  await run('unstructured-message', 'Thank you');
  assert.equal(state.events, 1);
  assert.equal(state.lookups, 1);
  assert.equal(state.applications, 1);
});

test('old applied reply cannot overwrite or rerank newer facts', async () => {
  const { state, run } = harness();
  await run();
  state.current.card_network = 'mastercard';
  state.current.deterministic_fact_version = 3;
  const result = await run();
  assert.equal(result.allowRoutineContact, false);
  assert.equal(state.current.card_network, 'mastercard');
  assert.equal(state.lookups, 1);
  assert.equal(state.applications, 1);
});

test('fact drift between receipt and lookup read cannot claim newer version', async () => {
  const { state, run } = harness();
  state.breakAfterCommit = true;
  await assert.rejects(run(), /interruption/);
  state.driftAfterReceipt = true;
  await run();
  assert.equal(state.lookups, 0);
  assert.equal(state.actions.size, 0);
});

for (const receipt of [null, { outcome: 'conflict' }, { outcome: 'already_applied', factVersion: 2 },
  { outcome: 'already_applied', factVersion: 0, appliedFields: ['card_network'] }]) {
  test(`invalid/foreign/unverified receipt fails closed: ${JSON.stringify(receipt)}`, async () => {
    const { state, run } = harness();
    state.receiptOverride = receipt;
    await assert.rejects(run(), /receipt_invalid/);
    assert.equal(state.applications, 0);
    assert.equal(state.lookups, 0);
  });
}

test('payout-only receipt never reranks even if the current case is lookup-ready', async () => {
  const { state, run } = harness();
  state.receiptOverride = { outcome: 'already_applied', factVersion: 1, appliedFields: ['zelle_payment_contact'] };
  await run();
  assert.equal(state.lookups, 0);
  assert.equal(state.applications, 0);
});
