import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { Webhook } from "npm:svix@2.2.0";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { correctionLinkRequested, getCurrentRefundCorrectionFields, refundCorrectionLinksEnabled, STORED_CORRECTION_LINK_MARKER } from "../_shared/refund-correction-delivery.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { drainRefundManualMessageOutbox } from "../_shared/refund-manual-message-outbox.ts";
import {
  getRefundGmailMailboxIdentities,
  REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
  RefundGmailError,
} from "../_shared/refund-gmail.ts";
import {
  buildBrandedRefundHtmlFromStoredText,
  buildEditableRefundCustomerEmail,
  buildRefundCustomerEmail,
  sendRefundTransactionalEmail,
  type RefundCustomerMessageType,
  sanitizeRefundMessageType,
} from "../_shared/refund-email.ts";
import {
  deriveRefundMissingFields,
  type RefundMissingField,
  sanitizeRefundMissingFields,
} from "../_shared/refund-deterministic-follow-up.ts";
import { resolveRefundPublicLabels } from "../_shared/refund-location.ts";
import { refundCustomerLocaleFromIntakeMeta } from "../_shared/refund-language.ts";
import { validateRefundGptReviewedDraft } from "../_shared/refund-gpt-triage-policy.mjs";
import { validateRefundCustomerMessageRequest } from "../_shared/refund-evidence-selection.ts";
import { authorizeRefundSyntheticGmailProof } from "../_shared/refund-synthetic-gmail-proof.ts";
import { deliverNayaxCompletionOnce } from "../_shared/nayax-resolution-completion.ts";
import {
  assertOpenNayaxCompletionMessageLane,
  RefundNayaxCompletionMessageLaneBlockedError,
} from "../_shared/nayax-resolution-message-lane.ts";
import { refundStatusLinksEnabled } from "../_shared/refund-status-capability.ts";
import {
  bindRefundTransactionalDelivery,
  markRefundTransactionalDeliveryAttempt,
  parseRefundTransactionalDeliveryWebhook,
  sha256Hex,
} from "../_shared/refund-transactional-delivery.ts";

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
  official_action_version: number;
  case_population: string;
  public_reference: string;
  status: string;
  decision: string | null;
  decision_reason: string | null;
  customer_email: string;
  customer_name: string | null;
  payment_method: string | null;
  payment_amount_cents: number | null;
  refund_amount_cents: number | null;
  card_wallet_used: boolean;
  card_last4: string | null;
  zelle_payment_contact: string | null;
  reporting_machine_id: string | null;
  reporting_location_id: string | null;
  incident_at: string | null;
  incident_time_resolution: string | null;
  intake_meta: Record<string, unknown> | null;
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
  official_action_version,
  case_population,
  public_reference,
  status,
  decision,
  decision_reason,
  customer_email,
  customer_name,
  payment_method,
  payment_amount_cents,
  refund_amount_cents,
  card_wallet_used,
  card_last4,
  zelle_payment_contact,
  reporting_machine_id,
  reporting_location_id,
  incident_at,
  incident_time_resolution,
  intake_meta,
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

