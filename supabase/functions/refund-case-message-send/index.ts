import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import {
  getRefundGmailMailboxIdentities,
  REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
  RefundGmailError,
} from "../_shared/refund-gmail.ts";
import {
  buildBrandedRefundHtmlFromStoredText,
  buildEditableRefundCustomerEmail,
  buildRefundCustomerEmail,
  getRefundReplyToEmail,
  type RefundCustomerMessageType,
  sanitizeRefundMessageType,
} from "../_shared/refund-email.ts";
import {
  deriveRefundMissingFields,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "../_shared/refund-deterministic-follow-up.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";
import { validateRefundGptReviewedDraft } from "../_shared/refund-gpt-triage-policy.mjs";
import { validateRefundCustomerMessageRequest } from "../_shared/refund-evidence-selection.ts";
import { authorizeRefundSyntheticGmailProof } from "../_shared/refund-synthetic-gmail-proof.ts";
import { deliverNayaxCompletionOnce } from "../_shared/nayax-resolution-completion.ts";
import {
  assertOpenNayaxCompletionMessageLane,
  RefundNayaxCompletionMessageLaneBlockedError,
} from "../_shared/nayax-resolution-message-lane.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const nayaxExecutorAssertion = Deno.env.get("NAYAX_REFUND_EXECUTOR_ASSERTION")
  ?.trim() ?? "";

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

type OneOrMany<T> = T | T[] | null | undefined;

type RefundCaseRow = {
  id: string;
  public_reference: string;
  status: string;
  decision_reason: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  card_wallet_used: boolean;
  card_last4: string | null;
  reporting_machine_id: string | null;
  reporting_location_id: string | null;
  incident_at: string | null;
  incident_time_resolution: string | null;
  reporting_machines?: OneOrMany<{
    machine_label: string | null;
    refund_public_display_label: string | null;
  }>;
  reporting_locations?: OneOrMany<{ name: string | null }>;
};

type RefundGptTriageRow = {
  id: string;
  refund_case_id: string;
  status: string;
  route: string;
  policy_flags: string[];
  missing_fields: string[];
};

const firstRelation = <T>(value: OneOrMany<T>) =>
  Array.isArray(value) ? value[0] ?? null : value ?? null;

const allowedPortalMessageTypes = new Set<RefundCustomerMessageType>([
  "more_info",
  "status_update",
  "approved",
  "denied",
  "completed",
]);

const selectCaseQuery = `
  id,
  public_reference,
  status,
  decision_reason,
  customer_email,
  customer_name,
  payment_method,
  payment_amount_cents,
  refund_amount_cents,
  card_wallet_used,
  card_last4,
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_time_resolution,
  reporting_machines(machine_label, refund_public_display_label),
  reporting_locations(name)
`;

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

const syncAutomationFields = async (
  refundCaseId: string,
  messageType: RefundCustomerMessageType,
) => {
  if (!supabase) return;

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

  await supabase
    .from("refund_cases")
    .update({
      automation_state: nextAutomationState,
      customer_last_contacted_at: new Date().toISOString(),
      last_customer_message_type: messageType,
      automation_follow_up_due_at: null,
    })
    .eq("id", refundCaseId);
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
      return jsonResponse(
        { error: "Refund messaging is not configured." },
        500,
      );
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

    const nayaxCompletionMessageId = sanitizeText(
      body?.nayaxCompletionMessageId,
      80,
    );
    const nayaxCompletionRecoveryMessageId = sanitizeText(
      body?.nayaxCompletionRecoveryMessageId,
      80,
    );
    if (nayaxCompletionMessageId && nayaxCompletionRecoveryMessageId) {
      return jsonResponse({
        error: "Choose one exact customer-completion recovery action.",
      }, 400);
    }
    if (nayaxCompletionRecoveryMessageId) {
      if (
        !isUuid(nayaxCompletionRecoveryMessageId) ||
        Object.keys(body ?? {}).some((key) =>
          !["caseId", "nayaxCompletionRecoveryMessageId"].includes(key)
        )
      ) {
        return jsonResponse({
          error:
            "Review the exact interrupted completion before recovering it.",
        }, 400);
      }
      const { data: canManageCase, error: accessError } = await supabase.rpc(
        "can_manage_refund_case",
        { p_user_id: user.id, p_refund_case_id: caseId },
      );
      if (accessError) throw accessError;
      if (!canManageCase) {
        return jsonResponse({ error: "Refund case access required." }, 403);
      }

      const { data: formPrepared, error: formPrepareError } = await supabase
        .rpc(
          "service_prepare_nayax_form_completion_retry",
          {
            p_refund_case_id: caseId,
            p_refund_case_message_id: nayaxCompletionRecoveryMessageId,
            p_mailbox_identities: getRefundGmailMailboxIdentities(),
          },
        );
      const formRetry = formPrepared && typeof formPrepared === "object"
        ? formPrepared as Record<string, unknown>
        : null;
      if (formPrepareError) {
        return jsonResponse({
          error:
            "The website completion is not ready for its one email-only retry.",
        }, 409);
      }
      if (formRetry?.applicable === true) {
        const managerCcEmails = Array.isArray(formRetry.managerCcEmails)
          ? formRetry.managerCcEmails.filter((value): value is string =>
            typeof value === "string"
          ).map((value) => value.trim().toLowerCase())
          : [];
        const managerCcCount = Number(formRetry.managerCcCount);
        const managerRecipientOverlap =
          formRetry.managerRecipientOverlap === true;
        const attemptId = typeof formRetry.attemptId === "string"
          ? formRetry.attemptId
          : "";
        const recipientEmail = typeof formRetry.recipientEmail === "string"
          ? formRetry.recipientEmail
          : "";
        const subject = typeof formRetry.subject === "string"
          ? formRetry.subject
          : "";
        const messageBody = typeof formRetry.body === "string"
          ? formRetry.body
          : "";
        if (
          formRetry.prepared !== true || formRetry.refundCaseId !== caseId ||
          formRetry.refundCaseMessageId !== nayaxCompletionRecoveryMessageId ||
          !isUuid(attemptId) || !recipientEmail || !subject || !messageBody ||
          !Number.isSafeInteger(managerCcCount) || managerCcCount < 0 ||
          managerCcCount > 3 || managerCcCount !== managerCcEmails.length ||
          new Set(managerCcEmails).size !== managerCcEmails.length ||
          (managerCcCount === 0 && !managerRecipientOverlap) ||
          formRetry.transport !== "transactional_email" ||
          formRetry.originalThread !== false ||
          formRetry.providerCallMade !== false ||
          formRetry.payloadRedacted !== true
        ) {
          return jsonResponse({
            error: "The website completion email route could not be verified.",
          }, 409);
        }

        const customerCompletion = await deliverNayaxCompletionOnce({
          deliver: async () => {
            await sendTransactionalEmail({
              to: [recipientEmail],
              cc: managerCcEmails,
              subject,
              text: messageBody,
              html: buildBrandedRefundHtmlFromStoredText({
                headline: "Your refund is on its way",
                text: messageBody,
              }),
              replyTo: getRefundReplyToEmail(),
            });
            return true;
          },
          finish: async (status) => {
            const { data: finished, error: finishError } = await supabase.rpc(
              "service_finish_nayax_refund_form_completion",
              {
                p_executor_assertion: "",
                p_attempt_id: attemptId,
                p_delivery_status: status,
                p_manager_cc_count: managerCcCount,
                p_manager_recipient_overlap: managerRecipientOverlap,
              },
            );
            if (finishError || !finished || typeof finished !== "object") {
              throw new Error("completion_settlement_failed");
            }
            return finished as Record<string, unknown> & {
              status: "sent" | "failed" | "delivery_unknown" | "already_sent";
            };
          },
          isDeliveryUncertain: (error) => error instanceof TypeError,
        });

        return jsonResponse({
          recovery: {
            recovered: true,
            status: customerCompletion.status,
            transport: "transactional_email",
            originalThread: false,
            outboundPresent: false,
            providerCallMade: false,
            payloadRedacted: true,
          },
        });
      }

      if (!/^[A-Za-z0-9_-]{32,200}$/.test(nayaxExecutorAssertion)) {
        return jsonResponse({
          error: "The controlled Gmail completion recovery is not configured.",
        }, 503);
      }
      const { data: recovered, error: recoveryError } = await supabase.rpc(
        "service_recover_stale_nayax_completion",
        {
          p_executor_assertion: nayaxExecutorAssertion,
          p_refund_case_id: caseId,
          p_refund_case_message_id: nayaxCompletionRecoveryMessageId,
        },
      );
      const recovery = recovered && typeof recovered === "object"
        ? recovered as Record<string, unknown>
        : null;
      if (
        recoveryError || recovery?.recovered !== true ||
        recovery.refundCaseId !== caseId ||
        recovery.refundCaseMessageId !== nayaxCompletionRecoveryMessageId ||
        !["sent", "already_sent", "failed", "delivery_unknown"].includes(
          typeof recovery.status === "string" ? recovery.status : "",
        ) || recovery.transport !== "gmail_thread" ||
        recovery.originalThread !== true ||
        recovery.providerCallMade !== false ||
        recovery.payloadRedacted !== true
      ) {
        return jsonResponse({
          error:
            "The interrupted completion is not ready for safe recovery. Wait five minutes, refresh, and inspect the original Gmail thread.",
        }, 409);
      }

      return jsonResponse({ recovery });
    }
    if (nayaxCompletionMessageId) {
      if (
        !isUuid(nayaxCompletionMessageId) ||
        Object.keys(body ?? {}).some((key) =>
          !["caseId", "nayaxCompletionMessageId"].includes(key)
        )
      ) {
        return jsonResponse({
          error: "Review the exact failed completion before retrying it.",
        }, 400);
      }
      if (!/^[A-Za-z0-9_-]{32,200}$/.test(nayaxExecutorAssertion)) {
        return jsonResponse({
          error: "The controlled completion retry is not configured.",
        }, 503);
      }

      const { data: canManageCase, error: accessError } = await supabase.rpc(
        "can_manage_refund_case",
        { p_user_id: user.id, p_refund_case_id: caseId },
      );
      if (accessError) throw accessError;
      if (!canManageCase) {
        return jsonResponse({ error: "Refund case access required." }, 403);
      }

      const { data: prepared, error: prepareError } = await supabase.rpc(
        "service_prepare_nayax_completion_retry",
        {
          p_executor_assertion: nayaxExecutorAssertion,
          p_refund_case_message_id: nayaxCompletionMessageId,
        },
      );
      const retry = prepared && typeof prepared === "object"
        ? prepared as Record<string, unknown>
        : null;
      if (
        prepareError || retry?.prepared !== true ||
        retry.refundCaseId !== caseId ||
        retry.refundCaseMessageId !== nayaxCompletionMessageId ||
        typeof retry.attemptId !== "string" || !isUuid(retry.attemptId) ||
        typeof retry.gmailThreadId !== "string" ||
        !isUuid(retry.gmailThreadId) ||
        typeof retry.recipientEmail !== "string" ||
        typeof retry.subject !== "string" || typeof retry.body !== "string"
      ) {
        return jsonResponse({
          error:
            "This completion is not eligible for a safe retry. Refresh and reconcile the original Gmail thread.",
        }, 409);
      }

      const retryAttemptId = retry.attemptId as string;
      const retryGmailThreadId = retry.gmailThreadId as string;
      const retryRecipientEmail = retry.recipientEmail as string;
      const retrySubject = retry.subject as string;
      const retryBody = retry.body as string;

      const customerCompletion = await deliverNayaxCompletionOnce({
        deliver: async () => {
          const gmailDelivery = await dispatchRefundCaseGmailReply({
            supabase,
            refundCaseId: caseId,
            refundCaseMessageId: nayaxCompletionMessageId,
            recipientEmail: retryRecipientEmail,
            email: {
              subject: retrySubject,
              text: retryBody,
              html: buildBrandedRefundHtmlFromStoredText({
                headline: "Your refund is on its way",
                text: retryBody,
              }),
            },
            deliveryKind: "manual",
            gmailThreadId: retryGmailThreadId,
          });
          return gmailDelivery.usedGmail;
        },
        finish: async (status) => {
          const { data: finished, error: finishError } = await supabase.rpc(
            "service_finish_nayax_refund_completion",
            {
              p_executor_assertion: nayaxExecutorAssertion,
              p_attempt_id: retryAttemptId,
              p_delivery_status: status,
            },
          );
          if (finishError || !finished || typeof finished !== "object") {
            throw new Error("completion_settlement_failed");
          }
          return finished as Record<string, unknown> & {
            status: "sent" | "failed" | "delivery_unknown" | "already_sent";
          };
        },
        isDeliveryUncertain: (error) =>
          error instanceof RefundGmailError && error.deliveryUncertain,
      });

      if (
        customerCompletion.status === "sent" ||
        customerCompletion.status === "already_sent"
      ) {
        return jsonResponse({
          message: {
            id: nayaxCompletionMessageId,
            type: "completed",
            status: "sent",
            subject: retrySubject,
            transport: "gmail_thread",
          },
          customerCompletion,
        });
      }

      return jsonResponse({
        error: customerCompletion.status === "delivery_unknown"
          ? REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE
          : "Unable to send the controlled customer completion email.",
        errorCode: customerCompletion.status === "delivery_unknown"
          ? "gmail_delivery_reconciliation_required"
          : "customer_email_delivery_failed",
      }, 502);
    }

    const messageType = sanitizeRefundMessageType(body?.messageType);
    if (!messageType || !allowedPortalMessageTypes.has(messageType)) {
      return jsonResponse({
        error: "Choose an approved customer message template.",
      }, 400);
    }

    const triageSuggestionId = sanitizeText(body?.triageSuggestionId, 80);
    const suppliedMissingFields = sanitizeRefundMissingFields(
      body?.missingFields,
    );
    let triageSuggestion: RefundGptTriageRow | null = null;
    if (triageSuggestionId) {
      if (!isUuid(triageSuggestionId) || messageType !== "more_info") {
        return jsonResponse({
          error: "Valid missing-information triage review required.",
        }, 400);
      }
      const { data: triageData, error: triageError } = await supabase
        .from("refund_gpt_triage_runs")
        .select(
          "id, refund_case_id, status, route, policy_flags, missing_fields",
        )
        .eq("id", triageSuggestionId)
        .eq("refund_case_id", caseId)
        .maybeSingle();
      if (triageError) throw triageError;
      triageSuggestion = triageData as RefundGptTriageRow | null;
      if (
        !triageSuggestion ||
        triageSuggestion.status !== "ready_for_review" ||
        triageSuggestion.route !== "draft_reply" ||
        (triageSuggestion.policy_flags ?? []).length > 0
      ) {
        return jsonResponse({
          error: "This suggested reply requires a new human review.",
        }, 409);
      }
    }

    if (messageType !== "more_info" && suppliedMissingFields.length > 0) {
      return jsonResponse({
        error:
          "Missing-detail fields apply only to the missing-information template.",
      }, 400);
    }

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );

    if (accessError) throw accessError;
    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    await assertOpenNayaxCompletionMessageLane({
      checkOpen: async () => {
        const { data: laneOpen, error: laneError } = await supabase.rpc(
          "service_refund_nayax_completion_message_lane_open",
          { p_refund_case_id: caseId },
        );
        if (laneError) throw laneError;
        return laneOpen === true;
      },
    });

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }

    if (!refundCase.customer_email) {
      return jsonResponse({
        error: "Customer email is missing for this refund case.",
      }, 400);
    }

    const derived = deriveRefundMissingFields({
      reportingMachineId: refundCase.reporting_machine_id,
      reportingLocationId: refundCase.reporting_location_id,
      incidentAt: refundCase.incident_at,
      incidentTimeResolution: refundCase.incident_time_resolution,
      paymentMethod: refundCase.payment_method,
      paymentAmountCents: refundCase.payment_amount_cents,
      cardLast4: refundCase.card_last4,
      cardWalletUsed: refundCase.card_wallet_used,
    });
    const reviewedMissingFields = triageSuggestion
      ? sanitizeRefundMissingFields(triageSuggestion.missing_fields)
      : suppliedMissingFields;
    let missingFields: RefundMissingField[] = [];
    if (messageType === "more_info") {
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
      if (!sameMissingFields(reviewedMissingFields, derived.missingFields)) {
        return jsonResponse({
          error:
            "The case facts changed. Refresh before asking for the exact missing purchase details.",
        }, 409);
      }
      missingFields = derived.missingFields;
    }

    const customerMessageError = validateRefundCustomerMessageRequest({
      paymentMethod: refundCase.payment_method,
      caseStatus: refundCase.status,
      messageType,
    });
    if (customerMessageError) {
      return jsonResponse({ error: customerMessageError }, 409);
    }

    const machine = firstRelation(refundCase.reporting_machines);
    const location = firstRelation(refundCase.reporting_locations);
    const publicLabels = resolveRefundPublicLabels({
      locationName: location?.name,
      publicMachineLabel: machine?.refund_public_display_label,
      machineLabel: machine?.machine_label,
    });
    const templateInput = {
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
    };
    const defaultEmail = buildRefundCustomerEmail(templateInput);
    const requestedSubject = sanitizeText(body?.subject, 180);
    const requestedBody = sanitizeText(body?.body, 4000);
    const email = requestedBody || requestedSubject
      ? buildEditableRefundCustomerEmail({
        input: templateInput,
        subject: requestedSubject || defaultEmail.subject,
        body: requestedBody || defaultEmail.text,
      })
      : defaultEmail;

    if (triageSuggestion) {
      const reviewedDraft = validateRefundGptReviewedDraft({
        subject: email.subject,
        body: email.text,
        missingFields: triageSuggestion.missing_fields,
      });
      if (!reviewedDraft.ok) {
        return jsonResponse({
          error:
            "The reviewed reply includes wording that is not safe for missing-information triage.",
        }, 400);
      }
    }

    const syntheticProof = await authorizeRefundSyntheticGmailProof({
      supabase,
      refundCaseId: refundCase.id,
      recipientEmail: refundCase.customer_email,
      runToken: body?.syntheticProofRunToken,
      messageType,
      defaultTemplateOnly: !triageSuggestionId &&
        suppliedMissingFields.length === 0 &&
        !requestedSubject &&
        !requestedBody,
    });

    const { data: messageRow, error: messageError } = await supabase
      .from("refund_case_messages")
      .insert({
        refund_case_id: refundCase.id,
        message_type: messageType,
        status: "pending",
        recipient_email: refundCase.customer_email,
        subject: email.subject,
        body: email.text,
        template_key: `refund_${messageType}_editable_v1`,
        created_by: user.id,
        content_source: triageSuggestion
          ? "manager_reviewed_gpt"
          : "manager_authored",
        delivery_kind: "manual",
        reason_code: messageType === "more_info" ? "missing_information" : null,
        template_version: null,
        requested_fields: messageType === "more_info" ? missingFields : [],
        synthetic_gmail_proof_authorization_id: syntheticProof.authorizationId,
      })
      .select("id")
      .single();

    if (messageError) throw messageError;

    try {
      const gmailDelivery = await dispatchRefundCaseGmailReply({
        supabase,
        refundCaseId: refundCase.id,
        refundCaseMessageId: messageRow.id,
        recipientEmail: refundCase.customer_email,
        email,
        deliveryKind: "manual",
        gmailThreadId: syntheticProof.gmailThreadId,
        syntheticProofAuthorizationId: syntheticProof.authorizationId,
      });
      if (!gmailDelivery.usedGmail) {
        await sendTransactionalEmail({
          to: [refundCase.customer_email],
          cc: gmailDelivery.managerCcEmails,
          subject: email.subject,
          text: email.text,
          html: email.html,
          replyTo: getRefundReplyToEmail(),
        });
      }

      await supabase
        .from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail
            ? gmailDelivery.subject
            : email.subject,
        })
        .eq("id", messageRow.id);

      await syncAutomationFields(refundCase.id, messageType);

      let triageReviewStatus: "not_applicable" | "recorded" | "record_failed" =
        "not_applicable";
      if (triageSuggestion) {
        const { error: triageReviewError } = await supabase.rpc(
          "service_record_refund_gpt_triage_delivery",
          {
            p_triage_id: triageSuggestion.id,
            p_refund_case_id: refundCase.id,
            p_reviewer_user_id: user.id,
            p_sent_message_id: messageRow.id,
            p_subject: email.subject,
            p_body: email.text,
          },
        );
        if (triageReviewError) {
          triageReviewStatus = "record_failed";
          console.error(
            "refund-case-message-send triage review record failed",
            {
              errorType: triageReviewError.name ?? "database_error",
              triageReview: true,
              payloadRedacted: true,
            },
          );
        } else {
          triageReviewStatus = "recorded";
        }
      }

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        actor_user_id: user.id,
        event_type: "customer_message_sent",
        message: gmailDelivery.usedGmail
          ? `Manager sent ${
            messageType.replaceAll("_", " ")
          } reply in the linked Gmail thread.`
          : `Manager sent ${
            messageType.replaceAll("_", " ")
          } email from the portal.`,
        metadata: {
          message_type: messageType,
          message_id: messageRow.id,
          transport: gmailDelivery.usedGmail
            ? "gmail_thread"
            : "transactional_email",
          manager_cc_count: gmailDelivery.managerCcCount,
          recipient_resolution_status: gmailDelivery.recipientResolutionStatus,
          triage_review_status: triageReviewStatus,
          payload_redacted: true,
        },
      });

      return jsonResponse({
        message: {
          id: messageRow.id,
          type: messageType,
          status: "sent",
          subject: email.subject,
          transport: gmailDelivery.usedGmail
            ? "gmail_thread"
            : "transactional_email",
          triageReviewStatus,
        },
      });
    } catch (emailError) {
      const safeErrorCode = emailError instanceof RefundGmailError
        ? emailError.code
        : "customer_email_delivery_failed";
      const deliveryUncertain = emailError instanceof RefundGmailError &&
        emailError.deliveryUncertain;
      console.error("refund-case-message-send customer email failed", {
        errorType: emailError instanceof Error
          ? emailError.name
          : typeof emailError,
        messageType,
        errorCode: safeErrorCode,
      });

      await supabase
        .from("refund_case_messages")
        .update({
          status: "failed",
          error_message: deliveryUncertain
            ? REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE
            : safeErrorCode,
        })
        .eq("id", messageRow.id);

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCase.id,
        actor_user_id: user.id,
        event_type: "customer_message_failed",
        message: "Portal customer email could not be sent.",
        metadata: {
          message_type: messageType,
          message_id: messageRow.id,
          error_code: safeErrorCode,
          payload_redacted: true,
        },
      });

      return jsonResponse({
        error: deliveryUncertain
          ? REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE
          : safeErrorCode === "gmail_automatic_contact_paused"
          ? "Automatic email is paused after a delivery failure. Review the Gmail thread and customer address before sending."
          : safeErrorCode === "manager_cc_required"
          ? "Customer email is paused until the case has at least one current active mapped Machine Manager to copy."
          : "Unable to send customer email.",
        errorCode: safeErrorCode,
      }, 502);
    }
  } catch (error) {
    if (error instanceof RefundNayaxCompletionMessageLaneBlockedError) {
      return jsonResponse({
        error:
          "Resolve the stored Nayax customer completion before sending another customer message.",
      }, 409);
    }
    console.error("refund-case-message-send error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return jsonResponse({ error: "Unable to send customer email." }, 500);
  }
});
