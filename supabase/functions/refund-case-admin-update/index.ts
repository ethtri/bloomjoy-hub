import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildRefundCustomerEmail,
  type RefundCustomerMessageType,
  sanitizeRefundMessageType,
  sendRefundCustomerEmail,
} from "../_shared/refund-email.ts";
import {
  deriveRefundMissingFields,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "../_shared/refund-deterministic-follow-up.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import {
  REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
  RefundGmailError,
} from "../_shared/refund-gmail.ts";
import {
  authorizeRefundOfficialAction,
  type RefundOfficialAction,
  RefundOfficialActionAuthorizationError,
} from "../_shared/refund-official-action.ts";
import {
  validateCardPreExecutionRequest,
  validateRefundEvidenceSelectionRequest,
} from "../_shared/refund-evidence-selection.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength = 800) =>
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

const centsFromInput = (value: unknown): number | null => {
  if (value === null || typeof value === "undefined") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const timestampFromInput = (value: unknown): string | null => {
  const normalized = sanitizeText(value, 80);
  if (!normalized) return null;
  const timestamp = new Date(normalized);
  return Number.isFinite(timestamp.getTime()) ? timestamp.toISOString() : null;
};

type RefundCaseRow = {
  id: string;
  public_reference: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  refund_amount_cents: number | null;
  payment_amount_cents: number | null;
  card_wallet_used: boolean;
  card_last4: string | null;
  reporting_machine_id: string;
  reporting_location_id: string;
  incident_at: string | null;
  incident_time_resolution: string | null;
  nayax_refund_execution_status: string;
  official_action_version: number;
  updated_at: string;
  reporting_machines?: {
    machine_label: string | null;
    refund_public_display_label: string | null;
  } | null;
  reporting_locations?: { name: string | null } | null;
};

type NayaxLookupCandidateRow = {
  provider_transaction_id: string;
  site_id: number | null;
  machine_authorization_time: string;
  amount_cents: number | null;
  card_last4: string | null;
  currency_code: string | null;
  evidence_summary: Record<string, unknown> | null;
};

const nayaxDisagreementReasons = new Set([
  "closer_time",
  "correct_amount",
  "correct_card",
  "customer_confirmation",
  "provider_data_issue",
  "other_review_reason",
]);

const selectCaseQuery = `
  id,
  public_reference,
  status,
  decision,
  decision_reason,
  customer_email,
  customer_name,
  payment_method,
  refund_amount_cents,
  payment_amount_cents,
  card_wallet_used,
  card_last4,
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_time_resolution,
  nayax_refund_execution_status,
  official_action_version,
  updated_at,
  reporting_machines(machine_label, refund_public_display_label),
  reporting_locations(name)
`;

const managerActionMessageTypes = new Set<RefundCustomerMessageType>([
  "more_info",
  "status_update",
  "approved",
  "denied",
  "completed",
]);

const officialStatuses = new Set([
  "approved",
  "denied",
  "card_refund_pending",
  "cash_zelle_pending",
  "completed",
]);

const providerHoldStatuses = new Set([
  "requested",
  "failed",
  "ambiguous",
  "manual_review",
  "declined",
]);

const normalizeDecision = (value: unknown) => {
  const normalized = sanitizeText(value, 80).toLowerCase();
  if (normalized === "approve") return "approved";
  if (normalized === "deny") return "denied";
  return normalized || null;
};

const resolveOfficialAction = ({
  beforeRow,
  requestedStatus,
  requestedDecision,
}: {
  beforeRow: RefundCaseRow;
  requestedStatus: string | null;
  requestedDecision: string | null;
}): RefundOfficialAction | null => {
  const effectiveStatus = requestedStatus;
  const effectiveDecision = requestedDecision;

  if (effectiveStatus === "completed") {
    return beforeRow.payment_method === "cash"
      ? "cash_complete"
      : "nayax_execute";
  }
  if (effectiveStatus === "denied" || effectiveDecision === "denied") {
    return "decline";
  }
  if (
    (effectiveStatus && officialStatuses.has(effectiveStatus)) ||
    effectiveDecision === "approved"
  ) {
    return "approve";
  }
  return null;
};

const getRefundCase = async (caseId: string): Promise<RefundCaseRow | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("refund_cases")
    .select(selectCaseQuery)
    .eq("id", caseId)
    .maybeSingle();

  if (error) throw error;
  return data as RefundCaseRow | null;
};

