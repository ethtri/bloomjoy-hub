import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createServer } from 'vite';

let vite;
let identity;
let providerNetwork;
let PurchaseReview;
test.before(async () => {
  vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false } });
  ({ getRefundPurchaseReviewIdentity: identity, getRefundProviderCardNetwork: providerNetwork } = await vite.ssrLoadModule('/src/lib/refundPurchaseReviewIdentity.ts'));
  ({ RefundPurchaseReview: PurchaseReview } = await vite.ssrLoadModule('/src/components/refunds/RefundPurchaseReview.tsx'));
});
test.after(async () => { await vite?.close(); });

const saved = {
  transactionId: 'synthetic-provider-A', saleAmountCents: 1060, currencyCode: 'USD',
  providerAuthorizedAt: '2026-09-20T21:03:00Z', cardLast4: '0000', cardNetwork: 'visa',
  machineLabel: 'Synthetic machine', locationName: 'Synthetic venue', evidenceSource: 'nayax_last_sales',
  matchFactors: [{ key: 'machine', outcome: 'match', label: 'Saved A evidence' }],
};
const candidate = (overrides = {}) => ({
  candidateToken: 'synthetic-token-B', amountCents: 1060, currencyCode: 'USD',
  authorizedAt: saved.providerAuthorizedAt, machineAuthorizationTime: saved.providerAuthorizedAt,
  cardLast4: saved.cardLast4, cardBrand: 'Visa', paymentStatus: 'approved', selectionAllowed: true,
  machineDisplayLabel: 'Synthetic machine', matchFactors: [{ key: 'machine', outcome: 'match', label: 'Candidate B evidence' }],
  ...overrides,
});
const input = (overrides = {}) => ({ candidates: [candidate()], selectedToken: '', savedSelection: saved, hasSavedSelection: true, ...overrides });

test('identical amount, time and card digits do not attach candidate B evidence to saved A', () => {
  const view = identity(input({ recommendedCandidate: candidate() }));
  assert.equal(view.candidate, null);
  assert.equal(view.selected, saved);
  assert.equal(view.locallySelected, false);
});

test('an explicit exact returned token chooses draft B and keeps saved A separate', () => {
  const alternate = candidate({ amountCents: 1090 });
  const view = identity(input({ candidates: [alternate], selectedToken: alternate.candidateToken }));
  assert.equal(view.candidate, alternate);
  assert.equal(view.selected, null);
  assert.equal(view.locallySelected, true);
  assert.equal(view.candidate.amountCents, 1090);
  assert.equal(saved.transactionId, 'synthetic-provider-A');
  assert.equal(saved.saleAmountCents, 1060);
  const html = renderToStaticMarkup(React.createElement(PurchaseReview, {
    refundCase: { paymentAmountCents: 1000, cardLast4: '0000', cardNetwork: 'visa', machineLabel: 'Synthetic machine', locationName: 'Synthetic venue', events: [] },
    ...view, timezone: 'America/New_York', customerTime: 'Customer estimate', customerTimeConfidence: 'Approximate',
    customerPayment: 'Contactless', customerDigitsSource: 'Wallet digits',
  }));
  assert.match(html, /not yet saved/);
  assert.match(html, /Candidate B evidence/);
  assert.match(html, /\$10\.90/);
  assert.doesNotMatch(html, /synthetic-provider-A|Saved A evidence|Saved Nayax Last Sales evidence/);
});

test('expired or unknown draft tokens cannot silently display a different purchase', () => {
  for (const selectedToken of ['expired-token', 'synthetic-token']) {
    const view = identity(input({ selectedToken, recommendedCandidate: candidate() }));
    assert.equal(view.candidate, null);
    assert.equal(view.selected, null);
    assert.equal(view.locallySelected, false);
    assert.equal(view.draftUnavailable, true);
  }
});

test('legacy review suppresses prior selected and candidate evidence', () => {
  const view = identity(input({ selectedToken: candidate().candidateToken, legacyReviewRequired: true }));
  assert.equal(view.candidate, null);
  assert.equal(view.selected, null);
  assert.equal(view.locallySelected, false);
});

test('provider brand supplies a known network without guessing unknown brands or overriding known network', () => {
  assert.equal(providerNetwork({ cardBrand: 'Visa' }), 'visa');
  assert.equal(providerNetwork({ cardNetwork: null, cardBrand: 'Master Card' }), 'mastercard');
  assert.equal(providerNetwork({ cardNetwork: 'other_unknown', cardBrand: 'American Express' }), 'american_express');
  assert.equal(providerNetwork({ cardNetwork: 'visa', cardBrand: 'Mastercard' }), 'visa');
  assert.equal(providerNetwork({ cardBrand: 'unknown provider label' }), null);
  assert.equal(providerNetwork({ cardNetwork: 'other_unknown' }), 'other_unknown');
});

