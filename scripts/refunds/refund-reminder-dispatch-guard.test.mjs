import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
function execute(source, globals = {}, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, {
    exports, ...globals,
    require(name) {
      assert(Object.hasOwn(imports, name), `Unexpected dependency ${name}`);
      return imports[name];
    },
  }, { timeout: 1000 });
  return exports;
}

// Extract complete AST declarations from the real automatic sender. No copied
// control flow and no live credentials/provider clients enter this test.
const sweep = read('supabase/functions/refund-case-automation-sweep/index.ts');
const ast = ts.createSourceFile('sweep.ts', sweep, ts.ScriptTarget.Latest, true);
const names = ['logDeterministicFollowUpMessage', 'sendDeterministicFollowUpMessage'];
const senderSource = names.map((name) => {
  const statement = ast.statements.find((item) => ts.isVariableStatement(item) &&
    item.declarationList.declarations.some((declaration) => declaration.name.getText(ast) === name));
  assert(statement, `Actual sender declaration ${name} must exist`);
  return statement.getText(ast);
}).join('\n') + '\nexports.send = sendDeterministicFollowUpMessage;';
const delivery = execute(read('supabase/functions/_shared/refund-transactional-delivery.ts'));
const email = { subject: 'Synthetic reminder', text: 'Synthetic reminder only', html: '<p>Synthetic</p>' };
const acceptedReceipt = { providerMessageId: 'synthetic-resend-message', acceptedAt: '2026-09-02T12:00:00Z' };
class RefundGmailError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function harness(transport, { bounceAfterPending = false, bounceAfterProviderAccepted = false, confirmedGmailReplay = false } = {}) {
  const state = { requestDelivery: 'delivered', pending: null, marks: 0, claims: 0,
    transactionalSenderCalls: 0, gmailProviderCalls: 0, transactionalProviderCalls: 0,
    binds: 0, finishes: 0, updates: [], sequence: [], acceptanceBinding: null };
  const route = { recipientResolutionStatus: 'resolved', managerCcEmails: ['manager@example.invalid'],
    managerRecipientOverlap: false, managerRecipientCount: 1 };
  const supabase = {
    from(table) {
      let value;
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; },
        insert(input) { value = input; return query; },
        update(input) {
          state.updates.push(input);
          if (table === 'refund_case_messages') {
            state.pending = { ...state.pending, ...input };
            state.sequence.push(`bookkeeping-${input.status}`);
          }
          return query;
        },
        eq() { return query; },
        then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
        async single() {
          assert.equal(table, 'refund_case_messages');
          assert.equal(value.message_type, 'reminder');
          assert.equal(value.delivery_kind, 'automatic');
          assert.equal(value.follow_up_cycle_id, 'synthetic-cycle');
          assert.equal(state.requestDelivery, 'delivered');
          state.pending = { ...value, id: 'synthetic-reminder' };
          state.sequence.push('pending-created');
          if (bounceAfterPending) {
            state.requestDelivery = 'bounced';
            state.sequence.push('original-request-bounced');
          }
          return { data: { id: state.pending.id }, error: null };
        },
        async maybeSingle() {
          if (table === 'refund_gmail_threads') return { data: transport === 'gmail'
            ? { id: 'synthetic-thread', mailbox_hash: 'synthetic-mailbox-hash' } : null, error: null };
          assert.equal(table, 'refund_follow_up_cycles');
          return { data: { reminder_due_at: null }, error: null };
        },
      };
      return query;
    },
    async rpc(name, args) {
      if (name === 'service_authorize_refund_customer_outbound') return { data: { allowed: true, ...route }, error: null };
      if (name === 'service_bind_refund_transactional_delivery') {
        state.binds++;
        state.acceptanceBinding = { ...args };
        state.sequence.push('acceptance-bound');
        state.pending = { ...state.pending, delivery_transport: 'resend', delivery_state: 'accepted',
          provider_message_id: args.p_provider_message_id, delivery_state_updated_at: args.p_accepted_at };
        return { data: { bound: true, payloadRedacted: true }, error: null };
      }
      if (name === 'service_finish_refund_gmail_outbound') {
        state.finishes++; return { data: true, error: null };
      }
      assert(['service_mark_refund_transactional_delivery_attempt', 'service_claim_refund_gmail_outbound_v3'].includes(name));
      state.sequence.push(name);
      if (name === 'service_mark_refund_transactional_delivery_attempt') state.marks++;
      else state.claims++;
      // Database eligibility is proved by the disposable SQL RPC tests. This
      // seam supplies their exact rejection and proves actual sender behavior.
      if (confirmedGmailReplay && name === 'service_claim_refund_gmail_outbound_v3') {
        return { data: { linked: true, claimed: false, reconciled: true, status: 'sent', subject: email.subject, ...route }, error: null };
      }
      if (state.requestDelivery === 'bounced') return { data: null,
        error: { code: '23514', message: 'Follow-up reminder requires a non-failed original request' } };
      if (name === 'service_mark_refund_transactional_delivery_attempt') return { data: { marked: true, payloadRedacted: true }, error: null };
      return { data: { linked: true, claimed: true, transportMessageId: 'synthetic-outbound',
        providerThreadId: 'synthetic-provider-thread', subject: email.subject, ...route }, error: null };
    },
  };
  const gmail = execute(read('supabase/functions/_shared/refund-gmail-transport.ts'), {}, {
    './refund-gmail.ts': {
      RefundGmailError,
      getRefundGmailConfig: () => ({ mailbox: 'mailbox@example.invalid', mailboxIdentities: ['mailbox@example.invalid'] }),
      getRefundGmailMailboxIdentities: () => ['mailbox@example.invalid'],
      requireRefundGmailEnabled() {}, sha256Hex: async () => 'synthetic-mailbox-hash',
      sendRefundGmailReply: async () => { state.gmailProviderCalls++; return { providerMessageId: 'synthetic-provider-message' }; },
    },
    './refund-deterministic-follow-up.ts': { automaticRefundCustomerContactEnabled: () => true },
    './refund-synthetic-gmail-proof.ts': { verifyRefundSyntheticGmailProofTransport: async () => ({ required: false }) },
    './refund-email.ts': { redactRefundStatusLinksForStorage: (value) => value },
  });
  const sender = execute(senderSource, {
    supabase, RefundGmailError, console: { error() {} },
    automaticCustomerContactAllowed: async () => true,
    messageTypeForFollowUp: () => 'reminder',
    tryIssueRefundStatusCapability: async () => null,
    buildFollowUpEmailInput: () => ({}), buildRefundCustomerEmail: () => email,
    refundFollowUpTemplateKey: () => 'synthetic-reminder-v1',
    redactRefundStatusLinksForStorage: (value) => value,
    resolveFollowUpGmailThreadId: async () => transport === 'gmail' ? 'synthetic-thread' : null,
    dispatchRefundCaseGmailReply: gmail.dispatchRefundCaseGmailReply,
    ...delivery,
    sendRefundCustomerEmail: async () => {
      state.transactionalSenderCalls++;
      state.transactionalProviderCalls++;
      state.sequence.push('provider-accepted');
      if (bounceAfterProviderAccepted) {
        state.requestDelivery = 'bounced';
        state.sequence.push('original-request-bounced');
      }
      return { delivery: acceptedReceipt };
    },
    textValue: (value) => typeof value === 'string' ? value.trim() : '',
  });
  return { state, send: () => sender.send({ id: 'synthetic-case', customer_email: 'customer@example.invalid' },
    { id: 'synthetic-cycle', requestedFields: [], reasonCode: 'missing_information', templateVersion: 'synthetic-v1' }, 'reminder') };
}