const sameMissingFields = (
  left: RefundMissingField[],
  right: RefundMissingField[],
) =>
  left.length === right.length &&
  left.every((field, index) => field === right[index]);

const getNayaxLookupCandidate = async (
  caseId: string,
  candidateToken: string,
): Promise<NayaxLookupCandidateRow | null> => {
  if (!supabase || !candidateToken) return null;
  if (!isUuid(candidateToken)) return null;

  const { data, error } = await supabase
    .from("refund_nayax_lookup_candidates")
    .select(
      "provider_transaction_id, site_id, machine_authorization_time, amount_cents, card_last4, currency_code, evidence_summary",
    )
    .eq("token", candidateToken)
    .eq("refund_case_id", caseId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) throw error;
  return data as NayaxLookupCandidateRow | null;
};

const nayaxTransactionIsLinkedElsewhere = async (
  caseId: string,
  providerTransactionId: string,
): Promise<boolean> => {
  if (!supabase || !providerTransactionId) return false;
  const { data, error } = await supabase
    .from("refund_cases")
    .select("id")
    .eq("matched_nayax_transaction_id", providerTransactionId)
    .neq("id", caseId)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
};

const resolveMessageType = (
  beforeRow: RefundCaseRow,
  afterRow: RefundCaseRow,
): RefundCustomerMessageType | null => {
  if (afterRow.status === "denied" && beforeRow.status !== "denied") {
    return "denied";
  }

  if (afterRow.status === "completed" && beforeRow.status !== "completed") {
    return "completed";
  }

  if (
    afterRow.decision === "approved" &&
    beforeRow.decision !== "approved" &&
    ["approved", "card_refund_pending", "cash_zelle_pending"].includes(
      afterRow.status,
    )
  ) {
    return "approved";
  }

  return null;
};

const syncAutomationState = async (
  refundCaseId: string,
  messageType: RefundCustomerMessageType | null,
) => {
  if (!supabase || !messageType) return;

  const nextAutomationState = {
    more_info: "more_info_needed",
    no_safe_match: "more_info_needed",
    information_received: "under_review",
    reminder: "more_info_needed",
    approved: "approved",
    denied: "denied",
    appeal_received: "appeal_received",
    completed: "completed",
    confirmation: "submitted",
    status_update: "under_review",
    wallet_correction: "more_info_needed",
    wallet_correction_reminder: "more_info_needed",
  }[messageType];

  const { error } = await supabase
    .from("refund_cases")
    .update({
      automation_state: nextAutomationState,
      customer_last_contacted_at: new Date().toISOString(),
      last_customer_message_type: messageType,
      automation_follow_up_due_at: null,
    })
    .eq("id", refundCaseId);

  if (error) throw error;
};

const logCustomerMessage = async ({
  refundCase,
  messageType,
  status,
  errorMessage,
  missingFields,
}: {
  refundCase: RefundCaseRow;
  messageType: RefundCustomerMessageType;
  status: "pending" | "sent" | "failed" | "skipped";
  errorMessage?: string | null;
  missingFields: RefundMissingField[];
}) => {
  if (!supabase) return null;

  const publicLabels = resolveRefundPublicLabels({
    locationName: refundCase.reporting_locations?.name,
    publicMachineLabel: refundCase.reporting_machines
      ?.refund_public_display_label,
    machineLabel: refundCase.reporting_machines?.machine_label,
  });

  const email = buildRefundCustomerEmail({
    messageType,
    publicReference: refundCase.public_reference,
    customerName: refundCase.customer_name,
    customerEmail: refundCase.customer_email,
    machineLabel: publicLabels.machineLabel,
    locationName: publicLabels.locationName,
    refundAmountCents: refundCase.refund_amount_cents ??
      refundCase.payment_amount_cents,
    paymentMethod: refundCase.payment_method,
    decisionReason: refundCase.decision_reason,
    missingFields,
    cardWalletUsed: refundCase.card_wallet_used,
  });

  const { data, error } = await supabase
    .from("refund_case_messages")
    .insert({
      refund_case_id: refundCase.id,
      message_type: messageType,
      status,
      recipient_email: refundCase.customer_email,
      subject: email.subject,
      body: email.text,
      template_key: `refund_${messageType}_v1`,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_message: errorMessage ?? null,
      content_source: "manager_authored",
      delivery_kind: "manual",
      reason_code: messageType === "more_info" ? "missing_information" : null,
      template_version: null,
      requested_fields: messageType === "more_info" ? missingFields : [],
    })
    .select("id")
    .single();

  if (error) throw error;
  return data?.id ?? null;
};

