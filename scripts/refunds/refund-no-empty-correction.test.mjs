import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../../supabase/functions/refund-case-automation-sweep/index.ts', import.meta.url), 'utf8');
const reconciliationMigration = await readFile(
  new URL('../../supabase/migrations/20260929193000_refund_reconciliation_clarification.sql', import.meta.url),
  'utf8',
);
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const functionSource = (name, next) => {
  const start = compiled.indexOf(`const ${name} =`);
  const end = compiled.indexOf(`const ${next} =`);
  assert(start >= 0 && end > start, `Missing function boundary for ${name}`);
  return compiled.slice(start, end);
};

test('an exact reconciliation reply is selected before the older correction lane', () => {
  const receiverStart = reconciliationMigration.indexOf(
    'create or replace function public.service_receive_refund_scoped_email_reply',
  );
  const receiverEnd = reconciliationMigration.indexOf(
    '-- Once Bloomjoy asks this pair-specific question',
    receiverStart,
  );
  const receiver = reconciliationMigration.slice(receiverStart, receiverEnd);
  assert(receiverStart >= 0 && receiverEnd > receiverStart);
  assert(receiver.indexOf('matched_review_count') >= 0);
  assert.match(receiver, /matched_review_count=0 then[\s\S]*service_receive_refund_reply_pre_recon_v1/);
  assert.match(receiver, /clarification_reminder_message_id/);
});

test('ordinary sweep queries old schema only for an exact missing RPC and scopes new schema to original payments', async () => {
  for (const code of ['PGRST202', '42883', null, '42501']) {
    const filters = [];
    const chain = { select: () => chain, eq: (...args) => { filters.push(args); return chain; } };
    const scope = new Function('supabase', `
      const caseSelect = 'fixture-columns'; let giftCardSchemaPresent = true;
      ${functionSource('checkGiftCardSchema', 'startRun')}
      return { check: checkGiftCardSchema, select: selectOriginalPaymentCases };
    `)({ rpc: async () => ({ data: false, error: code ? { code } : null }), from: () => chain });
    if (code === '42501') {
      await assert.rejects(scope.check()); assert.deepEqual(filters, []);
    } else {
      await scope.check(); scope.select();
      assert.deepEqual(filters, code ? [] : [['resolution_method', 'original_payment']]);
    }
  }
});

test('actual persisted-result sweep routes an empty no-match internally without claiming customer contact', async () => {
  const calls = [];
  const fixture = { id: 'case-fixture', payment_method: 'card', card_wallet_used: false, status: 'needs_review', nayax_recommendation_state: 'no_safe_match', deterministic_fact_version: 1 };
  const query = (table) => {
    const chain = { then: (resolve) => resolve({ data: table === 'refund_cases' ? [fixture] : null, error: null }) };
    for (const key of ['select', 'eq', 'in', 'limit', 'update']) chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    return chain;
  };
  const run = new Function('supabase', 'normalizeRefundSweepCase', 'getPersistedNayaxCorrectionEvidence', 'deriveNayaxCustomerCorrectionFields', 'routeProviderException', 'routeFollowUpManualReview', 'claimAction', 'claimFollowUpCycle', 'sendDeterministicFollowUpMessage', `
    const caseSelect = 'fixture-columns';
    const giftCardSchemaPresent = true;
    ${functionSource('selectOriginalPaymentCases', 'startRun')}
    ${functionSource('runPersistedNayaxCustomerCorrectionSweep', 'runWalletCorrectionExpirySweep')}
    return runPersistedNayaxCustomerCorrectionSweep;
  `)(
    { from: query }, (value) => value, async () => [], () => [],
    async () => { throw new Error('configured no-match must not route a provider setup notice'); },
    async (input) => { calls.push(['internal-review', input.actionKeySuffix]); },
    async () => { throw new Error('must not claim a customer action'); },
    async () => { throw new Error('must not create a follow-up cycle'); },
    async () => { throw new Error('must not send a customer message'); },
  );
  await run('run-fixture', {}, 'window-fixture');
  assert(calls.some(([table, op, field, value]) => table === 'refund_cases' && op === 'eq' && field === 'resolution_method' && value === 'original_payment'));
  assert(calls.some(([table, op, value]) => table === 'refund_follow_up_cycles' && op === 'update' && value.status === 'manual_review'));
  assert.deepEqual(calls.filter(([kind]) => kind === 'internal-review'), [['internal-review', 'no-customer-correction:v1']]);
});

