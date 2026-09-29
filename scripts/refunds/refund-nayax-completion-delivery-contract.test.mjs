import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  'utf8',
).replaceAll('\r\n', '\n');

const orchestration = read(
  'supabase/migrations/202608040004_refund_nayax_provider_orchestration.sql',
);
const completionDelivery = read(
  'supabase/functions/_shared/nayax-refund-completion-delivery.ts',
);
const duplicateRecovery = read(
  'supabase/migrations/20260908221526_refund_same_source_duplicate_settlement_recovery.sql',
);
const messageSend = read(
  'supabase/functions/refund-case-message-send/index.ts',
);
const outcomeResolve = read(
  'supabase/functions/refund-nayax-outcome-resolve/index.ts',
);
const customerOnlyCompletion = read(
  'supabase/migrations/20260929164000_refund_completion_customer_only.sql',
);

test('normal claimed v2 completion is dispatched with its stored manual kind', () => {
  const claimStart = orchestration.indexOf(
    'create or replace function public.service_claim_nayax_refund_completion',
  );
  const claimEnd = orchestration.indexOf('\n$$;', claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claim = orchestration.slice(claimStart, claimEnd);
  assert.match(
    claim,
    /'deterministic_template',\s*'manual',\s*'refund_nayax_completion_v2'/,
  );

  const deliveryStart = completionDelivery.indexOf(
    'export const deliverNayaxRefundCustomerCompletion',
  );
  assert.ok(deliveryStart >= 0);
  const delivery = completionDelivery.slice(deliveryStart);
  assert.match(delivery, /deliveryKind: "manual"/);
  assert.match(delivery, /managerCopyPolicy: "customer_thread_only"/);
  assert.match(delivery, /claimPlainBody: claim\.body as string/);
  assert.doesNotMatch(delivery, /deliveryKind: "automatic"/);
  assert.match(delivery, /service_prepare_nayax_completion_retry/);
});

test('every provider-success completion transport settles customer-only recipients', () => {
  for (const source of [completionDelivery, outcomeResolve, messageSend]) {
    assert.match(source, /managerCopyPolicy: "customer_thread_only"/);
  }
  assert.match(
    completionDelivery,
    /deliveredManagerCcCount = gmailDelivery\.managerCcCount;[\s\S]*?deliveredManagerRecipientOverlap =\s*gmailDelivery\.managerRecipientOverlap;[\s\S]*?p_manager_cc_count: deliveredManagerCcCount,[\s\S]*?p_manager_recipient_overlap: deliveredManagerRecipientOverlap/,
  );
  assert.match(
    messageSend,
    /completionManagerCcCount = gmailDelivery\.managerCcCount;[\s\S]*?completionManagerRecipientOverlap =\s*gmailDelivery\.managerRecipientOverlap;[\s\S]*?p_manager_cc_count: completionManagerCcCount,[\s\S]*?p_manager_recipient_overlap:\s*completionManagerRecipientOverlap/,
  );
  assert.match(
    outcomeResolve,
    /p_manager_cc_count: formManagerCcCount,[\s\S]*?p_manager_recipient_overlap: formManagerRecipientOverlap/,
  );
  assert.match(
    outcomeResolve,
    /formManagerCcCount = gmailDelivery\.managerCcCount;[\s\S]*?formManagerRecipientOverlap =\s*gmailDelivery\.managerRecipientOverlap/,
  );
  assert.match(
    outcomeResolve,
    /formManagerCcCount = 0;[\s\S]*?formManagerRecipientOverlap = false;[\s\S]*?cc: \[\]/,
  );
  assert.match(outcomeResolve, /to: \[recipientEmail\],[\s\S]*?cc: \[\]/);
  assert.match(messageSend, /to: \[recipientEmail\],[\s\S]*?cc: \[\]/);
  assert.doesNotMatch(messageSend, /p_executor_assertion: ""/);
  assert.match(
    messageSend,
    /if \(nayaxCompletionRecoveryMessageId\) \{[\s\S]*?!\/\^\[A-Za-z0-9_\-\]\{32,200\}\$\/[\s\S]*?service_prepare_nayax_form_completion_retry/,
  );

  assert.match(
    customerOnlyCompletion,
    /create or replace function public\.service_finish_nayax_refund_completion\([\s\S]*?p_manager_cc_count integer,[\s\S]*?p_manager_recipient_overlap boolean/,
  );
  assert.match(
    customerOnlyCompletion,
    /completion_manager_cc_count = 0/,
  );
  assert.match(
    customerOnlyCompletion,
    /Sent Gmail proof with customer-only recipient policy is required/,
  );
  assert.match(
    customerOnlyCompletion,
    /Customer-only completion and current mapped Machine Manager route required/,
  );
  assert.doesNotMatch(
    customerOnlyCompletion,
    /emailed once with current mapped Machine Managers copied/,
  );
});

test('form completion uses the receipt-bound outbox claim instead of a Gmail thread', () => {
  const formClaimStart = duplicateRecovery.indexOf(
    'create function public.refund_claim_nayax_form_receipt_completion_internal',
  );
  const formClaimEnd = duplicateRecovery.indexOf('\n$$;', formClaimStart);
  assert.ok(formClaimStart >= 0 && formClaimEnd > formClaimStart);
  const formClaim = duplicateRecovery.slice(formClaimStart, formClaimEnd);
  assert.match(formClaim, /refund_receipt_completion_automation_authorities/);
  assert.match(formClaim, /refund_receipt_completion_intents/);
  assert.match(formClaim, /'refund_receipt_completion_v1'/);
  assert.match(formClaim, /message_row\.delivery_kind := 'automatic'/);
  assert.match(formClaim, /message_row\.manual_delivery_state := 'queued'/);
  assert.match(formClaim, /message_row\.manual_delivery_expected_case_version := case_row\.official_action_version/);

  const wrapperStart = duplicateRecovery.indexOf(
    'create or replace function public.service_claim_nayax_refund_completion',
  );
  const wrapperEnd = duplicateRecovery.indexOf('\n$$;', wrapperStart);
  const wrapper = duplicateRecovery.slice(wrapperStart, wrapperEnd);
  assert.match(wrapper, /receipt\.confirmation_source = 'api_stage_contract'/);
  assert.match(wrapper, /receipt\.attempt_binding_kind = 'proved_terminal_api'/);
  assert.match(wrapper, /not exists\(select 1 from public\.refund_gmail_threads/);
  assert.match(
    duplicateRecovery,
    /alter function public\.service_claim_nayax_refund_completion\(text, uuid\)\s+rename to refund_claim_nayax_refund_completion_pre_form_receipt_v1/,
  );
  assert.match(
    duplicateRecovery,
    /revoke all on function public\.refund_claim_nayax_refund_completion_pre_form_receipt_v1\(text, uuid\)\s+from public, anon, authenticated, service_role/,
  );
  assert.match(
    wrapper,
    /return public\.refund_claim_nayax_refund_completion_pre_form_receipt_v1\(\s*p_executor_assertion,\s*p_attempt_id\s*\)/,
  );

  const deliveryStart = completionDelivery.indexOf(
    'export const deliverNayaxRefundCustomerCompletion',
  );
  assert.ok(deliveryStart >= 0);
  const delivery = completionDelivery.slice(deliveryStart);
  assert.match(delivery, /parseNayaxFormReceiptClaim\(claim, caseId\)/);
  assert.match(delivery, /deliverNayaxFormReceiptCompletion/);
  assert.match(delivery, /drainRefundManualMessageOutbox\(\{/);
  assert.match(delivery, /messageId,/);
  assert.match(delivery, /limit: 1/);
});

test('exhausted completion inspection is authorized read-only evidence before every write or send', () => {
  const completionStart = messageSend.indexOf(
    'if (nayaxCompletionMessageId || nayaxExhaustedCompletionMessageId)',
  );
  const diagnosticStart = messageSend.indexOf(
    'const threadDiagnostic = diagnoseUnsentCompletionThreadHistory',
    completionStart,
  );
  const inspectionReturn = messageSend.indexOf(
    'if (inspectExhaustedRecovery)',
    diagnosticStart,
  );
  const strictWriteGuard = messageSend.indexOf(
    'if (!verifiedUnsentCompletionThreadHistory',
    inspectionReturn,
  );
  const prepare = messageSend.indexOf(
    'service_prepare_exhausted_nayax_completion_recovery',
    strictWriteGuard,
  );
  const dispatch = messageSend.indexOf(
    'dispatchRefundCaseGmailReply',
    prepare,
  );
  assert.ok(
    completionStart >= 0 && diagnosticStart > completionStart &&
      inspectionReturn > diagnosticStart && strictWriteGuard > inspectionReturn &&
      prepare > strictWriteGuard && dispatch > prepare,
  );

  const validation = messageSend.slice(completionStart, diagnosticStart);
  assert.match(
    validation,
    /\.rpc\("service_load_nayax_refund_completion",\s*\{\s*p_attempt_id: attemptId/,
  );
  assert.doesNotMatch(
    validation,
    /\.from\("refund_case_nayax_refund_attempts"\)/,
  );
  assert.match(
    validation,
    /governedCompletionThreadEvidence\(\{[\s\S]*?completionMessageId,[\s\S]*?recipientEmail: messageEvidence\.recipient_email/,
  );
  assert.match(
    validation,
    /exhaustedRecovery\s*\?\s*\["caseId", "nayaxExhaustedCompletionMessageId", "originalThreadHistoryId", "recoverySubject", "recoveryBody", "inspectExhaustedCompletionRecovery"\]\s*:\s*\["caseId", "nayaxCompletionMessageId"\]/,
  );
  assert.match(
    validation,
    /body\?\.inspectExhaustedCompletionRecovery !== undefined &&\s*!inspectExhaustedRecovery/,
  );

  const responseBranch = messageSend.slice(inspectionReturn, strictWriteGuard);
  assert.match(responseBranch, /customerMessageSent: false/);
  assert.match(responseBranch, /paymentActionTaken: false/);
  assert.match(responseBranch, /payloadRedacted: true/);
  assert.match(responseBranch, /inspectRefundGmailMessagesDirectedToRecipient/);
  assert.match(responseBranch, /verifyRefundGmailMailbox/);
  assert.match(responseBranch, /inspectRefundGmailMessagesAroundAudit/);
  assert.match(responseBranch, /diagnoseCleanOriginalCompletionThread/);
  assert.match(responseBranch, /diagnoseExternalCompletionCopy/);
  assert.match(responseBranch, /mailboxVerification/);
  assert.match(responseBranch, /auditWindowCopy/);
  assert.match(responseBranch, /mailboxQueries:\s*\{[\s\S]*?grouped:[\s\S]*?to:[\s\S]*?cc:[\s\S]*?bcc:[\s\S]*?union:[\s\S]*?payloadRedacted: true/);
  assert.match(responseBranch, /catch \{[\s\S]*?externalCopy: \{[\s\S]*?available: false/);
  const serializedResponseValues = [...responseBranch.matchAll(
    /return jsonResponse\(\{([\s\S]*?)\n\s*\}\);/g,
  )].map((match) => match[1]);
  assert.ok(serializedResponseValues.length >= 2);
  for (const response of serializedResponseValues) {
    assert.doesNotMatch(
      response,
      /recipient_email|gmailConfig\.(?:mailbox|senderEmail)|threadLink\.provider_thread_id|attemptEvidence\.(?:subject|body)|recoveryBody|recoverySubject/,
    );
  }
  assert.doesNotMatch(
    messageSend.slice(inspectionReturn, prepare),
    /(?:externalCopyDiagnostic|auditWindowCopyDiagnostic|originalThreadDiagnostic|mailboxVerification)\.valid/,
  );
  assert.doesNotMatch(
    messageSend.slice(inspectionReturn, prepare),
    /(?:externalCopyDiagnostic|auditWindowCopyDiagnostic|mailboxVerification)\.(?:mailboxMatch|available)/,
  );
});
