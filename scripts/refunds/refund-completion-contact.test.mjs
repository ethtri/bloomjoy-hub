import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const helperSource = fs.readFileSync(new URL('../../src/lib/refundCompletionContact.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(helperSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { getRefundCompletionContactPresentation, getRefundCompletionHistoryPresentation } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test('all completion contact outcomes use one truthful presentation vocabulary', () => {
  const expected = {
    none: 'Refund confirmed · update needs preparation',
    pending: 'Refund confirmed · update queued',
    sent: 'Refund confirmed · update sent',
    delivered: 'Refund confirmed · update delivered',
    failed: 'Refund confirmed · update could not be sent',
    delivery_unconfirmed: 'Refund confirmed · update outcome unconfirmed',
    bounced: 'Refund confirmed · contact needs review',
    complained: 'Refund confirmed · contact needs review',
  };
  for (const [state, label] of Object.entries(expected)) {
    const presentation = getRefundCompletionContactPresentation({ messageState: { state } });
    assert.equal(presentation.label, label);
    assert.equal(/customer updated/i.test(JSON.stringify(presentation)), false);
    assert.match(presentation.nextAction, /Do not retry payment/);
  }
});

test('source surfaces do not retain the overstated customer-updated phrase', () => {
  for (const file of [
    '../../src/lib/refundManagerState.ts',
    '../../src/lib/refundLifecyclePresentation.ts',
    '../../src/pages/admin/Refunds.tsx',
  ]) {
    assert.doesNotMatch(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), /customer updated/i);
  }
});

test('progress cannot present review states as proved sent', () => {
  const progress = fs.readFileSync(
    new URL('../../src/components/refunds/RefundLifecycleProgress.tsx', import.meta.url),
    'utf8',
  );
  assert.match(progress, /contactComplete[\s\S]*state === 'sent'[\s\S]*state === 'delivered'/);
  assert.match(progress, /presentation\.contact\?\.tone === 'warning'/);

});

test('multiple completion history rows retain their own neutral record identity and timestamp', () => {
  const latestCaseContact = { state: 'delivered', lastUpdatedAt: '2026-09-10T13:00:00Z' };
  const messages = [
    { id: 'pending-old', messageType: 'completed', status: 'pending', createdAt: '2026-09-10T10:00:00Z' },
    { id: 'failed-middle', messageType: 'completed', status: 'failed', createdAt: '2026-09-10T11:00:00Z' },
    { id: 'sent-newer', messageType: 'completed', status: 'sent', createdAt: '2026-09-10T12:00:00Z' },
  ];
  const rows = messages.map((message) => ({
    id: message.id,
    ...getRefundCompletionHistoryPresentation(message),
  }));
  assert.deepEqual(rows.map(({ badgeLabel }) => badgeLabel), [
    'Completion update record', 'Completion update record', 'Completion update record',
  ]);
  assert.deepEqual(rows.map(({ recordedAt }) => recordedAt), messages.map(({ createdAt }) => createdAt));
  assert.equal(JSON.stringify(rows).includes(latestCaseContact.state), false);
  assert.equal(JSON.stringify(rows).includes(latestCaseContact.lastUpdatedAt), false);
  assert.equal(rows.some(({ badgeLabel }) => /sent|delivered|bounced|failed/i.test(badgeLabel)), false);
});

test('completion history keeps its neutral application record beside per-message provider delivery truth', () => {
  const refunds = fs.readFileSync(
    new URL('../../src/pages/admin/Refunds.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    refunds,
    /message\.deliveryTransport === 'resend' && \(\s*<Badge[\s\S]*?data-testid=\{`refund-message-delivery-\$\{message\.id\}`\}[\s\S]*?transactionalDeliveryLabel\(message\.deliveryState\)/,
  );
  assert.doesNotMatch(refunds, /message\.deliveryTransport === 'resend' && !completionHistory/);
});