// Execute the actual canonical page preamble to catch wiring that might restore
// tuple-based inference or pass saved A alongside local draft B.
const pageFile = 'src/pages/admin/Refunds.tsx';
const ast = ts.createSourceFile(pageFile, fs.readFileSync(pageFile, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = (name) => {
  let found;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) found = node;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(found, name);
  return found;
};
const renderBody = declaration('renderCardDecisionWorkbench').initializer.body;
const identityStatements = [];
for (const statement of renderBody.statements) {
  if (statement.getText(ast).startsWith('const incidentTimezone')) break;
  identityStatements.push(statement.getText(ast));
}
const compiled = ts.transpileModule(`const renderBoundary = () => { ${identityStatements.join('\n')}
  return { candidate: comparisonCandidate, selected: selectedTransactionEvidence, locallySelected: hasLocallySelectedPurchase, draftUnavailable };
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const actualPageIdentity = (selectedToken = '') => {
  const env = {
    selectedCase: { paymentMethod: 'card', hasMatchedNayaxTransaction: true, selectedNayaxTransaction: saved },
    editor: { clearNayaxMatch: false, matchedNayaxCandidateToken: selectedToken },
    selectedCaseNeedsLegacyPaymentReview: false, primaryAction: null,
    nayaxCandidates: [candidate({ amountCents: 1090 })], hasSelectedCardEvidence: () => true,
    getRefundPurchaseReviewIdentity: identity,
  };
  return new Function(...Object.keys(env), `${compiled}\nreturn renderBoundary();`)(...Object.values(env));
};

test('canonical page wiring passes exclusively saved A or draft B, with the correct draft label', () => {
  const savedView = actualPageIdentity();
  assert.equal(savedView.selected, saved);
  assert.equal(savedView.candidate, null);
  const draftView = actualPageIdentity(candidate().candidateToken);
  assert.equal(draftView.selected, null);
  assert.equal(draftView.locallySelected, true);
  assert.equal(draftView.candidate.candidateToken, candidate().candidateToken);
  assert.equal(draftView.candidate.amountCents, 1090);
});

test('shortlist metadata uses fresh authoritative lookup metadata and never UI status fallback metadata', () => {
  const expression = declaration('selectedNayaxSearchMetadata').initializer.getText(ast);
  const get = (nayaxLookupSummary, selectedCase, selectedNayaxSummary) =>
    new Function('nayaxLookupSummary', 'selectedCase', 'selectedNayaxSummary', `return ${expression};`)(nayaxLookupSummary, selectedCase, selectedNayaxSummary);
  const savedMetadata = { candidateCount: 1, windowHours: 6, lastCheckedAt: '2026-09-21T00:00:00Z' };
  const freshMetadata = { candidateCount: 4, windowHours: 24, lastCheckedAt: '2026-09-22T00:00:00Z' };
  const syntheticFallback = { candidateCount: 1, windowHours: 6, lastCheckedAt: null };
  assert.equal(get(freshMetadata, { nayaxLookupSummary: savedMetadata }, syntheticFallback), freshMetadata);
  assert.equal(get(null, { nayaxLookupSummary: savedMetadata }, syntheticFallback), savedMetadata);
  assert.equal(get(null, {}, syntheticFallback), null);
});

test('the real lookup response projection preserves unknown timestamp and window instead of inventing search metadata', () => {
  const expression = declaration('nextSummary').initializer.getText(ast);
  const project = (result) => new Function('result', `return ${expression};`)(result);
  const missing = project({ configured: true, candidates: [candidate()] });
  assert.equal(missing.lastCheckedAt, null);
  assert.equal(missing.windowHours, null);
  const response = {
    configured: true, candidates: [candidate()], windowHours: 24, lastCheckedAt: '2026-09-22T00:00:00Z',
    candidateCount: 7, providerWindowRecordCount: 18, providerRecordCount: 32, providerParseableRecordCount: 30,
  };
  const actual = project(response);
  for (const key of ['lastCheckedAt', 'windowHours', 'candidateCount', 'providerWindowRecordCount', 'providerRecordCount', 'providerParseableRecordCount']) {
    assert.equal(actual[key], response[key], key);
  }
});
