import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const load = (path) => {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  new Function('exports', 'React', source)(exports, React);
  return exports;
};
const { parseRefundReportFreshness } = load('src/lib/refundReportFreshness.ts');
const { RefundReportFreshnessAdvisory } = load('src/components/refunds/RefundReportFreshnessAdvisory.tsx');
const overdue = { status: 'needs_review', lastReceivedAt: '2026-09-03T18:00:00Z', reviewAfter: '2026-09-03T20:00:00Z', configuredCadenceMinutes: 60, reviewGraceMinutes: 120 };
const render = (freshness) => renderToStaticMarkup(React.createElement(RefundReportFreshnessAdvisory, { freshness }));

test('report health hides malformed or absent private data instead of inventing a healthy state', () => {
  assert.equal(parseRefundReportFreshness(null), null);
  assert.equal(parseRefundReportFreshness({ ...overdue, lastReceivedAt: 'invalid' }), null);
  assert.equal(parseRefundReportFreshness({ ...overdue, configuredCadenceMinutes: 10 }), null);
  assert.deepEqual(parseRefundReportFreshness(overdue), overdue);
});
test('one readable advisory names internal owner and local grace without send or payment controls', () => {
  const html = render(overdue);
  assert.equal((html.match(/<aside/g) ?? []).length, 1);
  assert.match(html, /Scheduled report needs review/);
  assert.match(html, /two-hour gap for internal review/);
  assert.match(html, /exact delivery timing is not confirmed/);
  assert.match(html, /Refund Operations: review the mailbox/);
  assert.doesNotMatch(html, /<button|role="alert"|<input/);
  assert.equal(render({ ...overdue, status: 'recent' }), '');
  assert.equal(render(null), '');
});
test('unobserved state does not invent a last delivery or a missed scheduled run', () => {
  const html = render({ ...overdue, status: 'unobserved', lastReceivedAt: null, reviewAfter: null });
  assert.match(html, /has not been recorded yet/);
  assert.doesNotMatch(html, /Last received|missed/);
});
