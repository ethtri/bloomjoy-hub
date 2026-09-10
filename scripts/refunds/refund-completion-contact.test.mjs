import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const helperSource = fs.readFileSync(new URL('../../src/lib/refundCompletionContact.ts', import.meta.url), 'utf8');
const compiled = ts.transpile(helperSource, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { getRefundCompletionContactPresentation } = await import(
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

test('progress and completion history cannot present review states as proved sent', () => {
  const progress = fs.readFileSync(
    new URL('../../src/components/refunds/RefundLifecycleProgress.tsx', import.meta.url),
    'utf8',
  );
  assert.match(progress, /contactComplete[\s\S]*state === 'sent'[\s\S]*state === 'delivered'/);
  assert.match(progress, /presentation\.contact\?\.tone === 'warning'/);

  const history = fs.readFileSync(new URL('../../src/pages/admin/Refunds.tsx', import.meta.url), 'utf8');
  assert.match(history, /completionContact\?\.progressLabel/);
  assert.match(history, /selectedCase\.lifecycle\?\.messageState\.lastUpdatedAt/);
  assert.match(history, /completionContact\.state === 'bounced'/);
  assert.match(history, /completionContact\.state === 'complained'/);
});
