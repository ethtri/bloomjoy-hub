import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();

const readText = (relativePath) => readFile(path.join(repoRoot, relativePath), 'utf8');

const checks = [];

const assert = (name, passed, detail = '') => {
  checks.push({ name, passed, detail });
  const symbol = passed ? 'PASS' : 'FAIL';
  console.log(`[${symbol}] ${name}${detail && !passed ? ` - ${detail}` : ''}`);
};

const includesAll = (text, needles) => needles.every((needle) => text.includes(needle));

const run = async () => {
  const [
    adminUpdate,
    portalPage,
    publicRequestPage,
    portalUat,
    refundEmail,
    followUpPolicy,
    automationSweep,
    intake,
    messageSend,
  ] = await Promise.all([
    readText('supabase/functions/refund-case-admin-update/index.ts'),
    readText('src/pages/admin/Refunds.tsx'),
    readText('src/pages/RefundRequest.tsx'),
    readText('scripts/refunds/validate-refund-portal-uat.mjs'),
    readText('supabase/functions/_shared/refund-email.ts'),
    readText('supabase/functions/_shared/refund-deterministic-follow-up.ts'),
    readText('supabase/functions/refund-case-automation-sweep/index.ts'),
    readText('supabase/functions/refund-case-intake/index.ts'),
    readText('supabase/functions/refund-case-message-send/index.ts'),
  ]);

  assert(
    'Primary admin update accepts an explicit customer message type',
    includesAll(adminUpdate, ['sanitizeRefundMessageType', 'customerMessageType', 'requestedMessageType'])
  );
  assert(
    'Primary admin update records failed customer email tasks',
    includesAll(adminUpdate, ['customer_message_failed', 'customer_email_delivery_failed', 'status: "failed"'])
  );
  assert(
    'Portal shows failed customer email as separate visible manager work',
    includesAll(portalPage, [
      "latestMessage?.status === 'failed'",
      'Retry customer email',
      'Resolve uncertain Gmail delivery',
      'getLatestCustomerMessage',
    ])
  );
  assert(
    'Portal primary case actions send the matching customer message type',
    includesAll(portalPage, ['handleSaveCase(primaryActionEditor, primaryAction.messageType', 'customerMessageType'])
  );
  assert(
    'Normal path no longer has a standalone Send customer email button',
    !portalPage.includes('Send customer email')
  );
  assert(
    'Manager queue does not repeat identical location and machine labels',
    includesAll(portalPage, [
      'formatRefundMachineLocation',
      'locationName.trim().toLocaleLowerCase() === machineLabel.trim().toLocaleLowerCase()',
      'formatRefundMachineLocation(refundCase.locationName, refundCase.machineLabel)',
      'formatRefundMachineLocation(selectedCase.locationName, selectedCase.machineLabel)',
    ])
  );
  assert(
    'Public refund selector hides placeholder location names even before the database migration is deployed',
    includesAll(publicRequestPage, [
      'isPlaceholderRefundLocationLabel',
      "normalized.startsWith('unmapped ')",
      "normalized.startsWith('unknown ')",
      'return normalizedMachineLabel',
    ])
  );
  assert(
    'Focused UAT covers guarded completion, failure, and retry wiring',
    includesAll(portalUat, [
      'runCustomerCommsFailureChecks',
      'refund-case-message-send',
      'nayax-card-refund',
      'Synthetic browser ${scenario.name} trusts atomic settlement without secondary mutations',
      'messageType ===',
      'Blocked Nayax execution leaves customer uncontacted',
    ])
  );
  assert(
    'Deterministic missing-information copy requires exact allowlisted fields',
    includesAll(refundEmail, [
      'A deterministic missing-field list is required',
      'Please reply with ${requestedDetails}',
      'Please do not send a full card number',
    ]) &&
      includesAll(followUpPolicy, [
        'deriveRefundMissingFields',
        'sanitizeRefundMissingFields',
        'requiresSecureWalletCorrection',
      ])
  );
  assert(
    'Hosted intake no longer sends the old generic photo or wallet-digit request',
    !intake.includes('anything that may help') &&
      !intake.includes('photo of the machine/payment screen') &&
      !intake.includes('inside Apple Pay') &&
      intake.includes('messageType: "confirmation"')
  );
  assert(
    'No-safe-match and receipt-only templates are distinct and make no payment promise',
    includesAll(refundEmail, [
      'case "no_safe_match"',
      'This does not mean you did anything wrong',
      'case "information_received"',
      'confirms receipt only',
      'not a promise that a payment has been completed',
    ])
  );
  assert(
    'Wallet last-four corrections are forced through the secure flow',
    includesAll(refundEmail, [
      'Mobile-wallet last-four corrections must use the secure correction flow',
      'do not email wallet or device-card digits',
      ]) &&
      includesAll(messageSend, [
        'derived.requiresSecureWalletCorrection',
        'Use the secure mobile-wallet correction link instead of requesting wallet information by email',
      ])
  );
  assert(
    'Automatic customer contact has an independent default-off gate in intake and sweep',
    followUpPolicy.includes('REFUND_AUTOMATIC_CUSTOMER_CONTACT_ENABLED') &&
      followUpPolicy.includes('?? "false"') &&
      intake.includes('automaticCustomerContactEnabled') &&
      intake.includes('automatic_customer_contact_disabled') &&
      automationSweep.includes('automaticCustomerContactEnabled')
  );
  assert(
    'Follow-up delivery persists safe evidence and keeps GPT prose manual',
    includesAll(automationSweep, [
      'content_source: "deterministic_template"',
      'delivery_kind: "automatic"',
      'follow_up_cycle_id: cycle.id',
      'requested_fields: cycle.requestedFields',
    ]) &&
      includesAll(messageSend, [
        'manager_reviewed_gpt',
        'delivery_kind: "manual"',
        'validateRefundGptReviewedDraft',
      ])
  );
  assert(
    'Provider failures route to managers and cannot send correction or success copy',
    includesAll(automationSweep, [
      'service_claim_refund_provider_exception_action',
      'routeProviderException',
      'sendFollowUpManagerNotice',
      'provider_setup',
      'provider_outage',
      'provider_rejection',
      'provider_timeout',
      'provider_unknown',
    ])
  );
  assert(
    'Pre-decision and confirmed refund amounts use different labels',
    refundEmail.includes('input.messageType === "approved" || input.messageType === "completed"') &&
      refundEmail.includes('? "Refund amount"') &&
      refundEmail.includes(': "Reported amount"')
  );

  const failed = checks.filter((check) => !check.passed);
  if (failed.length > 0) {
    console.error(`\nRefund customer comms validation failed: ${failed.length} check(s).`);
    process.exit(1);
  }

  console.log('\nRefund customer comms validation passed.');
};

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