const handleTransactionalDeliveryWebhook = async (req: Request) => {
  if (!supabase) {
    return jsonResponse({ error: "Delivery tracking is unavailable." }, 503);
  }
  const secret = (Deno.env.get("RESEND_REFUND_WEBHOOK_SECRET") ?? "").trim();
  const eventId = (req.headers.get("svix-id") ?? "").trim();
  const timestamp = (req.headers.get("svix-timestamp") ?? "").trim();
  const signature = (req.headers.get("svix-signature") ?? "").trim();
  if (!secret || !eventId || !timestamp || !signature) {
    return jsonResponse({ error: "Invalid delivery webhook." }, 401);
  }
  const rawBody = await req.text();
  if (!rawBody || rawBody.length > 65_536) {
    return jsonResponse({ error: "Invalid delivery webhook." }, 400);
  }

  try {
    new Webhook(secret).verify(rawBody, {
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": signature,
    });
  } catch {
    return jsonResponse({ error: "Invalid delivery webhook." }, 401);
  }

  let event;
  try {
    // Svix 2.2 verifies the raw bytes and returns undefined, not parsed JSON.
    event = parseRefundTransactionalDeliveryWebhook(JSON.parse(rawBody));
  } catch {
    return jsonResponse({ error: "Invalid delivery webhook evidence." }, 400);
  }
  if (!event) {
    return jsonResponse({ accepted: true, tracked: false, payloadRedacted: true });
  }

  const { data, error } = await supabase.rpc(
    "service_record_refund_transactional_delivery_event",
    {
      p_event_key_digest: await sha256Hex(eventId),
      p_provider_message_id: event.providerMessageId,
      p_delivery_state: event.state,
      p_event_at: event.eventAt,
    },
  );
  const result = data && typeof data === "object"
    ? data as Record<string, unknown>
    : null;
  if (error || result?.payloadRedacted !== true) {
    console.error("refund delivery webhook record failed", {
      errorType: error?.name ?? "database_error",
      payloadRedacted: true,
    });
    return jsonResponse({ error: "Unable to record delivery state." }, 500);
  }
  return jsonResponse({
    accepted: true,
    tracked: true,
    duplicate: result.duplicate === true,
    matched: result.matched === true,
    applied: result.applied === true,
    payloadRedacted: true,
  });
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "POST" && req.headers.has("svix-id")) {
    return await handleTransactionalDeliveryWebhook(req);
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

    const { data: canManageCase, error: accessError } = await supabase.rpc(
      "can_manage_refund_case",
      { p_user_id: user.id, p_refund_case_id: caseId },
    );
    if (accessError) throw accessError;
    if (!canManageCase) {
      return jsonResponse({ error: "Refund case access required." }, 403);
    }

    const refundCase = await getRefundCase(caseId);
    if (!refundCase) {
      return jsonResponse({ error: "Refund case not found." }, 404);
    }
    if (refundCase.case_population === "internal_test") {
      return jsonResponse({
        error:
          "Customer messages are suppressed for this Internal/test archive record.",
        errorCode: "internal_test_customer_contact_suppressed",
      }, 409);
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
          managerCcCount > 4 || managerCcCount !== managerCcEmails.length ||
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
            await markRefundTransactionalDeliveryAttempt({
              supabase,
              refundCaseMessageId: nayaxCompletionRecoveryMessageId,
            });
            const receipt = await sendRefundTransactionalEmail({
              to: [recipientEmail],
              cc: managerCcEmails,
              subject,
              text: messageBody,
              html: buildBrandedRefundHtmlFromStoredText({
                headline: "Your refund is on its way",
                text: messageBody,
              }),
              idempotencyKey:
                `refund-message-${nayaxCompletionRecoveryMessageId}`,
            });
            await bindRefundTransactionalDelivery({
              supabase,
              refundCaseMessageId: nayaxCompletionRecoveryMessageId,
              receipt,
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
    const messageIntentId = sanitizeText(body?.messageIntentId, 80);
    const expectedCaseVersion = body?.expectedCaseVersion;
    if (
      !isUuid(messageIntentId) || !Number.isSafeInteger(expectedCaseVersion) ||
      expectedCaseVersion < 1
    ) {
      return jsonResponse({
        error: "Refresh the case before queueing this customer message.",
      }, 409);
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
      zellePaymentContact: refundCase.zelle_payment_contact,
      cashPayoutDestinationRequired:
        refundCase.payment_method === "cash" &&
        refundCase.decision === "approved",
    });
    const reviewedMissingFields = triageSuggestion
      ? sanitizeRefundMissingFields(triageSuggestion.missing_fields)
      : suppliedMissingFields;
    let missingFields: RefundMissingField[] = [];
    const correctionEnabled = await refundCorrectionLinksEnabled(supabase);
    if (messageType === "more_info") {
      const currentFields = correctionEnabled ? await getCurrentRefundCorrectionFields(supabase, caseId) : derived.missingFields;
      if (derived.requiresSecureWalletCorrection && !correctionEnabled) {
        return jsonResponse({
          error:
            "Use the secure mobile-wallet correction link instead of requesting wallet information by email.",
        }, 409);
      }
      if (currentFields.length === 0) {
        return jsonResponse({
          error:
            "This case has no structured purchase detail to request. Return it to manager review.",
        }, 409);
      }
      if (!sameMissingFields(reviewedMissingFields, currentFields)) {
        return jsonResponse({
          error:
            "The case facts changed. Refresh before asking for the exact missing purchase details.",
        }, 409);
      }
      missingFields = currentFields;
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
    const templateInputWithoutStatus = {
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
      statusUrl: null,
      correctionUrl: correctionLinkRequested(messageType, missingFields, correctionEnabled) ? STORED_CORRECTION_LINK_MARKER : null,
      customerLocale: refundCustomerLocaleFromIntakeMeta(refundCase.intake_meta),
    };
    const defaultEmailWithoutStatus = buildRefundCustomerEmail(templateInputWithoutStatus);
    const requestedSubject = sanitizeText(body?.subject, 180);
    const requestedBody = sanitizeText(body?.body, 4000);
    const emailWithoutStatus = requestedBody || requestedSubject
      ? buildEditableRefundCustomerEmail({
        input: templateInputWithoutStatus,
        subject: requestedSubject || defaultEmailWithoutStatus.subject,
        body: requestedBody || defaultEmailWithoutStatus.text,
      })
      : defaultEmailWithoutStatus;

    if (triageSuggestion) {
      const reviewedDraft = validateRefundGptReviewedDraft({
        subject: emailWithoutStatus.subject,
        body: emailWithoutStatus.text,
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

    const { data: enqueued, error: enqueueError } = await supabase.rpc(
      "service_enqueue_refund_manual_message_intent",
      {
        p_refund_case_id: refundCase.id,
        p_expected_case_version: expectedCaseVersion,
        p_intent_id: messageIntentId,
        p_actor_user_id: user.id,
        p_message_type: messageType,
        p_recipient_email: refundCase.customer_email,
        p_subject: emailWithoutStatus.subject,
        p_body: emailWithoutStatus.text,
        p_template_key: `refund_${messageType}_editable_v1`,
        p_content_source: triageSuggestion ? "manager_reviewed_gpt" : "manager_authored",
        p_reason_code: messageType === "more_info" ? "missing_information" : null,
        p_requested_fields: messageType === "more_info" ? missingFields : [],
        p_synthetic_proof_authorization_id: syntheticProof.authorizationId,
        p_status_link_requested: !templateInputWithoutStatus.correctionUrl && refundStatusLinksEnabled(),
        p_triage_suggestion_id: triageSuggestion?.id ?? null,
      },
    );
    const queued = enqueued && typeof enqueued === "object"
      ? enqueued as Record<string, unknown>
      : null;
    if (
      enqueueError || queued?.enqueued !== true ||
      typeof queued.messageId !== "string" || !isUuid(queued.messageId) ||
      queued.payloadRedacted !== true
    ) {
      const payoutContactExhausted = enqueueError?.code === "P4662";
      const conflict = ["P4609", "P4656", "P4657", "P4662"].includes(
        enqueueError?.code ?? "",
      );
      return jsonResponse({
        error: payoutContactExhausted
          ? "This payout-destination contact cycle is complete. Refund Operations must review the case before any new customer request."
          : conflict
          ? "The case or queued message changed. Refresh before sending."
          : "Unable to queue customer email.",
      }, conflict ? 409 : 500);
    }

    const deliveryResults = await drainRefundManualMessageOutbox({
      supabase,
      messageId: queued.messageId,
      limit: 1,
    });
    const delivery = deliveryResults[0] ?? null;
    if (delivery?.outcome === "sent") {
      return jsonResponse({
        message: {
          id: queued.messageId,
          type: messageType,
          status: "sent",
          subject: emailWithoutStatus.subject,
          transport: delivery.transport,
          triageReviewStatus: delivery.triageReviewStatus,
        },
      });
    }

    if (queued.outboxState === "sent" && queued.messageStatus === "sent") {
      const { data: replayedMessage, error: replayedMessageError } = await supabase
        .from("refund_case_messages")
        .select("delivery_transport")
        .eq("id", queued.messageId)
        .single();
      if (replayedMessageError) throw replayedMessageError;
      return jsonResponse({
        message: {
          id: queued.messageId,
          type: messageType,
          status: "sent",
          subject: emailWithoutStatus.subject,
          transport: replayedMessage.delivery_transport === "resend"
            ? "transactional_email"
            : "gmail_thread",
          triageReviewStatus: triageSuggestion ? "recorded" : "not_applicable",
        },
        replayed: true,
      });
    }

    return jsonResponse({
      error: delivery?.outcome === "delivery_unknown"
        ? REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE
        : "Unable to send customer email.",
      errorCode: delivery?.outcome === "delivery_unknown"
        ? "gmail_delivery_reconciliation_required"
        : "customer_email_delivery_failed",
    }, 502);
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
