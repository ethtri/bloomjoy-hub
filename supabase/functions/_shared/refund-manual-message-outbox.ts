import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  buildRefundStoredTextWithStatus,
  sendRefundTransactionalEmail,
} from "./refund-email.ts";
import { dispatchRefundCaseGmailReply } from "./refund-gmail-transport.ts";
import { RefundGmailError } from "./refund-gmail.ts";
import { automaticRefundCustomerContactEnabled } from "./refund-deterministic-follow-up.ts";
import { tryIssueRefundStatusCapabilityForMessage } from "./refund-status-capability.ts";
import {
  bindRefundTransactionalDelivery,
  markRefundTransactionalDeliveryAttempt,
  RefundTransactionalDeliveryGateError,
} from "./refund-transactional-delivery.ts";
import { TransactionalEmailDeliveryUnknownError } from "./internal-email.ts";
import { issueRefundCorrectionForMessage, STORED_CORRECTION_LINK_MARKER } from "./refund-correction-delivery.ts";
import { renderBloomjoyRefundStoredText } from "./refund-email-brand.ts";
import { renderRefundGiftCardEmail } from "./refund-gift-card-email.ts";
import { refundCustomerLocaleFromIntakeMeta } from "./refund-language.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_STATUS_LINK_MARKER =
  "[Secure refund status link included at delivery]";
export const refundManualMessageOutboxEnabled = () =>
  Deno.env.get("REFUND_MANUAL_MESSAGE_OUTBOX_ENABLED")?.trim().toLowerCase() !==
    "false";
const refundAutomationEnabled = () =>
  Deno.env.get("REFUND_AUTOMATION_ENABLED")?.trim().toLowerCase() === "true";
export const refundOutboxAutomaticSendGate = (
  deliveryKind: "manual" | "automatic",
  customerAcceptedGiftCard = false,
) => {
  if (deliveryKind === "manual" || customerAcceptedGiftCard) return null;
  if (!refundAutomationEnabled()) return "refund_automation_disabled" as const;
  if (!automaticRefundCustomerContactEnabled()) {
    return "automatic_contact_disabled" as const;
  }
  return null;
};

class RefundOutboxGateError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RefundOutboxGateError";
  }
}

export type RefundManualMessageClaimReference = {
  messageId: string;
  claimToken: string;
};

export type RefundManualMessageDeliveryResult = {
  messageId: string;
  outcome: "sent" | "failed" | "delivery_unknown" | "deferred";
  transport: "gmail_thread" | "transactional_email" | null;
  managerCcCount: number;
  recipientResolutionStatus: string | null;
  triageReviewStatus: "not_applicable" | "recorded" | "record_failed";
  payloadRedacted: true;
};

type RefundManualMessageRow = {
  id: string;
  refund_case_id: string;
  message_type: string;
  template_version: string | null;
  gift_card_issuance_id: string | null;
  status: string;
  recipient_email: string;
  subject: string;
  body: string;
  delivery_kind: "manual" | "automatic";
  template_version: string | null;
  nayax_refund_attempt_id: string | null;
  manual_delivery_intent_id: string;
  manual_delivery_provider_attempted_at: string | null;
  delivery_transport: string | null;
  provider_message_id: string | null;
  delivery_state: string | null;
  delivery_state_updated_at: string | null;
  manual_delivery_state: string;
  manual_delivery_claim_token: string;
  manual_delivery_expected_case_version: number;
  manual_delivery_status_link_requested: boolean;
  synthetic_gmail_proof_authorization_id: string | null;
  manual_delivery_triage_suggestion_id: string | null;
  created_by: string;
};

export const refundManualMessageManagerCopyPolicy = (
  message: Pick<RefundManualMessageRow, "message_type" | "delivery_kind">,
) =>
  ["more_info", "completed"].includes(message.message_type) &&
      message.delivery_kind === "manual"
    ? "customer_thread_only" as const
    : message.delivery_kind === "automatic"
    ? "automatic_portal_only" as const
    : "manager_cc_required" as const;

