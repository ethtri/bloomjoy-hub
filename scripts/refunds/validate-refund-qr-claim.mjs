import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), 'utf8');

const [
  tokenSource,
  migrationSource,
  intakeSource,
  abuseSource,
  operationsSource,
  requestPageSource,
] = await Promise.all([
  read('supabase/functions/_shared/refund-qr-claim.ts'),
  read('supabase/migrations/202607260001_refund_qr_claim_context.sql'),
  read('supabase/functions/refund-case-intake/index.ts'),
  read('supabase/functions/_shared/public-intake-abuse-controls.ts'),
  read('src/lib/refundOperations.ts'),
  read('src/pages/RefundRequest.tsx'),
]);

const expectAll = (source, snippets, label) => {
  for (const snippet of snippets) {
    assert.ok(source.includes(snippet), `${label} is missing: ${snippet}`);
  }
};

expectAll(
  tokenSource,
  [
    'REFUND_QR_CLAIM_TTL_MINUTES = 30',
    'crypto.getRandomValues(bytes)',
    '"SHA-256"',
    'refund-qr-claim:',
    '!uuidPattern.test(value)',
  ],
  'QR token safety'
);

expectAll(
  migrationSource,
  [
    'create table if not exists public.refund_machine_qr_codes',
    'create table if not exists public.refund_qr_claim_contexts',
    'refund_machine_qr_codes_one_active_per_machine_idx',
    'refund_cases_refund_qr_claim_context_id_idx',
    'public.public_refund_machine_options()',
    'before insert on public.refund_cases',
    'for update',
    'statement_timestamp()',
    'enable row level security',
    'revoke all on table public.refund_machine_qr_codes',
    'revoke all on table public.refund_qr_claim_contexts',
  ],
  'QR database boundary'
);

assert.match(
  migrationSource,
  /where status = 'active';/,
  'Only one active QR code should be allowed per machine'
);
assert.match(
  migrationSource,
  /where refund_qr_claim_context_id is not null;/,
  'One claim context should be usable by only one refund case'
);

expectAll(
  intakeSource,
  [
    'action === "startQrClaim"',
    'isRefundQrOpaqueToken(qrCode)',
    'hashRefundQrClaimToken(claimToken)',
    '.eq("public_code", qrCode)',
    '.eq("status", "active")',
    'PUBLIC_REFUND_QR_CLAIM_LIMITS',
    'refund_qr_claim_context_id: verifiedQrClaim?.id ?? null',
    'intake_path: verifiedQrClaim ? "machine_qr" : "direct_form"',
    'requestedMachineId !== verifiedQrClaim.reportingMachineId',
    'refund_qr_claim_used',
    'messageType: "confirmation"',
    'automaticCustomerContactAllowed()',
  ],
  'Refund intake QR integration'
);
assert.doesNotMatch(
  intakeSource,
  /wallet digits may differ from the physical card|photo of the machine\/payment screen/i,
  'Refund intake must not restore the legacy free-form wallet-digit or payment-screen request'
);

for (const forbiddenClientEvidence of [
  'body?.scanTime',
  'body?.scannedAt',
  'body?.qrOpenedAt',
  'body?.clientTimestamp',
]) {
  assert.ok(
    !intakeSource.includes(forbiddenClientEvidence),
    `Client-provided scan evidence must not be trusted: ${forbiddenClientEvidence}`
  );
}

expectAll(
  abuseSource,
  [
    'PUBLIC_REFUND_QR_CLAIM_LIMITS',
    'eventScope: "refund_qr_claim"',
    'keyType: "global"',
    'keyType: "ip"',
  ],
  'QR abuse controls'
);

expectAll(
  operationsSource,
  [
    'startRefundQrClaim',
    "action: 'startQrClaim'",
    'qrClaimToken?: string',
    "invokeEdgeFunction<SubmitRefundRequestResponse>('refund-case-intake', input)",
  ],
  'Refund browser API'
);

expectAll(
  requestPageSource,
  [
    "const qrCode = (searchParams.get('qr') ?? '').trim()",
    'Machine confirmed',
    'QR verified',
    'We saved the server time as',
    'qrClaim?.claimToken',
    'Virtual last 4 shown in your wallet',
    'Do not use the last 4 printed on the physical card.',
    'Use regular refund form',
    'Start new QR session',
  ],
  'Refund QR customer experience'
);

assert.ok(
  requestPageSource.includes('qrClaim ? (') &&
    requestPageSource.includes('<Label htmlFor="machine">Machine location</Label>'),
  'The QR journey should show a locked machine while manual intake retains the selector'
);

console.log('Refund QR claim static validation passed.');
