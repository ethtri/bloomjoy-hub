import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { createServer } from 'vite';

let vite;
let Review;
test.before(async () => {
  vite = await createServer({ appType: 'custom', logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true } });
  ({ RefundTransactionCandidateReview: Review } = await vite.ssrLoadModule('/src/components/refunds/RefundTransactionCandidateReview.tsx'));
});
test.after(async () => { await vite?.close(); });

const candidate = (candidateToken, overrides = {}) => ({
  candidateToken, amountCents: 1060, currencyCode: 'USD', cardLast4: '0000', cardBrand: 'Visa',
  authorizedAt: '2026-09-20T21:03:00Z', machineAuthorizationTime: '2026-09-20T21:03:00Z',
  paymentStatus: 'approved', productLabel: 'Synthetic product', selectionAllowed: true,
  matchFactors: [{ key: 'card', label: 'Wallet digits differ', outcome: 'mismatch' }], ...overrides,
});
const savedSelection = { transactionId: 'synthetic-selected-reference', saleAmountCents: 1060, currencyCode: 'USD' };
const props = (overrides = {}) => ({
  candidates: [candidate('first'), candidate('alternative', { selectionAllowed: false, paymentStatus: 'unconfirmed' })],
  selectedCandidate: null, selectedCandidateToken: '', hasSavedSelection: true, savedSelection,
  selectableCandidateCount: 1, paymentAmountCents: 1000, timezone: 'America/New_York',
  waitingOnCustomer: false, isDemoData: false, isSaving: false, canSelectCandidates: false,
  canAccessCandidateSelection: true, disagreementReason: '', canUseCloserTimeReason: false,
  describeUnavailableCandidate: () => 'Provider outcome needs verification',
  onSelectCandidate: () => { throw new Error('Rendering must not select'); },
  onDisagreementReasonChange: () => { throw new Error('Rendering must not edit'); },
  onSaveForReview: () => { throw new Error('Rendering must not save'); }, ...overrides,
});
const render = (overrides) => renderToStaticMarkup(React.createElement(Review, props(overrides)));

test('saved purchase and all returned alternatives remain reviewable without selecting or saving', () => {
  const html = render();
  assert.match(html, /Currently selected for review/);
  assert.match(html, /synthetic-selected-reference/);
  assert.equal((html.match(/data-testid="nayax-candidate-option"/g) ?? []).length, 2);
  assert.match(html, /Provider outcome needs verification/);
  assert.match(html, /Uncertain or different/);
  assert.match(html, /Synthetic product/);
  assert.match(html, /Payment status: unconfirmed/);
  assert.match(html, /Provider reference is available after saving this purchase/);
  assert.doesNotMatch(html, /refund-save-transaction-for-review/);
});

test('missing current inventory preserves saved reference and does not claim an exhaustive zero', () => {
  const html = render({ candidates: [], selectableCandidateCount: 0 });
  assert.match(html, /Current candidate rows unavailable/);
  assert.match(html, /does not establish that there were no alternatives/);
  assert.match(html, /Returned candidate count unavailable/);
  assert.match(html, /Historical coverage (?:is )?unknown/);
  assert.match(html, /synthetic-selected-reference/);
});

test('search metadata distinguishes returned shortlist, provider records and unknown coverage', () => {
  const html = render({ lookupSummary: {
    candidateCount: 7, providerWindowRecordCount: 18, windowHours: 24,
    incidentAt: '2026-09-20T21:03:00Z', lastCheckedAt: '2026-09-21T21:03:00Z', historicalCoverage: 'unknown',
  } });
  assert.match(html, /7 candidates returned for review/);
  assert.match(html, /18 provider records in the reported search window/);
  assert.match(html, /Reported search window/);
  assert.match(html, /Last checked:/);
  assert.match(html, /Historical coverage (?:is )?unknown/);
});

test('availability, case access, demo and saving protections continue disabling candidate inputs', () => {
  for (const override of [{ canSelectCandidates: false }, { isDemoData: true }, { isSaving: true }]) {
    const html = render({ ...override, candidates: [candidate('first')], ...(!('canSelectCandidates' in override) ? { canSelectCandidates: true } : {}) });
    assert.match(html, /type="radio"[^>]*disabled/);
  }
});

test('expanded review separates approximate time and amount differences without adding an eligibility gate', () => {
  const html = render({
    canSelectCandidates: true, candidates: [candidate('first', {
      timeDeltaMinutes: 1,
      matchFactors: [
        { key: 'machine', outcome: 'match', label: 'Same machine and location' },
        { key: 'incident_time', outcome: 'match', label: 'Time match' },
        { key: 'amount', outcome: 'match', label: 'Amount match' },
      ],
    })], customerEvidence: { paymentAmountCents: 1000, incidentTimeConfidence: 'rough' },
  });
  assert.match(html, /Supports this purchase/);
  assert.match(html, /Same machine and location/);
  assert.match(html, /Uncertain or different/);
  assert.match(html, /purchase timing remains uncertain|comparable purchase time/);
  assert.match(html, /\$0\.60.*estimate/);
  assert.doesNotMatch(html, /type="radio"[^>]*disabled/);
});