const PROVIDER_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{8,255}$/;
const automaticTransactionalRecovery = (
  message: RefundManualMessageRow,
): "sent" | "failed" | "delivery_unknown" | null => {
  if (
    message.delivery_kind !== "automatic" ||
    message.delivery_transport === null
  ) {
    return null;
  }
  if (
    message.delivery_transport !== "resend" ||
    !message.delivery_state_updated_at
  ) {
    throw new Error("Automatic transactional delivery evidence is invalid.");
  }
  if (
    message.provider_message_id &&
    PROVIDER_MESSAGE_ID_PATTERN.test(message.provider_message_id) &&
    ["accepted", "deferred", "delivered"].includes(message.delivery_state ?? "")
  ) {
    return "sent";
  }
  if (
    message.provider_message_id === null && message.delivery_state === "unknown"
  ) {
    return "delivery_unknown";
  }
  if (
    message.provider_message_id &&
    PROVIDER_MESSAGE_ID_PATTERN.test(message.provider_message_id) &&
    ["failed", "bounced", "complained"].includes(message.delivery_state ?? "")
  ) {
    return "failed";
  }
  throw new Error("Automatic transactional delivery evidence is invalid.");
};

const safeErrorCode = (error: unknown, deliveryUnknown: boolean) => {
  if (
    error && typeof error === "object" && "code" in error &&
    typeof error.code === "string" && /^[a-z0-9_:-]{3,160}$/.test(error.code)
  ) {
    return error.code;
  }
  if (deliveryUnknown) return "manual_delivery_result_unknown";
  return "manual_delivery_failed";
};

const requireClaimReferences = (
  value: unknown,
): RefundManualMessageClaimReference[] => {
  if (!Array.isArray(value)) {
    throw new Error("Manual-message outbox claim contract is invalid.");
  }
  return value.map((raw) => {
    const row = raw && typeof raw === "object"
      ? raw as Record<string, unknown>
      : {};
    const messageId = typeof row.refund_case_message_id === "string"
      ? row.refund_case_message_id
      : "";
    const claimToken = typeof row.claim_token === "string"
      ? row.claim_token
      : "";
    if (!UUID_PATTERN.test(messageId) || !UUID_PATTERN.test(claimToken)) {
      throw new Error("Manual-message outbox claim contract is invalid.");
    }
    return { messageId, claimToken };
  });
};

export const claimRefundManualMessageDeliveries = async ({
  supabase,
  messageId = null,
  limit = 10,
}: {
  supabase: SupabaseClient;
  messageId?: string | null;
  limit?: number;
}) => {
  if (messageId && !UUID_PATTERN.test(messageId)) {
    throw new Error("Manual-message outbox requires a valid message id.");
  }
  const boundedLimit = Number.isSafeInteger(limit)
    ? Math.min(25, Math.max(1, limit))
    : 10;
  const { data, error } = await supabase.rpc(
    "service_claim_refund_manual_message_deliveries",
    {
      p_refund_case_message_id: messageId,
      p_limit: boundedLimit,
    },
  );
  if (error) throw error;
  return requireClaimReferences(data);
};

const getClaimedMessage = async (
  supabase: SupabaseClient,
  reference: RefundManualMessageClaimReference,
) => {
  const { data, error } = await supabase
    .from("refund_case_messages")
    .select(`
      id,
      refund_case_id,
      message_type,
      template_version,
      gift_card_issuance_id,
      status,
      recipient_email,
      subject,
      body,
      delivery_kind,
      template_version,
      nayax_refund_attempt_id,
      manual_delivery_intent_id,
      manual_delivery_provider_attempted_at,
      delivery_transport,
      provider_message_id,
      delivery_state,
      delivery_state_updated_at,
      manual_delivery_state,
      manual_delivery_claim_token,
      manual_delivery_expected_case_version,
      manual_delivery_status_link_requested,
      synthetic_gmail_proof_authorization_id,
      manual_delivery_triage_suggestion_id,
      created_by
    `)
    .eq("id", reference.messageId)
    .eq("manual_delivery_claim_token", reference.claimToken)
    .maybeSingle();
  if (error) throw error;
  const message = data as RefundManualMessageRow | null;
  if (
    !message || message.status !== "pending" ||
    message.manual_delivery_state !== "claimed" ||
    message.manual_delivery_claim_token !== reference.claimToken ||
    !UUID_PATTERN.test(message.refund_case_id) ||
    !UUID_PATTERN.test(message.created_by) ||
    !Number.isSafeInteger(message.manual_delivery_expected_case_version) ||
    message.manual_delivery_expected_case_version < 1 ||
    !["manual", "automatic"].includes(message.delivery_kind) ||
    !message.recipient_email || !message.subject || !message.body
  ) {
    throw new Error("Manual-message outbox row is not deliverable.");
  }
  return message;
};

