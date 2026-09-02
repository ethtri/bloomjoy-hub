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
    nayaxCustomerCorrection,
    automationSweep,
    intake,
    messageSend,
    manualMessageOutbox,
    gmailSync,
    statusRecoveryMigration,
    waitingLifecycleMigration,
    acknowledgementRecoveryMigration,
    refundOperations,
    acknowledgementRecoveryTest,
    localeCorrectionMigration,
    localeCorrectionTest,
    internalTestMigration,
    internalTestTest,
    nayaxCardRefund,
    schedulerIncidentMigration,
    providerDelayEvidenceMigration,
  ] = await Promise.all([
    readText('supabase/functions/refund-case-admin-update/index.ts'),
    readText('src/pages/admin/Refunds.tsx'),
    readText('src/pages/RefundRequest.tsx'),
    readText('scripts/refunds/validate-refund-portal-uat.mjs'),
    readText('supabase/functions/_shared/refund-email.ts'),
    readText('supabase/functions/_shared/refund-deterministic-follow-up.ts'),
    readText('supabase/functions/_shared/refund-nayax-customer-correction.ts'),
    readText('supabase/functions/refund-case-automation-sweep/index.ts'),
    readText('supabase/functions/refund-case-intake/index.ts'),
    readText('supabase/functions/refund-case-message-send/index.ts'),
    readText('supabase/functions/_shared/refund-manual-message-outbox.ts'),
    readText('supabase/functions/refund-gmail-sync/index.ts'),
    readText('supabase/migrations/20260830183702_refund_customer_status_recovery.sql'),
    readText('supabase/migrations/20260831232759_refund_waiting_lifecycle_truth.sql'),
    readText('supabase/migrations/20260901010259_refund_acknowledgement_recovery_disposition.sql'),
    readText('src/lib/refundOperations.ts'),
    readText('supabase/tests/refund_acknowledgement_recovery_disposition.sql'),
    readText('supabase/migrations/20260901021433_refund_customer_locale_correction.sql'),
    readText('supabase/tests/refund_customer_locale_correction.sql'),
    readText('supabase/migrations/20260901033000_refund_internal_test_disposition.sql'),
    readText('supabase/tests/refund_internal_test_disposition.sql'),
    readText('supabase/functions/nayax-card-refund/index.ts'),
    readText('supabase/migrations/20260901180116_refund_scheduler_incident_1069.sql'),
    readText('supabase/migrations/20260901202359_refund_provider_delay_evidence_1069.sql'),
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
    'Portal shows failed or skipped customer email as separate visible manager work',
    includesAll(portalPage, [
      "latestMessage?.status === 'failed'",
      "latestMessage?.status === 'skipped'",
      'Customer was not notified',
      'Send a safe customer acknowledgement',
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
    'Cash customer copy never claims a card transaction review',
    includesAll(refundEmail, [
      'matching cash purchase',
      'updated purchase details',
      'paymentMethod === "cash"',
    ])
  );
  assert(
    'Provider-delay and SLA-at-risk updates are provider-neutral and human-owned',
    includesAll(refundEmail, [
      'statusUpdateReason === "provider_delay"',
      'waiting for confirmation from the payment provider',
      'statusUpdateReason === "sla_at_risk"',
      'a person is now following it directly',
    ]) && !refundEmail.includes('A tiny bit more information')
  );
  assert(
    'Provider-delay and business-day-four status updates are scheduled exactly once',
    includesAll(automationSweep, [
      'runProviderDelayCustomerStatusSweep',
      'runSlaAtRiskCustomerStatusSweep',
      'service_refund_business_days_elapsed',
      'customer_status:provider_delay:',
      'customer_status:sla_at_risk:',
      'service_list_due_refund_provider_delay_attempts',
      'customer_status_update',
    ]) &&
      includesAll(schedulerIncidentMigration, [
        'service_list_due_refund_provider_delay_attempts',
        'not exists (',
        'later_attempt.refund_case_id = attempt.refund_case_id',
      ]) &&
      includesAll(statusRecoveryMigration, [
        "'customer_status_update'",
        "'provider_delay', 'sla_at_risk'",
        "template_version = 'refund_customer_status_v1'",
      ]) &&
      includesAll(providerDelayEvidenceMigration, [
        "new.reason_code = 'provider_delay'",
        "case_row.status <> 'card_refund_pending'",
        "case_row.decision is distinct from 'approved'",
        "new.reason_code = 'sla_at_risk'",
        "case_row.decision is not null",
        'Provider-delay message requires the latest unresolved hold',
        'guard_refund_provider_hold_customer_message',
        "new.message_type is not distinct from 'status_update'",
        "new.delivery_kind is not distinct from 'automatic'",
        "new.content_source is not distinct from 'deterministic_template'",
      ])
  );
  assert(
    'Contact limits end in visible manager review instead of indefinite waiting',
    includesAll(automationSweep, [
      'terminalCustomerDisposition: cycleClaim.reason === "contact_limit_reached"',
      'event_type: "automatic_customer_contact_limit_reached"',
      'status: "needs_review"',
      'automatic_customer_contact_stopped: true',
    ])
  );
  assert(
    'Customer waiting and more-info state require one sent deterministic request',
    includesAll(waitingLifecycleMigration, [
      'refund_customer_action_contract',
      "message.status = 'sent'",
      "message.sent_at is not null",
      "cardinality(action_fields) > 0",
      "new.status = 'waiting_on_customer'",
      "new.automation_state = 'more_info_needed'",
      "'customer_waiting_contract_rejected'",
      "'customer_waiting_contract_repaired'",
      "'more_information_state_repaired'",
      "'customerActionFields'",
      "'review_customer_contact'",
    ])
  );
  assert(
    'Skipped acknowledgements remain visible and have one no-resend recovery disposition',
    includesAll(acknowledgementRecoveryMigration, [
      'refund_acknowledgement_delivery_exception',
      "message.message_type = 'confirmation'",
      "message.status = 'skipped'",
      "'record_later_contact_disposition'",
      "'send_safe_status_update'",
      'admin_dispose_refund_acknowledgement_exception',
      'p_expected_case_version',
      'later_customer_contact_already_sent',
      "'customer_acknowledgement_recovery_disposition'",
      "'payload_redacted', true",
    ]) && includesAll(portalPage, [
      'Customer acknowledgement was skipped',
      'Record later contact — do not resend',
      'handleDisposeAcknowledgementException',
      'acknowledgementExceptionNeedsAttention',
    ]) && includesAll(refundOperations, [
      'acknowledgementDeliveryException',
      'disposeRefundAcknowledgementException',
    ]) && includesAll(acknowledgementRecoveryTest, [
      'A stale case version cannot record the disposition',
      'Recording the disposition sends or creates no customer message',
      'A replay cannot duplicate the audit event',
      'changes no case decision, payment, provider, or reporting state',
    ])
  );
  assert(
    'Customer language preference persists across intake, manager, automation, and appeal routes',
    includesAll(intake, ['inferRefundCustomerLocale', 'customer_locale: customerLocale']) &&
      includesAll(messageSend, ['refundCustomerLocaleFromIntakeMeta', 'customerLocale:']) &&
      includesAll(adminUpdate, ['refundCustomerLocaleFromIntakeMeta', 'customerLocale:']) &&
      includesAll(automationSweep, ['refundCustomerLocaleFromIntakeMeta', 'customerLocale:']) &&
      includesAll(gmailSync, ['refundCustomerLocaleFromIntakeMeta', 'refundCaseLocale?.intake_meta'])
  );
  assert(
    'Existing-case locale correction is bounded, versioned, audit-only, and visible to managers',
    includesAll(localeCorrectionMigration, [
      'admin_correct_refund_customer_locale',
      "normalized_locale not in ('en', 'es')",
      'p_expected_case_version',
      'p_expected_locale_version',
      'for update',
      "'customer_locale_corrected'",
      "'payload_redacted', true",
      "'customerLocale'",
      "'customerLocaleContractVersion'",
    ]) && includesAll(localeCorrectionTest, [
      'A stale case version cannot correct the customer locale',
      'A stale locale version cannot overwrite a newer correction',
      'Correcting locale creates no customer message',
      'changes no decision, payment, provider, reporting, or official-action state',
      'A replay cannot duplicate the locale audit event',
    ]) && includesAll(refundOperations, [
      'RefundCustomerLocaleContract',
      'correctRefundCustomerLocale',
      'expectedLocaleVersion',
    ]) && includesAll(portalPage, [
      'Customer message language',
      'Not set — English fallback',
      'Existing message history is unchanged',
      'handleCorrectCustomerLocale',
    ]) && includesAll(portalUat, [
      'buildLocaleCorrectionOverview',
      'runCustomerLocaleCorrectionChecks',
      'performs no message, provider, payment, or official case action',
    ])
  );
  assert(
    'Internal/test disposition is authorized, immutable, audit-only, and excluded from customer queues',
    includesAll(internalTestMigration, [
      'admin_classify_refund_case_internal_test',
      'not public.is_super_admin(actor_user_id)',
      'p_expected_case_version',
      "case_population = 'internal_test'",
      "status = 'closed'",
      "automation_state = 'closed_incomplete'",
      "'internal_test_classified'",
      "'customer_message_sent', false",
      "'provider_call_made', false",
      "'reporting_adjustment_created', false",
      "'internalTestCases'",
      "'payload_redacted', true",
    ]) && includesAll(internalTestTest, [
      'A routine Machine Manager cannot classify Internal/test records',
      'An unresolved provider outcome cannot be mislabeled as no customer refund',
      'A queued unsent customer message is suppressed',
      'The database rejects every new refund attempt for an Internal/test record',
      'Routine managers see the record in neither customer counts nor the restricted archive',
      'Classification creates no reporting adjustment',
    ]) && includesAll(refundOperations, [
      'RefundInternalTestContract',
      'classifyRefundCaseInternalTest',
      'internalTestCases',
    ]) && includesAll(portalPage, [
      'Internal/test — no customer refund',
      'Move to Internal/test archive',
      'handleClassifyInternalTest',
      'refund-internal-test-confirmation-dialog',
    ]) && includesAll(messageSend, [
      'internal_test_customer_contact_suppressed',
      'case_population',
    ]) && includesAll(adminUpdate, [
      'internal_test_customer_actions_suppressed',
      'case_population',
    ]) && includesAll(nayaxCardRefund, [
      'internal_test_refund_suppressed',
      'case_not_refundable',
      'case_population',
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
        'validateRefundGptReviewedDraft',
        'service_enqueue_refund_manual_message_intent',
      ]) &&
      includesAll(manualMessageOutbox, [
        'deliveryKind: "manual"',
        'service_record_refund_gpt_triage_delivery',
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
    'Completed Nayax searches still reach one customer-correction action when needed',
    includesAll(automationSweep, [
      'runPersistedNayaxCustomerCorrectionSweep',
      'deriveNayaxCustomerCorrectionFields',
      'nayax_persisted_result_customer_contacted',
      'customer_correction_fields',
    ]) &&
      includesAll(nayaxCustomerCorrection, [
        'card_last4_mismatch',
        'duplicate_transaction',
        'provider_machine_mismatch',
      ])
  );
  assert(
    'Verified replies can correct the same no-safe-match case and rerun matching',
    includesAll(gmailSync, [
      '.from("refund_follow_up_cycles")',
      '.eq("reason_code", "no_safe_match")',
      'allowCustomerCorrection',
      'labeled_customer_correction_v3',
    ]) &&
      automationSweep.includes('source: "customer_reply_recheck"')
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