// Exercise the real page composition and its selection callback without loading
// authenticated data or invoking an external action.
const pageFile = 'src/pages/admin/Refunds.tsx';
const pageSource = fs.readFileSync(pageFile, 'utf8');
const ast = ts.createSourceFile(pageFile, pageSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let renderDeclaration;
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'renderCardSaleCandidates') renderDeclaration = node;
  ts.forEachChild(node, visit);
};
visit(ast);
assert.ok(renderDeclaration);
const compiled = ts.transpileModule(`const ${renderDeclaration.getText(ast)};`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
const pagePanel = (overrides = {}) => {
  let editorState = { status: 'needs_review', clearNayaxMatch: false, matchedNayaxCandidateToken: '', nayaxDisagreementReason: '', refundAmount: '10.60' };
  const caseRecord = { id: 'synthetic-case', status: 'needs_review', paymentMethod: 'card', hasMatchedNayaxTransaction: true, selectedNayaxTransaction: savedSelection, nayaxRecommendationState: 'high_confidence', decision: null, canSelectNayaxCandidate: true };
  let writes = 0;
  const env = {
    selectedCase: caseRecord, editor: editorState, selectedCaseIsResolvedDuplicate: false, selectedCaseNeedsLegacyPaymentReview: false,
    primaryAction: null, refundCanShowCandidateInventory: () => true, nayaxCandidates: [candidate('first'), candidate('alternative')],
    hasSelectedCardEvidence: () => true, isWaitingCase: () => false, refundOperationsAccess: true,
    canConfirmRefundCandidate: ({ canSelectCandidate }) => canSelectCandidate, officialActionVersion: 1,
    selectedNayaxCandidate: (editor, candidates) => candidates.find((item) => item.candidateToken === editor.matchedNayaxCandidateToken) ?? null,
    selectedTransactionView: { kind: 'selected', showCandidates: false },
    selectedNayaxSummary: null, isLookingUpNayax: false, isUsingDemoData: false, isSaving: false,
    selectedNayaxSearchMetadata: null,
    nayaxLookupNoticeClass: () => '',
    setEditor: (update) => { writes++; editorState = update(editorState); },
    RefundTransactionCandidateReview: 'CandidateReview', refundCaseTimezone: () => 'America/New_York',
    Button: 'button', RefundNayaxTransactionRecoveryDetails: 'Recovery',
    ...overrides,
  };
  const rerender = () => {
    env.editor = editorState;
    return new Function('React', ...Object.keys(env), `${compiled}\nreturn renderCardSaleCandidates();`)(React, ...Object.values(env));
  };
  return { tree: rerender(), rerender, caseRecord, editor: () => editorState, writes: () => writes };
};
const findElement = (tree, type) => {
  if (!React.isValidElement(tree)) return null;
  if (tree.type === type) return tree;
  for (const child of React.Children.toArray(tree.props.children)) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
};

test('persisted purchase renders a native comparison disclosure without a mutation handler', () => {
  const panel = pagePanel();
  const details = findElement(panel.tree, 'details');
  assert.ok(details);
  assert.equal(details.props.open, undefined);
  const summary = findElement(details, 'summary');
  assert.equal(summary.props.children, 'Compare other transactions');
  assert.equal(summary.props.onClick, undefined);
  assert.equal(details.props.onToggle, undefined);
  assert.ok(findElement(details, 'CandidateReview'));
  assert.equal(panel.writes(), 0);
  assert.equal(panel.caseRecord.selectedNayaxTransaction.transactionId, savedSelection.transactionId);
});

test('only an explicit permitted choice prepares an alternative; persisted exact binding is untouched', () => {
  const panel = pagePanel();
  const review = findElement(panel.tree, 'CandidateReview');
  assert.equal(review.props.canSelectCandidates, true);
  review.props.onSelectCandidate(candidate('alternative', { amountCents: 1090 }));
  assert.equal(panel.writes(), 1);
  assert.equal(panel.editor().matchedNayaxCandidateToken, 'alternative');
  assert.equal(panel.editor().refundAmount, '10.90');
  assert.equal(panel.editor().clearNayaxMatch, false);
  assert.equal(panel.caseRecord.selectedNayaxTransaction.transactionId, savedSelection.transactionId);
  review.props.onSelectCandidate(candidate('blocked', { selectionAllowed: false }));
  assert.equal(panel.writes(), 1);
});

test('cash, legacy and non-manager inventory boundaries do not expose card comparison', () => {
  assert.equal(pagePanel({ selectedCase: { paymentMethod: 'cash' } }).tree, null);
  assert.equal(findElement(pagePanel({ selectedCaseNeedsLegacyPaymentReview: true }).tree, 'CandidateReview'), null);
  assert.equal(findElement(pagePanel({ refundCanShowCandidateInventory: () => false }).tree, 'CandidateReview'), null);
});

test('reviewed final choice uses the exact alternate token and sale amount while retaining the stored purchase', () => {
  const panel = pagePanel({
    primaryAction: { mode: 'reviewed_nayax_final_decision' },
    selectedCase: {
      id: 'synthetic-case', paymentMethod: 'card', decision: null, hasMatchedNayaxTransaction: true,
      selectedNayaxTransaction: savedSelection, canPerformOfficialAction: true,
      lifecycle: { nextWork: { eligibleCandidateTokens: ['alternative'] } },
    },
    nayaxCandidates: [candidate('first'), candidate('alternative', { amountCents: 1090 })],
  });
  let review = findElement(panel.tree, 'CandidateReview');
  assert.equal(review.props.candidates[0].selectionAllowed, false);
  assert.equal(review.props.candidates[1].selectionAllowed, true);
  review.props.onSelectCandidate(review.props.candidates[0]);
  assert.equal(panel.writes(), 0);
  review.props.onSelectCandidate(review.props.candidates[1]);
  review = findElement(panel.rerender(), 'CandidateReview');
  assert.equal(review.props.selectedCandidateToken, 'alternative');
  assert.equal(review.props.selectedCandidate.amountCents, 1090);
  assert.equal(review.props.savedSelection.transactionId, savedSelection.transactionId);
  assert.equal(review.props.savedSelection.saleAmountCents, 1060);
  assert.equal(panel.editor().clearNayaxMatch, false);
});