test('a persisted setup-needed result reuses the provider exception route instead of sending a generic manager notice', async () => {
  const calls = [];
  const fixture = {
    id: 'case-fixture', payment_method: 'card', card_wallet_used: false,
    status: 'needs_review', correlation_status: 'nayax_not_configured',
    nayax_recommendation_state: 'manual_exception', deterministic_fact_version: 7,
  };
  const query = (table) => {
    const chain = { then: (resolve) => resolve({ data: table === 'refund_cases' ? [fixture] : null, error: null }) };
    for (const key of ['select', 'eq', 'in', 'limit', 'update']) chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    return chain;
  };
  const run = new Function('supabase', 'normalizeRefundSweepCase', 'getPersistedNayaxCorrectionEvidence', 'deriveNayaxCustomerCorrectionFields', 'routeProviderException', 'routeFollowUpManualReview', 'claimAction', 'claimFollowUpCycle', 'sendDeterministicFollowUpMessage', `
    const caseSelect = 'fixture-columns';
    const giftCardSchemaPresent = true;
    ${functionSource('selectOriginalPaymentCases', 'startRun')}
    ${functionSource('runPersistedNayaxCustomerCorrectionSweep', 'runWalletCorrectionExpirySweep')}
    return runPersistedNayaxCustomerCorrectionSweep;
  `)(
    { from: query }, (value) => value, async () => [], () => [],
    async (input) => { calls.push(['provider-exception', input.reasonCategory, input.refundCase.deterministic_fact_version]); },
    async () => { throw new Error('setup-needed must not send a generic manager notice'); },
    async () => { throw new Error('must not claim a customer action'); },
    async () => { throw new Error('must not create a follow-up cycle'); },
    async () => { throw new Error('must not send a customer message'); },
  );
  await run('run-fixture', {}, 'window-fixture');
  assert(calls.some(([table, op, field, value]) => table === 'refund_cases' && op === 'eq' && field === 'resolution_method' && value === 'original_payment'));
  assert.deepEqual(calls.filter(([kind]) => kind === 'provider-exception'), [['provider-exception', 'provider_setup', 7]]);
  assert.equal(calls.some(([kind]) => kind === 'internal-review'), false);
});

test('the actual provider route reserves one manager delivery for an unchanged setup-needed fact version', async () => {
  const actionKeys = [];
  const sends = [];
  let claimed = false;
  const supabase = {
    rpc: async (name, input) => {
      assert.equal(name, 'service_claim_refund_provider_exception_action');
      actionKeys.push(input.p_action_key);
      if (claimed) return { data: { actionId: 'action-fixture', claimed: false, status: 'completed' }, error: null };
      claimed = true;
      return { data: { actionId: 'action-fixture', claimed: true, status: 'claimed' }, error: null };
    },
  };
  const route = new Function('supabase', 'textValue', 'addReason', 'sendFollowUpManagerNotice', 'finishAction', `
    ${functionSource('routeProviderException', 'routeFollowUpManualReview')}
    return routeProviderException;
  `)(
    supabase,
    (value) => typeof value === 'string' ? value : '',
    () => {},
    async (input) => { sends.push(input.noticeKind); },
    async () => {},
  );
  const refundCase = { id: 'case-fixture', deterministic_fact_version: 7 };
  const counters = { actionsAttempted: 0, actionsSuppressed: 0, providerExceptionsSent: 0 };
  await route({ runId: 'run-1', refundCase, reasonCategory: 'provider_setup', counters });
  await route({ runId: 'run-2', refundCase, reasonCategory: 'provider_setup', counters });
  assert.deepEqual(actionKeys, [
    'provider_exception:case-fixture:provider_setup:7',
    'provider_exception:case-fixture:provider_setup:7',
  ]);
  assert.deepEqual(sends, ['provider_setup']);
  assert.equal(counters.providerExceptionsSent, 1);
});

test('actual shared send boundary rejects empty card requests and reminders before any effect', async () => {
  const send = new Function('supabase', 'automaticCustomerContactAllowed', 'messageTypeForFollowUp', 'refundCorrectionLinksEnabled',
    `${functionSource('sendDeterministicFollowUpMessage', 'sendCustomerStatusUpdate')} return sendDeterministicFollowUpMessage;`
  )({}, async () => true, () => 'no_safe_match', async () => false);
  for (const messageClass of ['request', 'reminder']) {
    await assert.rejects(send({ payment_method: 'card' }, { reasonCode: 'no_safe_match' }, messageClass, []), /specific customer-correctable fact/);
  }
});