const finishClaim = async ({
  supabase,
  reference,
  outcome,
  transport,
  errorCode,
  managerCcCount,
  recipientResolutionStatus,
}: {
  supabase: SupabaseClient;
  reference: RefundManualMessageClaimReference;
  outcome: "sent" | "failed" | "delivery_unknown";
  transport: "gmail_thread" | "transactional_email" | null;
  errorCode: string | null;
  managerCcCount: number;
  recipientResolutionStatus: string | null;
}) => {
  const { data, error } = await supabase.rpc(
    "service_finish_refund_manual_message_delivery",
    {
      p_refund_case_message_id: reference.messageId,
      p_claim_token: reference.claimToken,
      p_outcome: outcome,
      p_transport: transport,
      p_error_code: errorCode,
      p_manager_cc_count: managerCcCount,
      p_recipient_resolution_status: recipientResolutionStatus,
    },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (error || result?.finished !== true || result.payloadRedacted !== true) {
    throw new Error("Manual-message delivery result could not be recorded.");
  }
  return result;
};

const deferAutomaticClaim = async ({
  supabase,
  reference,
  reason,
}: {
  supabase: SupabaseClient;
  reference: RefundManualMessageClaimReference;
  reason: "refund_automation_disabled" | "automatic_contact_disabled";
}) => {
  const { data, error } = await supabase.rpc(
    "service_defer_refund_automatic_completion_delivery",
    {
      p_refund_case_message_id: reference.messageId,
      p_claim_token: reference.claimToken,
      p_reason: reason,
    },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (error || result?.deferred !== true || result.payloadRedacted !== true) {
    throw new Error("Automatic completion deferral could not be recorded.");
  }
};

const recordReviewedTriageDelivery = async ({
  supabase,
  message,
  subject,
  body,
}: {
  supabase: SupabaseClient;
  message: RefundManualMessageRow;
  subject: string;
  body: string;
}) => {
  if (!message.manual_delivery_triage_suggestion_id) {
    return "not_applicable" as const;
  }
  const { error } = await supabase.rpc(
    "service_record_refund_gpt_triage_delivery",
    {
      p_triage_id: message.manual_delivery_triage_suggestion_id,
      p_refund_case_id: message.refund_case_id,
      p_reviewer_user_id: message.created_by,
      p_sent_message_id: message.id,
      p_subject: subject,
      p_body: body,
    },
  );
  if (error) {
    console.error("refund manual-message triage review record failed", {
      errorType: "database_error",
      payloadRedacted: true,
    });
    return "record_failed" as const;
  }
  return "recorded" as const;
};

const markProviderAttempt = async (
  supabase: SupabaseClient,
  reference: RefundManualMessageClaimReference,
) => {
  const { data, error } = await supabase.rpc(
    "service_mark_refund_manual_message_provider_attempt",
    {
      p_refund_case_message_id: reference.messageId,
      p_claim_token: reference.claimToken,
    },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (
    !error && result?.payloadRedacted === true && result.marked === false &&
    result.status === "automatic_contact_disabled"
  ) {
    throw new RefundOutboxGateError("automatic_contact_disabled");
  }
  if (error || result?.marked !== true || result.payloadRedacted !== true) {
    throw new Error("Manual-message provider attempt could not be marked.");
  }
};

export const deliverRefundManualMessageClaim = async ({
  supabase,
  reference,
}: {
  supabase: SupabaseClient;
  reference: RefundManualMessageClaimReference;
}): Promise<RefundManualMessageDeliveryResult> => {
  const message = await getClaimedMessage(supabase, reference);
  const { data: currentCase, error: caseError } = await supabase
    .from("refund_cases")
    .select("official_action_version,case_population,customer_email,customer_name,intake_meta,deterministic_fact_version")
    .eq("id", message.refund_case_id)
    .maybeSingle();
  if (caseError) throw caseError;

  if (
    !currentCase || currentCase.case_population === "internal_test" ||
    currentCase.official_action_version !==
      message.manual_delivery_expected_case_version ||
    String(currentCase.customer_email ?? "").trim().toLowerCase() !==
      message.recipient_email.trim().toLowerCase()
  ) {
    await finishClaim({
      supabase,
      reference,
      outcome: "failed",
      transport: null,
      errorCode: currentCase?.case_population === "internal_test"
        ? "internal_test_customer_contact_suppressed"
        : "manual_delivery_case_version_changed",
      managerCcCount: 0,
      recipientResolutionStatus: null,
    });
    return {
      messageId: message.id,
      outcome: "failed",
      transport: null,
      managerCcCount: 0,
      recipientResolutionStatus: null,
      triageReviewStatus: "not_applicable",
      payloadRedacted: true,
    };
  }

  const transactionalRecovery = automaticTransactionalRecovery(message);
  const managerCopyPolicy = refundManualMessageManagerCopyPolicy(message);

  const baseBody = message.body.replaceAll(STORED_STATUS_LINK_MARKER, "")
    .trim();
  const statusCapability = message.manual_delivery_status_link_requested && !message.body.includes(STORED_CORRECTION_LINK_MARKER)
    ? await tryIssueRefundStatusCapabilityForMessage({
      supabase,
      refundCaseId: message.refund_case_id,
      refundCaseMessageId: message.id,
    })
    : null;
  const storedEmail = buildRefundStoredTextWithStatus({
    headline: message.subject,
    text: baseBody,
    statusUrl: statusCapability?.url ?? null,
  });
  let email = {
    subject: message.subject,
    text: storedEmail.text,
    html: storedEmail.html,
  };
  let providerAttemptStarted = false;
  let providerAccepted = false;
  try {
  if (message.template_version === "refund_gift_card_v1" && !transactionalRecovery) {
    const { data: issuance, error: issuanceError } = await supabase
      .from("refund_gift_card_issuances")
      .select("code_id,face_value_cents,currency,expires_at,eligible_locations,redemption_instructions")
      .eq(message.gift_card_issuance_id ? "id" : "message_id", message.gift_card_issuance_id ?? message.id).single();
    if (issuanceError || !issuance) throw new Error("Gift-card delivery receipt is unavailable.");
    const { data: card, error: codeError } = await supabase.from("refund_gift_card_codes")
      .select("code,status").eq("id", issuance.code_id).single();
    if (codeError || !card || card.status !== "issued" || Date.parse(issuance.expires_at) <= Date.now()) {
      throw new Error("Assigned gift-card code is unavailable.");
    }
    email = renderRefundGiftCardEmail({ customerName: currentCase.customer_name,
      customerLocale: refundCustomerLocaleFromIntakeMeta(currentCase.intake_meta),
      value: issuance.face_value_cents, currency: issuance.currency,
      code: card.code, expiresAt: issuance.expires_at, eligibleLocations: issuance.eligible_locations,
      redemptionInstructions: issuance.redemption_instructions });
  }

    if (transactionalRecovery) {
      await markProviderAttempt(supabase, reference);
      providerAttemptStarted = true;
      const sent = transactionalRecovery === "sent";
      const errorCode = transactionalRecovery === "delivery_unknown"
        ? "transactional_delivery_reconciliation_required"
        : transactionalRecovery === "failed"
        ? `transactional_delivery_${message.delivery_state}`
        : null;
      await finishClaim({
        supabase,
        reference,
        outcome: transactionalRecovery,
        transport: sent ? "transactional_email" : null,
        errorCode,
        managerCcCount: 0,
        recipientResolutionStatus: null,
      });
      return {
        messageId: message.id,
        outcome: transactionalRecovery,
        transport: sent ? "transactional_email" : null,
        managerCcCount: 0,
        recipientResolutionStatus: null,
        triageReviewStatus: "not_applicable",
        payloadRedacted: true,
      };
    }
    if (
      message.delivery_kind === "automatic" &&
      message.manual_delivery_provider_attempted_at === null
    ) {
      const automaticGate = refundOutboxAutomaticSendGate(
        message.delivery_kind,
        message.template_version === "refund_gift_card_v1",
      );
      if (automaticGate) throw new RefundOutboxGateError(automaticGate);
    }
    if (message.body.includes(STORED_CORRECTION_LINK_MARKER)) {
      const correctionUrl = await issueRefundCorrectionForMessage({ supabase, messageId: message.id, factVersion: currentCase.deterministic_fact_version });
      const correctionText = baseBody.replaceAll(STORED_CORRECTION_LINK_MARKER, correctionUrl);
      email = { subject: message.subject, text: correctionText, html: renderBloomjoyRefundStoredText({
        headline: message.subject, text: baseBody.replaceAll(STORED_CORRECTION_LINK_MARKER, ''),
        primaryLink: { label: message.subject.startsWith('Actualice') ? 'Actualizar su solicitud / Update your request' : 'Update your request', url: correctionUrl },
      }) };
    }
    // The immutable receipt intent owns its original customer conversation.
    // Never infer a latest thread from the case or rewrite payment state here.
    let receiptThreadId: string | undefined;
    if (message.delivery_kind === "automatic" &&
      message.template_version === "refund_receipt_completion_v1" &&
      message.nayax_refund_attempt_id !== null && message.nayax_refund_attempt_id !== undefined) {
      if (!UUID_PATTERN.test(message.manual_delivery_intent_id ?? "")) {
        throw new Error("Receipt completion intent binding is invalid.");
      }
      const { data: boundIntent, error: bindingError } = await supabase
        .from("refund_receipt_completion_intents")
        .select("gmail_thread_id")
        .eq("intent_id", message.manual_delivery_intent_id)
        .eq("refund_case_id", message.refund_case_id)
        .eq("message_id", message.id)
        .maybeSingle();
      if (bindingError) throw bindingError;
      if (!boundIntent || !UUID_PATTERN.test(boundIntent.gmail_thread_id ?? "")) {
        throw new Error("Receipt completion source binding is unavailable.");
      }
      receiptThreadId = boundIntent.gmail_thread_id;
    }
    await markProviderAttempt(supabase, reference);
    providerAttemptStarted = true;
    const gmailDelivery = message.template_version === "refund_gift_card_v1"
      ? { usedGmail: false, managerCcEmails: [], managerCcCount: 0, recipientResolutionStatus: "resolved" }
      : await dispatchRefundCaseGmailReply({
      supabase,
      refundCaseId: message.refund_case_id,
      refundCaseMessageId: message.id,
      recipientEmail: message.recipient_email,
      email,
      deliveryKind: message.delivery_kind,
      managerCopyPolicy,
      gmailThreadId: receiptThreadId,
      syntheticProofAuthorizationId:
        message.synthetic_gmail_proof_authorization_id,
    });
    providerAccepted = gmailDelivery.usedGmail;
    if (!gmailDelivery.usedGmail) {
      const automaticGate = refundOutboxAutomaticSendGate(
        message.delivery_kind,
        message.template_version === "refund_gift_card_v1",
      );
      if (automaticGate) throw new RefundOutboxGateError(automaticGate);
      await markRefundTransactionalDeliveryAttempt({
        supabase,
        refundCaseMessageId: message.id,
      });
      const receipt = await sendRefundTransactionalEmail({
        to: [message.recipient_email],
        cc: gmailDelivery.managerCcEmails,
        managerCopyPolicy,
        subject: email.subject,
        text: email.text,
        html: email.html,
        idempotencyKey: `refund-message-${message.id}`,
      });
      providerAccepted = true;
      await bindRefundTransactionalDelivery({
        supabase,
        refundCaseMessageId: message.id,
        receipt,
      });
    }

    const transport = gmailDelivery.usedGmail
      ? "gmail_thread" as const
      : "transactional_email" as const;
    await finishClaim({
      supabase,
      reference,
      outcome: "sent",
      transport,
      errorCode: null,
      managerCcCount: gmailDelivery.managerCcCount,
      recipientResolutionStatus: gmailDelivery.recipientResolutionStatus,
    });
    const triageReviewStatus = await recordReviewedTriageDelivery({
      supabase,
      message,
      subject: email.subject,
      body: baseBody,
    });
    return {
      messageId: message.id,
      outcome: "sent",
      transport,
      managerCcCount: gmailDelivery.managerCcCount,
      recipientResolutionStatus: gmailDelivery.recipientResolutionStatus,
      triageReviewStatus,
      payloadRedacted: true,
    };
  } catch (error) {
    if (
      error instanceof RefundGmailError &&
      error.code === "gmail_shutdown_claim_settlement_failed"
    ) {
      throw error;
    }
    const automaticGateReason = error instanceof RefundOutboxGateError
      ? error.code
      : error instanceof RefundTransactionalDeliveryGateError
      ? error.code
      : error instanceof RefundGmailError && [
          "refund_automation_disabled",
          "automatic_contact_disabled",
        ].includes(error.code)
      ? error.code
      : null;
    if (
      message.delivery_kind === "automatic" && !providerAccepted &&
      ["refund_automation_disabled", "automatic_contact_disabled"].includes(
        automaticGateReason ?? "",
      )
    ) {
      await deferAutomaticClaim({
        supabase,
        reference,
        reason: automaticGateReason as
          | "refund_automation_disabled"
          | "automatic_contact_disabled",
      });
      return {
        messageId: message.id,
        outcome: "deferred",
        transport: null,
        managerCcCount: 0,
        recipientResolutionStatus: null,
        triageReviewStatus: "not_applicable",
        payloadRedacted: true,
      };
    }
    const deliveryUnknown =
      (error instanceof RefundGmailError && error.deliveryUncertain) ||
      error instanceof TransactionalEmailDeliveryUnknownError ||
      providerAccepted;
    const outcome = deliveryUnknown
      ? "delivery_unknown" as const
      : "failed" as const;
    const errorCode = safeErrorCode(error, deliveryUnknown);
    try {
      await finishClaim({
        supabase,
        reference,
        outcome,
        transport: null,
        errorCode,
        managerCcCount: 0,
        recipientResolutionStatus: null,
      });
    } catch (finishError) {
      // Preserve the active claim when settlement is uncertain. The bounded
      // stale-claim worker will reuse this exact message/idempotency identity.
      console.error("refund manual-message result settlement failed", {
        errorType: finishError instanceof Error
          ? finishError.name
          : typeof finishError,
        providerAttemptStarted,
        payloadRedacted: true,
      });
      throw finishError;
    }
    return {
      messageId: message.id,
      outcome,
      transport: null,
      managerCcCount: 0,
      recipientResolutionStatus: null,
      triageReviewStatus: "not_applicable",
      payloadRedacted: true,
    };
  }
};

export const drainRefundManualMessageOutbox = async ({
  supabase,
  messageId = null,
  limit = 10,
  deliverClaim = deliverRefundManualMessageClaim,
}: {
  supabase: SupabaseClient;
  messageId?: string | null;
  limit?: number;
  deliverClaim?: typeof deliverRefundManualMessageClaim;
}) => {
  if (!refundManualMessageOutboxEnabled()) return [];
  const claims = await claimRefundManualMessageDeliveries({
    supabase,
    messageId,
    limit,
  });
  const results: RefundManualMessageDeliveryResult[] = [];
  for (const reference of claims) {
    results.push(
      await deliverClaim({ supabase, reference }),
    );
  }
  return results;
};