for (const transport of ['resend', 'gmail']) {
  test(`${transport}: original bounce after pending creation causes ZERO provider/sender calls`, async () => {
    const { state, send } = harness(transport, { bounceAfterPending: true });
    assert.equal((await send()).status, 'failed');
    assert.deepEqual(state.sequence.slice(0, 2), ['pending-created', 'original-request-bounced']);
    assert.equal(state.marks, transport === 'resend' ? 1 : 0);
    assert.equal(state.claims, transport === 'gmail' ? 1 : 0);
    assert.equal(state.transactionalSenderCalls, 0);
    assert.equal(state.transactionalProviderCalls, 0);
    assert.equal(state.gmailProviderCalls, 0);
    assert.equal(state.binds + state.finishes, 0);
    assert.equal(state.updates.some((update) => update.status === 'sent'), false);
  });
  test(`${transport}: healthy original positive control reaches exactly one provider boundary`, async () => {
    const { state, send } = harness(transport);
    assert.equal((await send()).status, 'sent');
    assert.equal(state.transactionalProviderCalls, transport === 'resend' ? 1 : 0);
    assert.equal(state.gmailProviderCalls, transport === 'gmail' ? 1 : 0);
  });
}
test('confirmed Gmail SENT reconciliation after original bounce does not resend or use fallback', async () => {
  const { state, send } = harness('gmail', { bounceAfterPending: true, confirmedGmailReplay: true });
  assert.equal((await send()).status, 'sent');
  assert.equal(state.claims, 1);
  assert.equal(state.marks + state.transactionalSenderCalls + state.transactionalProviderCalls + state.gmailProviderCalls, 0);
  assert.equal(state.binds + state.finishes, 0);
});

