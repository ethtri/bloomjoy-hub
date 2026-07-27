import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  tokenSource,
  migrationSource,
  intakeSource,
  automationSource,
  emailSource,
  abuseSource,
  operationsSource,
  pageSource,
  appSource,
] = await Promise.all([
  read('supabase/functions/_shared/refund-wallet-correction.ts'),
  read('supabase/migrations/202607270001_refund_wallet_correction.sql'),
  read('supabase/functions/refund-case-intake/index.ts'),
  read('supabase/functions/refund-case-automation-sweep/index.ts'),
  read('supabase/functions/_shared/refund-email.ts'),
  read('supabase/functions/_shared/public-intake-abuse-controls.ts'),
  read('src/lib/refundOperations.ts'),
  read('src/pages/RefundWalletCorrection.tsx'),
  read('src/App.tsx'),
]);

const expectAll = (source, snippets, label) => {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${label} is missing: ${snippet}`);
  }
};

expectAll(
  tokenSource,
  [
    'REFUND_WALLET_CORRECTION_TTL_HOURS = 48',
    'REFUND_WALLET_CORRECTION_MAX_LINKS = 2',
    'crypto.getRandomValues(bytes)',
    '"SHA-256"',
    'refund-wallet-correction:',
  ],
  'Wallet correction token safety'
);

expectAll(
  migrationSource,
  [
    'create table if not exists public.refund_wallet_correction_contexts',
    "check (status in ('pending', 'submitted', 'expired', 'revoked'))",
    'refund_wallet_correction_one_pending_idx',
    'service_issue_refund_wallet_correction',
    'service_get_refund_wallet_correction',
    'service_apply_refund_wallet_correction',
    'for update',
    "status = 'submitted'",
    "wallet_correction_state = 'received'",
    "correlation_status = 'needs_nayax'",
    'matched_nayax_transaction_id = null',
    'machine_context_changed',
    'qr_context_changed',
    'enable row level security',
    'revoke all on table public.refund_wallet_correction_contexts',
  ],
  'Wallet correction database boundary'
);

assert.ok(
  !/create table[\s\S]*\b(raw_token|card_number|cvv)\b/i.test(
    migrationSource.match(
      /create table if not exists public\.refund_wallet_correction_contexts[\s\S]*?\n\);/
    )?.[0] ?? ''
  ),
  'Wallet correction contexts must not persist raw links or forbidden payment credentials'
);

expectAll(
  intakeSource,
  [
    'action === "inspectWalletCorrection"',
    'action === "submitWalletCorrection"',
    'PUBLIC_REFUND_WALLET_CORRECTION_LIMITS',
    'service_apply_refund_wallet_correction',
    'lookupNayaxCandidatesForRefundCase',
    'persistWalletCorrectionLookup',
    'wallet_correction_auto_match_ready',
    'wallet_correction_fallback_eligible',
    'sendWalletMatchReadyNotification',
    'payload_redacted: true',
  ],
  'Public correction and automatic re-match'
);

expectAll(
  automationSource,
  [
    'sendWalletCorrectionMessage',
    'service_issue_refund_wallet_correction',
    'refund_wallet_correction_v1',
    '[secure single-use correction link omitted from audit log]',
    'wallet_correction_request',
    'wallet_correction_reminder',
    'tokenized_last4_noncorrelating',
    'wallet_payment_detected_from_provider_evidence',
    'runWalletCorrectionExpirySweep',
    'fallback_method: "tbd"',
  ],
  'Bounded automatic correction communication'
);

expectAll(
  emailSource,
  [
    'buildRefundWalletCorrectionEmail',
    'sendRefundWalletCorrectionEmail',
    'full card number',
    'security code',
    'expiration date',
    'wallet password',
    'screenshot',
    'expires in 48 hours',
  ],
  'Wallet correction email'
);

expectAll(
  abuseSource,
  [
    'PUBLIC_REFUND_WALLET_CORRECTION_LIMITS',
    'eventScope: "refund_wallet_correction"',
  ],
  'Wallet correction abuse controls'
);

expectAll(
  operationsSource,
  [
    'inspectRefundWalletCorrection',
    'submitRefundWalletCorrection',
    "action: 'inspectWalletCorrection'",
    "action: 'submitWalletCorrection'",
  ],
  'Wallet correction browser API'
);

expectAll(
  pageSource,
  [
    'Virtual card last 4',
    'Approximate purchase time',
    'I confirm the purchase amount was',
    'full card number',
    'security code',
    'expiration date',
    'wallet password',
    'screenshot',
    'automatically re-checked',
  ],
  'Wallet correction customer experience'
);

for (const forbiddenInput of [
  'type="file"',
  'fullCardNumber',
  'cardExpiration',
  'securityCode',
  'cvv',
]) {
  assert.ok(
    !pageSource.includes(forbiddenInput),
    `Correction UI must not collect forbidden payment data: ${forbiddenInput}`
  );
}

assert.ok(
  appSource.includes(
    '<Route path="/refunds/correct-wallet" element={<RefundWalletCorrection />} />'
  ),
  'The public secure correction route must be registered'
);

console.log('Refund wallet correction static validation passed.');