const sendAndLogCustomerMessage = async (
  refundCase: RefundCaseRow,
  messageType: RefundCustomerMessageType,
  missingFields: RefundMissingField[],
) => {
  if (!supabase) return { type: messageType, status: "failed" };

  if (!refundCase.customer_email) {
    await logCustomerMessage({
      refundCase,
      messageType,
      status: "skipped",
      errorMessage: "missing_customer_email",
      missingFields,
    });
    return { type: messageType, status: "skipped" };
  }

  const { data: existingMessage, error: existingMessageError } = await supabase
    .from("refund_case_messages")
    .select("id,status")
    .eq("refund_case_id", refundCase.id)
    .eq("message_type", messageType)
    .in("status", ["sent", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingMessageError) throw existingMessageError;
  if (existingMessage) {
    return { type: messageType, status: "skipped" };
  }

  const messageId = await logCustomerMessage({
    refundCase,
    messageType,
    status: "pending",
    missingFields,
  });

  try {
    const emailInput = {
      messageType,
      publicReference: refundCase.public_reference,
      customerName: refundCase.customer_name,
      customerEmail: refundCase.customer_email,
      machineLabel: refundCase.reporting_machines?.machine_label,
      locationName: refundCase.reporting_locations?.name,
      refundAmountCents: refundCase.refund_amount_cents ??
        refundCase.payment_amount_cents,
      paymentMethod: refundCase.payment_method,
      decisionReason: refundCase.decision_reason,
      missingFields,
      cardWalletUsed: refundCase.card_wallet_used,
    };
    const email = buildRefundCustomerEmail(emailInput);
    if (!messageId) {
      throw new RefundGmailError(
        "customer_message_record_required",
        "Customer delivery requires a tracked refund message.",
      );
    }
    const gmailDelivery = await dispatchRefundCaseGmailReply({
      supabase,
      refundCaseId: refundCase.id,
      refundCaseMessageId: messageId,
      recipientEmail: refundCase.customer_email,
      email,
      deliveryKind: "manual",
    });
    if (!gmailDelivery.usedGmail) {
      await sendRefundCustomerEmail({
        ...emailInput,
        managerCcEmails: gmailDelivery.managerCcEmails,
      });
    }

    if (messageId) {
      const { error: sentUpdateError } = await supabase
        .from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail
            ? gmailDelivery.subject
            : email.subject,
        })
        .eq("id", messageId);
      if (sentUpdateError) throw sentUpdateError;
    }

    await syncAutomationState(refundCase.id, messageType);

    const { error: eventError } = await supabase.from("refund_case_events")
      .insert({
        refund_case_id: refundCase.id,
        event_type: "customer_message_sent",
        message: gmailDelivery.usedGmail
          ? `Manager-approved ${
            messageType.replaceAll("_", " ")
          } reply sent in the linked Gmail thread.`
          : `Manager-approved ${messageType.replaceAll("_", " ")} email sent.`,
        metadata: {
          message_type: messageType,
          message_id: messageId,
          transport: gmailDelivery.usedGmail
            ? "gmail_thread"
            : "transactional_email",
          manager_cc_count: gmailDelivery.managerCcCount,
          recipient_resolution_status: gmailDelivery.recipientResolutionStatus,
          payload_redacted: true,
        },
      });
    if (eventError) throw eventError;

    return { type: messageType, status: "sent" };
  } catch (emailError) {
    const safeErrorCode = emailError instanceof RefundGmailError
      ? emailError.code
      : "customer_email_delivery_failed";
    const deliveryUncertain = emailError instanceof RefundGmailError &&
      emailError.deliveryUncertain;
    console.error("refund-case-admin-update customer email failed", {
      errorType: emailError instanceof Error
        ? emailError.name
        : typeof emailError,
      messageType,
      errorCode: safeErrorCode,
    });

    if (messageId) {
      const { error: failedUpdateError } = await supabase
        .from("refund_case_messages")
        .update({
          status: "failed",
          error_message: deliveryUncertain
            ? REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE
            : safeErrorCode,
        })
        .eq("id", messageId);
      if (failedUpdateError) {
        console.error(
          "refund-case-admin-update failed to mark customer email failed",
          {
            errorType: failedUpdateError instanceof Error
              ? failedUpdateError.name
              : typeof failedUpdateError,
          },
        );
      }
    }

    const { error: failedEventError } = await supabase.from(
      "refund_case_events",
    ).insert({
      refund_case_id: refundCase.id,
      event_type: "customer_message_failed",
      message: deliveryUncertain
        ? `Automated ${
          messageType.replaceAll("_", " ")
        } email delivery is uncertain. Reconcile the original Gmail thread before retrying.`
        : `Automated ${
          messageType.replaceAll("_", " ")
        } email failed. Case update remains recorded, but customer contact still needs retry.`,
      metadata: {
        message_type: messageType,
        message_id: messageId,
        error_code: safeErrorCode,
        payload_redacted: true,
      },
    });
    if (failedEventError) {
      console.error(
        "refund-case-admin-update failed to record customer email failure event",
        {
          errorType: failedEventError instanceof Error
            ? failedEventError.name
            : typeof failedEventError,
        },
      );
    }

    return { type: messageType, status: "failed" };
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!supabase) {
      return jsonResponse({
        error: "Refund update automation is not configured.",
      }, 500);
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(
      accessToken,
    );
    const user = authData?.user;
    if (authError || !user) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    const body = await req.json();
    const caseId = sanitizeText(body?.caseId, 80);
    if (!isUuid(caseId)) {
      return jsonResponse({ error: "Refund case is required." }, 400);
    }

    const beforeRow = await getRefundCase(caseId);
    if (!beforeRow) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) throw accessError;
    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const requestedStatus = sanitizeText(body?.status, 80).toLowerCase() ||
      null;
    const requestedDecision = normalizeDecision(body?.decision);
    const officialAction = resolveOfficialAction({
      beforeRow,
      requestedStatus,
      requestedDecision,
    });
    const requestedMessageType = sanitizeRefundMessageType(
      body?.customerMessageType,
    );
    if (
      providerHoldStatuses.has(beforeRow.nayax_refund_execution_status) &&
      (officialAction || requestedMessageType)
    ) {
      return jsonResponse({
        error: beforeRow.nayax_refund_execution_status === "declined"
          ? "Nayax rejected the refund. Leave the case open for payment support and do not send a customer decision from this case."
          : "Nayax has not confirmed whether the refund was sent. Do not try again or contact the customer until the payment outcome is confirmed.",
        errorCode: beforeRow.nayax_refund_execution_status === "declined"
          ? "provider_refund_rejected"
          : "provider_outcome_unconfirmed",
      }, 409);
    }
    if (officialAction === "nayax_execute") {
      return jsonResponse({
        error:
          "Card completion must be finalized by the guarded Nayax execution workflow.",
      }, 409);
    }

    if (
      officialAction === "decline" &&
      (sanitizeText(body?.matchedNayaxCandidateToken, 80) ||
        sanitizeText(body?.nayaxDisagreementReason, 80))
    ) {
      return jsonResponse({
        error:
          "Clear the selected Nayax transaction before declining this request.",
      }, 400);
    }

    if (officialAction) {
      const { data: canPerformOfficialAction, error: officialAccessError } =
        await supabase.rpc(
          "can_perform_refund_official_action",
          { p_user_id: user.id, p_refund_case_id: caseId },
        );
      if (officialAccessError) throw officialAccessError;
      if (!canPerformOfficialAction) {
        return jsonResponse({
          error: "A currently mapped Machine Manager must perform this action.",
          errorCode: "mapping_required",
        }, 403);
      }
    }

    const nayaxCandidateToken = sanitizeText(
      body?.matchedNayaxCandidateToken,
      80,
    );
    const clearNayaxMatch = Boolean(body?.clearNayaxMatch);
    const nayaxCandidate = !clearNayaxMatch && nayaxCandidateToken
      ? await getNayaxLookupCandidate(caseId, nayaxCandidateToken)
      : null;

    if (!clearNayaxMatch && nayaxCandidateToken && !nayaxCandidate) {
      return jsonResponse({
        error: "Nayax lookup evidence expired. Run lookup again.",
      }, 400);
    }
    if (
      nayaxCandidate &&
      await nayaxTransactionIsLinkedElsewhere(
        caseId,
        nayaxCandidate.provider_transaction_id,
      )
    ) {
      return jsonResponse({
        error:
          "This Nayax transaction is already linked to another refund case.",
      }, 409);
    }

    const nayaxEvidence = nayaxCandidate?.evidence_summary ?? {};
    const nayaxDisagreementReason = sanitizeText(
      body?.nayaxDisagreementReason,
      80,
    );
    const selectionAllowed = nayaxCandidate
      ? nayaxEvidence.selection_allowed === true
      : false;
    const isRecommended = nayaxCandidate
      ? nayaxEvidence.is_recommended === true
      : false;
    if (nayaxCandidate && !selectionAllowed) {
      return jsonResponse({
        error:
          "This Nayax transaction conflicts with required details or is already in use, so it cannot be selected.",
      }, 400);
    }
    if (
      nayaxCandidate && !isRecommended &&
      !nayaxDisagreementReasons.has(nayaxDisagreementReason)
    ) {
      return jsonResponse({
        error:
          "Choose why this alternate Nayax transaction is the correct one.",
      }, 400);
    }
    if (
      nayaxDisagreementReason &&
      !nayaxDisagreementReasons.has(nayaxDisagreementReason)
    ) {
      return jsonResponse(
        { error: "Choose an approved Nayax review reason." },
        400,
      );
    }

    if (
      requestedMessageType &&
      !managerActionMessageTypes.has(requestedMessageType)
    ) {
      return jsonResponse({
        error: "Choose an approved customer message type for this action.",
      }, 400);
    }

    const evidenceSelectionError = validateRefundEvidenceSelectionRequest({
      hasNayaxCandidate: Boolean(nayaxCandidate),
      requestedStatus,
      requestedDecision,
      requestedMessageType,
    });
    if (evidenceSelectionError) {
      return jsonResponse({ error: evidenceSelectionError }, 400);
    }

    const cardPreExecutionError = validateCardPreExecutionRequest({
      isCardCase: beforeRow.payment_method === "card",
      requestedStatus,
      requestedDecision,
      requestedMessageType,
    });
    if (cardPreExecutionError) {
      return jsonResponse({ error: cardPreExecutionError }, 400);
    }

    if (clearNayaxMatch) {
      const { error: closeEligibilityError } = await supabase
        .from("refund_cases")
        .update({ nayax_match_execution_eligible: false })
        .eq("id", caseId);
      if (closeEligibilityError) throw closeEligibilityError;
    }

    const suppliedCustomerMissingFields = sanitizeRefundMissingFields(
      body?.customerMissingFields,
    );
    let customerMissingFields: RefundMissingField[] = [];
    if (
      requestedMessageType &&
      !managerActionMessageTypes.has(requestedMessageType)
    ) {
      return jsonResponse({
        error: "Choose an approved customer message type for this action.",
      }, 400);
    }
    if (
      beforeRow.payment_method === "card" &&
      (requestedStatus === "completed" ||
        requestedMessageType === "approved" ||
        requestedMessageType === "completed")
    ) {
      return jsonResponse({
        error:
          "Card completion and customer success email require token-bound confirmed provider settlement. Use the guarded Nayax refund action.",
        errorCode: "provider_settlement_required",
      }, 409);
    }
    if (
      requestedMessageType !== "more_info" &&
      suppliedCustomerMissingFields.length > 0
    ) {
      return jsonResponse({
        error:
          "Missing-detail fields apply only to the missing-information template.",
      }, 400);
    }
    if (requestedMessageType === "more_info") {
      const derived = deriveRefundMissingFields({
        reportingMachineId: beforeRow.reporting_machine_id,
        reportingLocationId: beforeRow.reporting_location_id,
        incidentAt: beforeRow.incident_at,
        incidentTimeResolution: beforeRow.incident_time_resolution,
        paymentMethod: beforeRow.payment_method,
        paymentAmountCents: beforeRow.payment_amount_cents,
        cardLast4: beforeRow.card_last4,
        cardWalletUsed: beforeRow.card_wallet_used,
      });
      if (derived.requiresSecureWalletCorrection) {
        return jsonResponse({
          error:
            "Use the secure mobile-wallet correction link instead of requesting wallet information by email.",
        }, 409);
      }
      if (derived.missingFields.length === 0) {
        return jsonResponse({
          error:
            "This case has no structured purchase detail to request. Return it to manager review.",
        }, 409);
      }
      if (
        !sameMissingFields(suppliedCustomerMissingFields, derived.missingFields)
      ) {
        return jsonResponse({
          error:
            "The case facts changed. Refresh before asking for the exact missing purchase details.",
        }, 409);
      }
      customerMissingFields = derived.missingFields;
    }

    const isCashCompletion = officialAction === "cash_complete";
    const cashPayoutSentAt = timestampFromInput(body?.cashPayoutSentAt);
    if (isCashCompletion && body?.cashPaymentConfirmed !== true) {
      return jsonResponse({
        error: "Confirm that the cash refund payment was sent.",
      }, 400);
    }
    if (isCashCompletion && !cashPayoutSentAt) {
      return jsonResponse({
        error: "Enter a valid date and time for the cash refund payment.",
      }, 400);
    }

    const assignedManagerEmail =
      sanitizeText(body?.assignedManagerEmail, 320) || null;
    const decisionReason = sanitizeText(body?.decisionReason, 900) || null;
    const internalNote = sanitizeText(body?.internalNote, 1200) || null;
    const refundAmountCents = centsFromInput(body?.refundAmountCents);
    const manualRefundReference =
      sanitizeText(body?.manualRefundReference, 160) || null;
    const officialRefundAmountCents = officialAction === "decline"
      ? null
      : refundAmountCents;
    const officialManualRefundReference = isCashCompletion
      ? manualRefundReference
      : null;
    const officialCashPayoutSentAt = isCashCompletion ? cashPayoutSentAt : null;
    const officialCashPaymentConfirmed = isCashCompletion &&
      body?.cashPaymentConfirmed === true;
    const officialNayaxCandidateToken = officialAction === "approve"
      ? nayaxCandidateToken || null
      : null;
    const officialNayaxDisagreementReason = officialAction === "approve"
      ? nayaxDisagreementReason || null
      : null;
    const expectedOfficialActionVersion = Number(
      body?.expectedOfficialActionVersion,
    );
    const stepUpIntentId = sanitizeText(body?.stepUpIntentId, 80) || null;
    const stepUpFactorProof = sanitizeText(body?.stepUpFactorProof, 80) || null;

    const officialAuthorization = officialAction
      ? await authorizeRefundOfficialAction({
        supabaseUrl,
        supabaseAnonKey,
        accessToken,
        context: {
          caseId,
          action: officialAction,
          targetFunction: "refund-case-admin-update",
          stepUpIntentId,
          stepUpFactorProof,
          expectedCaseVersion: expectedOfficialActionVersion,
          targetStatus: requestedStatus,
          targetDecision: requestedDecision,
          assignedManagerEmail,
          decisionReason,
          internalNote,
          refundAmountCents: officialRefundAmountCents,
          manualRefundReference: officialManualRefundReference,
          cashPayoutSentAt: officialCashPayoutSentAt,
          cashPaymentConfirmed: officialCashPaymentConfirmed,
          matchedNayaxCandidateToken: officialNayaxCandidateToken,
          nayaxDisagreementReason: officialNayaxDisagreementReason,
        },
      })
      : null;

    const isNayaxEvidenceSelection = Boolean(
      nayaxCandidate &&
        !officialAction &&
        !clearNayaxMatch &&
        requestedStatus === "needs_review" &&
        requestedDecision === null &&
        requestedMessageType === null,
    );

    const updateRpc = isCashCompletion && officialAuthorization
      ? await supabase.rpc("service_complete_cash_refund_official", {
        p_authorization_id: officialAuthorization.authorizationId,
        p_case_id: caseId,
        p_refund_amount_cents: refundAmountCents,
        p_manual_refund_reference: manualRefundReference,
        p_cash_payout_sent_at: cashPayoutSentAt,
        p_decision_reason: decisionReason,
        p_internal_note: internalNote,
        p_assigned_manager_email: assignedManagerEmail,
      })
      : officialAction && officialAuthorization
      ? await supabase.rpc("service_apply_refund_official_case_update", {
        p_authorization_id: officialAuthorization.authorizationId,
        p_case_id: caseId,
        p_action: officialAction,
        p_status: requestedStatus,
        p_assigned_manager_email: assignedManagerEmail,
        p_decision: requestedDecision,
        p_decision_reason: decisionReason,
        p_internal_note: internalNote,
        p_refund_amount_cents: officialRefundAmountCents,
        p_manual_refund_reference: officialManualRefundReference,
        p_matched_nayax_candidate_token: officialNayaxCandidateToken,
        p_nayax_disagreement_reason: officialNayaxDisagreementReason,
      })
      : isNayaxEvidenceSelection
      ? await supabase.rpc("service_select_refund_nayax_candidate_as_actor", {
        p_actor_user_id: user.id,
        p_case_id: caseId,
        p_expected_case_version: expectedOfficialActionVersion,
        p_candidate_token: nayaxCandidateToken,
        p_nayax_disagreement_reason: nayaxDisagreementReason || null,
      })
      : await supabase.rpc("service_update_refund_case_as_actor", {
        p_actor_user_id: user.id,
        p_case_id: caseId,
        p_status: requestedStatus,
        p_assigned_manager_email: assignedManagerEmail,
        p_decision: requestedDecision,
        p_decision_reason: decisionReason,
        p_internal_note: internalNote,
        p_refund_amount_cents: refundAmountCents,
        p_manual_refund_reference: manualRefundReference,
        p_clear_nayax_match: clearNayaxMatch,
        p_matched_nayax_transaction_id:
          nayaxCandidate?.provider_transaction_id ?? null,
        p_matched_nayax_site_id: nayaxCandidate?.site_id ?? null,
        p_matched_nayax_machine_auth_time:
          nayaxCandidate?.machine_authorization_time ?? null,
        p_matched_nayax_amount_cents: nayaxCandidate?.amount_cents ?? null,
        p_matched_nayax_card_last4: nayaxCandidate?.card_last4 ?? null,
        p_matched_nayax_currency_code: nayaxCandidate?.currency_code ?? null,
      });

    const { data: updatedCase, error: updateError } = updateRpc;

    if (updateError) {
      if (updateError.code === "23505") {
        return jsonResponse({
          error:
            "This Nayax transaction is already linked to another refund case.",
        }, 409);
      }
      const safeMessage =
        typeof updateError.message === "string" && updateError.message.trim()
          ? updateError.message.slice(0, 240)
          : "Unable to update refund case.";
      return jsonResponse({ error: safeMessage }, 400);
    }

    if (nayaxCandidate && !officialAction && !isNayaxEvidenceSelection) {
      const recommendationState =
        sanitizeText(nayaxEvidence.recommendation_state, 80) ||
        "manual_exception";
      const policyVersion = sanitizeText(nayaxEvidence.policy_version, 80) ||
        null;
      const oneClickEligible = recommendationState === "high_confidence" &&
        isRecommended &&
        nayaxEvidence.one_click_eligible === true;
      const { error: eligibilityError } = await supabase
        .from("refund_cases")
        .update({
          nayax_recommendation_state: recommendationState,
          nayax_recommendation_policy_version: policyVersion,
          nayax_recommendation_evaluated_at: new Date().toISOString(),
          nayax_match_execution_eligible: oneClickEligible,
          correlation_confidence: 0,
          correlation_summary: oneClickEligible
            ? "Manager confirmed the recommended Nayax transaction using versioned evidence."
            : "Manager selected a Nayax transaction for manual review; one-click execution remains unavailable.",
        })
        .eq("id", caseId);
      if (eligibilityError) throw eligibilityError;

      const { error: evidenceEventError } = await supabase.from(
        "refund_case_events",
      ).insert({
        refund_case_id: caseId,
        actor_user_id: user.id,
        event_type: "nayax_match_selected",
        message: isRecommended
          ? "Manager confirmed the recommended Nayax transaction."
          : "Manager selected an alternate Nayax transaction after review.",
        metadata: {
          policy_version: policyVersion,
          recommendation_state: recommendationState,
          confidence_class: sanitizeText(nayaxEvidence.confidence_class, 80) ||
            "ambiguous_manual",
          reason_codes: Array.isArray(nayaxEvidence.reason_codes)
            ? nayaxEvidence.reason_codes
              .map((reason: unknown) => sanitizeText(reason, 80))
              .filter(Boolean)
              .slice(0, 20)
            : [],
          selected_recommended: isRecommended,
          selected_rank: Number(nayaxEvidence.recommendation_rank) || null,
          disagreement_reason_code: isRecommended
            ? null
            : nayaxDisagreementReason,
          execution_eligible: oneClickEligible,
          payload_redacted: true,
        },
      });
      if (evidenceEventError) {
        await supabase
          .from("refund_cases")
          .update({ nayax_match_execution_eligible: false })
          .eq("id", caseId);
        throw evidenceEventError;
      }
    }

    const cashUpdateResult =
      isCashCompletion && updatedCase && typeof updatedCase === "object"
        ? updatedCase as { updateApplied?: boolean }
        : null;
    const updateApplied = isCashCompletion
      ? cashUpdateResult?.updateApplied === true
      : Boolean(updatedCase);
    const afterRow = await getRefundCase(caseId);
    if (!afterRow) {
      return jsonResponse({
        error: "Refund case was updated but could not be reloaded.",
      }, 500);
    }

    const resolvedMessageType = updateApplied
      ? requestedMessageType ?? resolveMessageType(beforeRow, afterRow)
      : null;
    const messageType = beforeRow.payment_method === "card" &&
        (resolvedMessageType === "approved" ||
          resolvedMessageType === "completed")
      ? null
      : resolvedMessageType;
    const customerMessage = messageType
      ? await sendAndLogCustomerMessage(
        afterRow,
        messageType,
        customerMissingFields,
      )
      : null;

    return jsonResponse({
      refundCase: {
        id: afterRow.id,
        publicReference: afterRow.public_reference,
        status: afterRow.status,
        decision: afterRow.decision,
        officialActionVersion: afterRow.official_action_version,
      },
      customerMessage,
      updateApplied,
    });
  } catch (error) {
    if (error instanceof RefundOfficialActionAuthorizationError) {
      return jsonResponse(
        {
          error: error.message,
          errorCode: error.code,
          stepUpIntentId: error.stepUpIntentId,
          stepUpExpiresAt: error.stepUpExpiresAt,
          officialAction: error.action,
          targetFunction: error.targetFunction,
        },
        error.status,
      );
    }
    console.error("refund-case-admin-update error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to update refund case." }, 500);
  }
});