test('Resend acceptance before original bounce is bound and reconciled SENT exactly once, not labelled failed or resent', async () => {
  const { state, send } = harness('resend', { bounceAfterProviderAccepted: true });
  assert.equal((await send()).status, 'sent');
  assert.deepEqual(state.sequence, [
    'pending-created', 'service_mark_refund_transactional_delivery_attempt',
    'provider-accepted', 'original-request-bounced', 'acceptance-bound', 'bookkeeping-sent',
  ]);
  assert.equal(state.requestDelivery, 'bounced');
  assert.equal(state.marks, 1);
  assert.equal(state.transactionalSenderCalls, 1);
  assert.equal(state.transactionalProviderCalls, 1);
  assert.equal(state.gmailProviderCalls + state.claims + state.finishes, 0);
  assert.equal(state.binds, 1);
  assert.deepEqual(state.acceptanceBinding, {
    p_refund_case_message_id: 'synthetic-reminder',
    p_provider_message_id: acceptedReceipt.providerMessageId,
    p_accepted_at: acceptedReceipt.acceptedAt,
  });
  assert.equal(state.pending.status, 'sent');
  assert.equal(state.pending.delivery_transport, 'resend');
  assert.equal(state.pending.delivery_state, 'accepted');
  assert.equal(state.pending.provider_message_id, acceptedReceipt.providerMessageId);
  assert.equal(state.pending.delivery_state_updated_at, acceptedReceipt.acceptedAt);
  assert.equal(state.updates.length, 1);
  assert.equal(state.updates.some((update) => update.status === 'failed'), false);
  assert.equal(state.updates.some((update) => 'provider_message_id' in update ||
    'delivery_transport' in update || 'delivery_state' in update || 'delivery_state_updated_at' in update), false);
});

test('forward-only RPC definitions preserve previous logic with only the new pre-provider gate', () => {
  const forward = read('supabase/migrations/20260902182311_refund_all_message_delivery_bookkeeping.sql').replaceAll('\r\n', '\n');
  const extract = (text, name) => {
    const start = text.indexOf(`create or replace function public.${name}(`);
    const end = text.indexOf('\n$$;', start);
    assert(start >= 0 && end > start);
    return text.slice(start, end + 4);
  };
  for (const [name, historical] of [
    ['service_mark_refund_transactional_delivery_attempt', '20260901070000_refund_transactional_delivery_truth.sql'],
    ['service_claim_refund_gmail_outbound_v3', '202608030005_refund_deterministic_follow_up_cycles.sql'],
  ]) {
    const actual = extract(forward, name);
    const begin = actual.indexOf('\n  -- Recheck the original request at the last database boundary');
    const end = actual.indexOf('\n  end if;', begin) + '\n  end if;'.length;
    assert(begin > 0 && end > begin);
    const gate = actual.slice(begin, end);
    for (const predicate of ['cycle.id = message_row.follow_up_cycle_id', 'cycle.refund_case_id = message_row.refund_case_id',
      'request.id = cycle.request_message_id', 'request.refund_case_id = message_row.refund_case_id',
      'request.follow_up_cycle_id = cycle.id', "request.status = 'sent'", 'request.sent_at = cycle.request_sent_at',
      "request.delivery_state not in ('failed', 'bounced', 'complained')"]) assert(gate.includes(predicate));
    assert.equal((actual.slice(0, begin) + actual.slice(end)).replace(/\n{3,}/g, '\n\n'),
      extract(read(`supabase/migrations/${historical}`).replaceAll('\r\n', '\n'), name));
    if (name.includes('gmail')) assert(actual.indexOf("outbound_row.status = 'sent'") < begin);
  }
});