test('only an initial-request suppression settles the exact claimed cycle before returning', async () => {
  const rpcCalls = [];
  let contactAllowed = false;
  const supabase = {
    rpc: async (name, input) => {
      rpcCalls.push([name, input]);
      return { data: { settled: true, idempotentReplay: false }, error: null };
    },
  };
  const send = new Function(
    'supabase',
    'automaticCustomerContactAllowed',
    'messageTypeForFollowUp',
    'refundCorrectionLinksEnabled',
    'getCurrentRefundCorrectionFields',
    `${functionSource('settleFollowUpPreMessageSuppression', 'sendCustomerStatusUpdate')}
    return sendDeterministicFollowUpMessage;`,
  )(
    supabase,
    async () => contactAllowed,
    () => 'no_safe_match',
    async () => true,
    async () => [],
  );
  const refundCase = { id: 'case-fixture', payment_method: 'card' };
  const cycle = { id: 'cycle-fixture', reasonCode: 'no_safe_match' };

  assert.deepEqual(await send(refundCase, cycle, 'request', []), {
    status: 'suppressed', messageId: null,
  });
  contactAllowed = true;
  assert.deepEqual(await send(refundCase, cycle, 'request', ['incident_date']), {
    status: 'suppressed', messageId: null,
  });
  contactAllowed = false;
  assert.deepEqual(await send(refundCase, cycle, 'reminder', []), {
    status: 'suppressed', messageId: null,
  });
  assert.deepEqual(await send(refundCase, cycle, 'information_received', []), {
    status: 'suppressed', messageId: null,
  });
  contactAllowed = true;
  assert.deepEqual(await send(refundCase, cycle, 'reminder', ['incident_date']), {
    status: 'suppressed', messageId: null,
  });
  assert.deepEqual(rpcCalls, [
    [
      'service_settle_refund_follow_up_pre_message_suppression',
      {
        p_refund_case_id: 'case-fixture',
        p_cycle_id: 'cycle-fixture',
        p_reason: 'automatic_customer_contact_disabled',
      },
    ],
    [
      'service_settle_refund_follow_up_pre_message_suppression',
      {
        p_refund_case_id: 'case-fixture',
        p_cycle_id: 'cycle-fixture',
        p_reason: 'no_customer_correctable_fact',
      },
    ],
  ]);
});

test('a transient contact-policy read failure is not recorded as durable policy suppression', async () => {
  const rpcCalls = [];
  const send = new Function(
    'supabase',
    'automaticCustomerContactAllowed',
    'messageTypeForFollowUp',
    'refundCorrectionLinksEnabled',
    'getCurrentRefundCorrectionFields',
    `${functionSource('settleFollowUpPreMessageSuppression', 'sendCustomerStatusUpdate')}
    return sendDeterministicFollowUpMessage;`,
  )(
    { rpc: async (...args) => { rpcCalls.push(args); return { data: null, error: null }; } },
    async () => { throw new Error('automatic_customer_contact_gate_unavailable'); },
    () => 'more_info',
    async () => false,
    async () => [],
  );

  await assert.rejects(
    send({ id: 'case-fixture' }, { id: 'cycle-fixture' }, 'request', []),
    /automatic_customer_contact_gate_unavailable/,
  );
  assert.deepEqual(rpcCalls, []);
});

test('persisted correction evidence is restricted to current unexpired lookup generation', async () => {
  const calls = [];
  const chain = { then: (resolve) => resolve({ data: [], error: null }) };
  for (const key of ['select', 'eq', 'gt', 'order', 'limit']) chain[key] = (...args) => { calls.push([key, ...args]); return chain; };
  const read = new Function('supabase', `${functionSource('getPersistedNayaxCorrectionEvidence', 'runCardNayaxLookupSweep')} return getPersistedNayaxCorrectionEvidence;`)({ from: () => chain });
  const fixture = { id: 'case-fixture', nayax_lookup_generation: 3, nayax_lookup_status: 'no_match', nayax_recommendation_evaluated_at: '2026-09-03T19:24:00Z', deterministic_facts_updated_at: '2026-09-03T19:00:00Z' };
  await read(fixture);
  assert(calls.some(([op, field, value]) => op === 'eq' && field === 'lookup_generation' && value === 3));
  assert(calls.some(([op, field]) => op === 'gt' && field === 'expires_at'));
  calls.length = 0;
  await read({ ...fixture, deterministic_facts_updated_at: '2026-09-03T19:30:00Z' });
  await read({ ...fixture, nayax_lookup_status: 'checking' });
  assert.equal(calls.length, 0, 'stale facts or a running newer lookup cannot reuse old conflict evidence');
});

