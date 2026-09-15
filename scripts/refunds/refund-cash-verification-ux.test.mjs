import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('.');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const page = read('src/pages/admin/Refunds.tsx');
const evidence = read('src/components/refunds/CashRefundEvidencePanel.tsx');
const migration = read('supabase/migrations/20260915010000_refund_cash_verification_ux.sql');
const safetySql = read('supabase/tests/refund_manager_official_action_safety.sql');
const edge = read('supabase/functions/refund-case-sunze-correlation/index.ts');
const release = read('scripts/refunds/refund-release.mjs');
const config = read('supabase/config.toml');

test('cash manager surface has one external-Zelle decision and no retired labels', () => {
  assert.match(page, /Confirm refund sent via Zelle/);
  assert.match(evidence, /Send the refund through Zelle outside Bloomjoy Hub first/);
  assert.doesNotMatch(page, /Mark\s+\S+\s+as\s+refunded|\bVenmo\b/);
  assert.doesNotMatch(page, /refund-cash-confirmation-dialog|refund-confirm-cash-refund/);
  assert.doesNotMatch(evidence, /confidence|rawPayload|provider diagnostics/i);
});

test('safe evidence loading cannot present a fallback amount before a response', () => {
  assert.match(page, /isCashCorrelationLoaded && selectedCashCorrelation\?\.state !== 'checking_sales_history'/);
  assert.match(page, /selectedCase\.paymentMethod === 'cash' && !isUsingDemoData && !isCashCorrelationLoaded/);
  assert.match(read('src/lib/refundCashAmount.ts'), /typeof safeEvidenceAmountCents === 'undefined'/);
  assert.match(page, /resolveCashReviewAmountCents\(refundCase\.paymentAmountCents, effectiveCashAmountCents\)/);
});

test('bounded evidence chooser supports keyboard-friendly radio selection and narrow layouts', () => {
  assert.match(evidence, /type="radio"/);
  assert.match(evidence, /aria-label="Possible Sunze sales"/);
  assert.match(evidence, /min-h-11/);
  assert.match(evidence, /sm:grid-cols-2/);
  assert.match(evidence, /candidate\.selectionConflict/);
  assert.match(evidence, /formatRefundDateTime/);
  assert.match(evidence, /Sale time \(venue time\)/);
  assert.match(evidence, /Venue time unavailable/);
  assert.match(page, /venueTimezone=\{incidentTimezone\}/);
  assert.match(page, /label: 'Ready to confirm refund'/);
});

test('payout request eligibility is ledger-backed and preserves one-request concurrency', () => {
  const helper = read('src/lib/refundCashPayoutRequest.ts');
  assert.match(helper, /payoutDestinationRequest\?\.canRequest === true/);
  assert.match(helper, /correction\?\.isActive === true/);
  assert.match(helper, /correction\?\.isActive === false/);
  assert.match(helper, /requestedFields\.includes\('zelle_payment_contact'\)/);
  assert.match(migration, /from public\.refund_payout_destination_follow_ups follow_up/);
  assert.match(migration, /service_enqueue_refund_manual_message_intent_pre_cash_verification_ux/);
  assert.match(migration, /from public\.refund_cases refund_case[\s\S]*for update/);
  assert.match(migration, /request_message\.status in \('pending', 'sent'\)/);
  assert.match(safetySql, /array\['amount'\]::text\[\]/);
  assert.match(safetySql, /array\['zelle_payment_contact'\]::text\[\]/);
  assert.match(safetySql, /active customer request/);
  const enqueueSection = migration.slice(
    migration.indexOf('create function public.service_enqueue_refund_manual_message_intent('),
    migration.indexOf('revoke execute on function public.service_enqueue_refund_manual_message_intent('),
  );
  assert.match(enqueueSection, /correction\.correction_kind = 'purchase'/);
  assert.doesNotMatch(enqueueSection, /correction\.correction_requested_fields/);
  const overviewSection = migration.slice(migration.indexOf('create function public.admin_get_refund_operations_overview()'));
  assert.doesNotMatch(overviewSection, /delivery_unknown/);
  assert.doesNotMatch(overviewSection, /correction\.correction_requested_fields/);
  assert.match(page, /const canRequestCashPayoutDestination = canRequestDistinctCashPayoutDestination\(selectedCase\)/);
  assert.match(page, /missingCashFields\.includes\('zelle_payment_contact'\)\s*\n\s*\? canRequestCashPayoutDestination/);
  assert.doesNotMatch(page, /refundCase\.payoutDestinationRequest\?\.canRequest !== true/);
});

test('server completion binds the actual selected sale and preserves the manual estimate path', () => {
  assert.match(migration, /server_refund_amount_cents := selected_sale\.net_sales_cents/);
  assert.match(migration, /amount_source := 'sunze_selected_sale'/);
  assert.match(migration, /amount_source text := 'customer_estimate_manual_review'/);
  assert.match(migration, /p_refund_amount_cents is distinct from server_refund_amount_cents/);
  assert.match(migration, /revoke all on function public\.service_complete_cash_refund_as_actor/);
  assert.match(migration, /grant execute on function public\.service_complete_cash_refund_official/);
  assert.match(migration, /p_refund_amount_cents,\r?\n    null,\r?\n    null,/);
});

test('legacy normalization is atomic, audited, and terminal-safe', () => {
  assert.match(migration, /create function public\.service_prepare_legacy_cash_case_for_correlation/);
  assert.match(migration, /returning \* into case_row/);
  assert.match(migration, /service_correlate_sunze_cash_case\(/);
  assert.match(migration, /paymentReceiptPreserved/);
  assert.match(migration, /before_case_row := case_row/);
  assert.match(migration, /'previousStatus', before_case_row\.status/);
  assert.match(migration, /'status', before_case_row\.status/);
  assert.match(migration, /case_row\.refund_completed_at is not null/);
});

test('read/select endpoint has explicit operation and first-selection token validation', () => {
  assert.match(edge, /body\.operation === undefined \|\| body\.operation === "read"/);
  assert.match(edge, /errorCode: "invalid_operation"/);
  assert.match(edge, /const expectedLinkVersion = nonNegativeInteger/);
  assert.match(edge, /statusForDatabaseError/);
  assert.match(edge, /return jsonResponse\(safeError, statusForDatabaseError/);
});

test('release inventory and JWT boundary include the safe evidence function', () => {
  assert.match(release, /'refund-case-sunze-correlation'/);
  assert.match(release, /sunze_cash_correlation_service/);
  assert.match(read('scripts/refunds/validate-refund-release.mjs'), /Sunze cash correlation prerequisite must fail closed/);
  assert.match(config, /\[functions\.refund-case-sunze-correlation\]\s+verify_jwt = false/);
});