test('actual due-reminder sweep stops empty correction and returns waiting case to internal review', async () => {
  const calls = [];
  const cycle = { id: 'cycle-fixture', reasonCode: 'no_safe_match' };
  const fixture = { id: 'case-fixture', payment_method: 'card', status: 'waiting_on_customer', deterministic_fact_version: 1 };
  const query = (table) => {
    const chain = { then: (resolve) => resolve({ error: null }) };
    for (const key of ['eq', 'in', 'update', 'insert']) chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    return chain;
  };
  const supabase = { from: query, rpc: async () => ({ data: { enabled: true, reminders: [{ cycleId: cycle.id, refundCaseId: fixture.id }] }, error: null }) };
  const claimAction = async () => ({ claimed: true });
  const finishAction = async (...args) => { calls.push(['finish', ...args]); };
  const route = new Function('supabase', 'claimAction', 'sendFollowUpManagerNotice', 'finishAction', `${functionSource('routeFollowUpManualReview', 'getPortalBaseUrl')} return routeFollowUpManualReview;`)(supabase, claimAction, async () => {}, finishAction);
  const run = new Function('supabase', 'normalizeFollowUpCycle', 'getSweepCase', 'claimAction', 'deriveNayaxCustomerCorrectionFields', 'getPersistedNayaxCorrectionEvidence', 'routeFollowUpManualReview', 'finishAction', `
    const automaticCustomerContactEnabled = true;
    const textValue = value => typeof value === 'string' ? value : '';
    ${functionSource('runReminderSweep', 'sendPayoutDestinationReminder')}
    return runReminderSweep;
  `)(supabase, () => cycle, async () => fixture, claimAction, () => [], async () => [], route, finishAction);
  await run('run-fixture', { evaluatedCaseIds: new Set() }, 'window-fixture');
  assert(calls.some(([table, op, value]) => table === 'refund_follow_up_cycles' && op === 'update' && value.status === 'manual_review'));
  assert(calls.some(([table, op, value]) => table === 'refund_cases' && op === 'update' && value.status === 'needs_review' && value.automation_follow_up_due_at === null));
  assert(calls.some(([kind, , status, reason]) => kind === 'finish' && status === 'suppressed' && reason === 'no_customer_correctable_fact'));
});

test('pair clarification reminder reuses one claimed customer-reminder action and the existing outbox', async () => {
  const calls = [];
  const review = {
    id: 'review-fixture',
    clarification_anchor_case_id: 'case-fixture',
    clarification_reminder_due_at: '2026-09-20T00:00:00Z',
  };
  const query = (table) => {
    const chain = {
      then: (resolve) => resolve({
        data: table === 'refund_case_reconciliation_reviews' ? [review] : null,
        error: null,
      }),
      single: async () => ({ data: { status: 'sent', manual_delivery_state: 'sent' }, error: null }),
    };
    for (const key of ['select', 'eq', 'is', 'not', 'lte', 'order', 'limit']) {
      chain[key] = (...args) => { calls.push([table, key, ...args]); return chain; };
    }
    return chain;
  };
  const run = new Function(
    'supabase',
    'automaticCustomerContactAllowed',
    'textValue',
    'getSweepCase',
    'claimAction',
    'runManualMessageOutboxSweep',
    'finishAction',
    `${functionSource('runReconciliationClarificationReminderSweep', 'sendPayoutDestinationReminder')}
    return runReconciliationClarificationReminderSweep;`,
  )(
    {
      from: query,
      rpc: async (name, input) => {
        calls.push(['rpc', name, input]);
        return { data: { enqueued: true, messageId: 'message-fixture' }, error: null };
      },
    },
    async () => true,
    (value) => typeof value === 'string' ? value : '',
    async () => ({ id: 'case-fixture', status: 'needs_review', official_action_version: 3 }),
    async (...args) => { calls.push(['claim', ...args]); return { claimed: true, id: 'action-fixture' }; },
    async (...args) => { calls.push(['outbox', ...args]); },
    async (...args) => { calls.push(['finish', ...args]); },
  );
  await run('run-fixture', { evaluatedCaseIds: new Set() }, '2026-09-29T00:00:00Z');
  assert(calls.some(([kind, , , actionKey, actionType]) =>
    kind === 'claim' && actionKey === 'reconciliation-clarification-reminder:review-fixture' &&
      actionType === 'customer_reminder'));
  assert(calls.some(([kind, name]) =>
    kind === 'rpc' && name === 'service_enqueue_refund_reconciliation_clarification'));
  assert(calls.some(([kind, , outcome, reason, messageId]) =>
    kind === 'finish' && outcome === 'completed' && reason === 'reminder_sent' &&
      messageId === 'message-fixture'));
});
