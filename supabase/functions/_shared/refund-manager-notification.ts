import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  getInternalNotificationRecipients,
  sendTransactionalEmail,
  TransactionalEmailDeliveryUnknownError,
} from "./internal-email.ts";
import { getRefundGmailMailboxIdentities } from "./refund-gmail.ts";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_MANAGER_CC_RECIPIENTS = 4;
const MAX_OPS_FALLBACK_RECIPIENTS = 5;
const ROUTE_STATUS_PATTERN = /^[a-z0-9_]{1,80}$/;
const MAPPING_FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

const sanitizeEmailList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().toLowerCase())
        .filter((entry) => entry.length <= 320 && EMAIL_PATTERN.test(entry)),
    ),
  );
};

export const resolveRefundOpsFallbackRecipients = ({
  recipients,
  customerEmail,
  mailboxIdentities,
}: {
  recipients: unknown;
  customerEmail: string;
  mailboxIdentities: string[];
}): string[] => {
  const excluded = new Set([
    ...sanitizeEmailList([customerEmail]),
    ...sanitizeEmailList(mailboxIdentities),
  ]);
  const eligible = sanitizeEmailList(recipients).filter((email) =>
    !excluded.has(email)
  );
  return eligible.length <= MAX_OPS_FALLBACK_RECIPIENTS ? eligible : [];
};

const getPortalBaseUrl = () =>
  (Deno.env.get("BLOOMJOY_APP_URL") || Deno.env.get("PUBLIC_APP_URL") ||
    "https://app.bloomjoyusa.com")
    .replace(/\/+$/, "");

export const getRefundManagerCaseUrl = (refundCaseId: string) =>
  `${getPortalBaseUrl()}/refunds?case=${encodeURIComponent(refundCaseId)}`;

export type RefundManagerNoticeResult = {
  managerRecipientCount: number;
  recipientCount: number;
  resolutionStatus: string;
  usedOpsFallback: boolean;
  actionId?: string;
  attentionVersion?: number;
  channel: RefundManagerNotificationChannel;
  deliveryState: RefundManagerNotificationDeliveryState;
  noticeReason: RefundManagerNotificationReason;
};

export type RefundManagerNotificationChannel =
  | "immediate"
  | "daily_digest"
  | "portal_only";

export type RefundManagerNotificationDeliveryState =
  | "sent"
  | "delivery_unknown"
  | "known_not_sent"
  | "digest_eligible"
  | "portal_only";

export type RefundManagerNotificationReason =
  | "intake_created"
  | "wallet_match_ready"
  | "customer_reply"
  | "hard_bounce"
  | "provider_setup"
  | "provider_outage"
  | "provider_rejection"
  | "provider_timeout"
  | "provider_unknown"
  | "follow_up_manual_review"
  | "manager_reminder"
  | "manager_escalation"
  | "routine_customer_message"
  | "manager_authored_conversation"
  | "customer_completion_copy";

export const REFUND_MANAGER_NOTIFICATION_POLICY: Readonly<
  Record<RefundManagerNotificationReason, RefundManagerNotificationChannel>
> = {
  intake_created: "portal_only",
  wallet_match_ready: "immediate",
  customer_reply: "daily_digest",
  hard_bounce: "immediate",
  provider_setup: "immediate",
  provider_outage: "immediate",
  provider_rejection: "immediate",
  provider_timeout: "immediate",
  provider_unknown: "immediate",
  follow_up_manual_review: "immediate",
  manager_reminder: "daily_digest",
  manager_escalation: "immediate",
  routine_customer_message: "portal_only",
  manager_authored_conversation: "portal_only",
  customer_completion_copy: "portal_only",
};

export type RefundManagerNoticeRouting = {
  refundCaseId: string;
  customerEmail: string;
  recipients: string[];
  managerRecipientCount: number;
  recipientCount: number;
  resolutionStatus: string;
  usedOpsFallback: boolean;
  mappingFingerprint?: string;
};

export const getRefundManagerNoticeReservationRouteInputs = ({
  customerEmail,
}: {
  customerEmail: string;
}) => {
  const mailboxIdentities = getRefundGmailMailboxIdentities();
  return {
    mailboxIdentities,
    opsFallbackRecipients: resolveRefundOpsFallbackRecipients({
      recipients: getInternalNotificationRecipients(),
      customerEmail,
      mailboxIdentities,
    }),
  };
};

const requireReservationInteger = (value: unknown, field: string) => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Refund manager reservation ${field} is invalid.`);
  }
  return value;
};

/**
 * Converts only the exact, canonical route returned by the final reservation
 * RPC into a transport route. No earlier manager lookup is accepted here.
 */
export const bindRefundManagerNoticeReservationRouting = ({
  refundCaseId,
  customerEmail,
  mailboxIdentities,
  reservation,
}: {
  refundCaseId: string;
  customerEmail: string;
  mailboxIdentities: string[];
  reservation: unknown;
}): RefundManagerNoticeRouting => {
  const reservationRecord = reservation && typeof reservation === "object"
    ? reservation as Record<string, unknown>
    : {};
  const routeValue = reservationRecord.recipientRoute ??
    reservationRecord.recipient_route;
  const route = routeValue && typeof routeValue === "object"
    ? routeValue as Record<string, unknown>
    : {};
  const rawRecipients = route.recipients;
  const canonicalRecipients = sanitizeEmailList(rawRecipients).sort();
  if (
    !Array.isArray(rawRecipients) ||
    rawRecipients.length !== canonicalRecipients.length ||
    rawRecipients.some((entry, index) => entry !== canonicalRecipients[index])
  ) {
    throw new Error("Refund manager reservation recipients are not canonical.");
  }

  const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
  const excludedRecipients = new Set([
    ...sanitizeEmailList([normalizedCustomerEmail]),
    ...sanitizeEmailList(mailboxIdentities),
  ]);
  if (canonicalRecipients.some((email) => excludedRecipients.has(email))) {
    throw new Error(
      "Refund manager reservation contains an excluded recipient.",
    );
  }

  const routeType = route.routeType ?? route.route_type;
  const managerRecipientCount = requireReservationInteger(
    route.managerRecipientCount ?? route.manager_recipient_count,
    "manager recipient count",
  );
  const recipientCount = requireReservationInteger(
    route.recipientCount ?? route.recipient_count,
    "recipient count",
  );
  const resolutionStatus = route.resolutionStatus ?? route.resolution_status;
  const mappingFingerprint = route.mappingFingerprint ??
    route.mapping_fingerprint;
  if (
    typeof resolutionStatus !== "string" ||
    !ROUTE_STATUS_PATTERN.test(resolutionStatus) ||
    typeof mappingFingerprint !== "string" ||
    !MAPPING_FINGERPRINT_PATTERN.test(mappingFingerprint)
  ) {
    throw new Error("Refund manager reservation evidence is invalid.");
  }
  if (recipientCount !== canonicalRecipients.length) {
    throw new Error("Refund manager reservation recipient count is invalid.");
  }

  const usedOpsFallback = routeType === "operations";
  const managerRouteIsValid = routeType === "manager" &&
    resolutionStatus === "resolved" &&
    managerRecipientCount >= 1 &&
    managerRecipientCount <= MAX_MANAGER_CC_RECIPIENTS &&
    recipientCount === managerRecipientCount;
  const operationsRouteIsValid = usedOpsFallback &&
    resolutionStatus !== "resolved" &&
    managerRecipientCount === 0 &&
    recipientCount >= 1 &&
    recipientCount <= MAX_OPS_FALLBACK_RECIPIENTS;
  if (!managerRouteIsValid && !operationsRouteIsValid) {
    throw new Error("Refund manager reservation route policy is invalid.");
  }

  return {
    refundCaseId,
    customerEmail: normalizedCustomerEmail,
    recipients: canonicalRecipients,
    managerRecipientCount,
    recipientCount,
    resolutionStatus,
    usedOpsFallback,
    mappingFingerprint,
  };
};

export const resolveRefundManagerActionNoticeRouting = async ({
  supabase,
  refundCaseId,
  customerEmail,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  customerEmail: string;
}): Promise<RefundManagerNoticeRouting> => {
  const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
  const mailboxIdentities = getRefundGmailMailboxIdentities();
  const { data, error } = await supabase.rpc(
    "service_resolve_refund_customer_manager_cc",
    {
      p_refund_case_id: refundCaseId,
      p_customer_email: normalizedCustomerEmail,
      p_mailbox_identities: mailboxIdentities,
    },
  );
  if (error) throw error;

  const resolution = data && typeof data === "object"
    ? data as Record<string, unknown>
    : {};
  const resolutionStatus = typeof resolution.status === "string"
    ? resolution.status.slice(0, 80)
    : "resolution_failed";
  const excludedManagerRecipients = new Set([
    ...sanitizeEmailList([normalizedCustomerEmail]),
    ...sanitizeEmailList(mailboxIdentities),
  ]);
  const rawManagerRecipients = sanitizeEmailList(resolution.managerCcEmails);
  const resolvedManagerRecipients = rawManagerRecipients.filter((email) =>
    !excludedManagerRecipients.has(email)
  );
  const managerRecipients = resolutionStatus === "resolved" &&
      resolvedManagerRecipients.length === rawManagerRecipients.length &&
      resolvedManagerRecipients.length <= MAX_MANAGER_CC_RECIPIENTS
    ? resolvedManagerRecipients
    : [];
  const usedOpsFallback = managerRecipients.length === 0;
  const recipients = usedOpsFallback
    ? resolveRefundOpsFallbackRecipients({
      recipients: getInternalNotificationRecipients(),
      customerEmail: normalizedCustomerEmail,
      mailboxIdentities,
    })
    : managerRecipients;
  if (recipients.length === 0) {
    throw new Error(
      "No eligible refund action-notice recipients are configured.",
    );
  }

  return {
    refundCaseId,
    customerEmail: normalizedCustomerEmail,
    recipients,
    managerRecipientCount: managerRecipients.length,
    recipientCount: recipients.length,
    resolutionStatus,
    usedOpsFallback,
  };
};

export const sendRefundManagerActionNotice = async ({
  supabase,
  refundCaseId,
  customerEmail,
  noticeReason,
  subject,
  summaryText,
  resolvedRouting,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  customerEmail: string;
  noticeReason: RefundManagerNotificationReason;
  subject: string;
  summaryText: string;
  resolvedRouting?: RefundManagerNoticeRouting;
}): Promise<RefundManagerNoticeResult> => {
  const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
  let actionId: string | undefined;
  let attentionVersion: number | undefined;
  let channel: RefundManagerNotificationChannel = "immediate";
  let claimToken: string | undefined;
  let routing = resolvedRouting;

  if (!resolvedRouting) {
    const routeInputs = getRefundManagerNoticeReservationRouteInputs({
      customerEmail: normalizedCustomerEmail,
    });
    const { data, error } = await supabase.rpc(
      "service_begin_refund_manager_notification",
      {
        p_refund_case_id: refundCaseId,
        p_notice_reason: noticeReason,
        p_customer_email: normalizedCustomerEmail,
        p_mailbox_identities: routeInputs.mailboxIdentities,
        p_ops_fallback_recipients: routeInputs.opsFallbackRecipients,
      },
    );
    if (error) throw error;
    const reservation = data && typeof data === "object"
      ? data as Record<string, unknown>
      : {};
    actionId = typeof reservation.actionId === "string"
      ? reservation.actionId
      : undefined;
    attentionVersion = typeof reservation.attentionVersion === "number"
      ? reservation.attentionVersion
      : undefined;
    channel = reservation.channel as RefundManagerNotificationChannel;
    const deliveryState = reservation.deliveryState as
      | RefundManagerNotificationDeliveryState
      | "reserved";
    if (reservation.claimed !== true) {
      if (
        !actionId || !Number.isInteger(attentionVersion) ||
        !["daily_digest", "portal_only", "immediate"].includes(channel) ||
        !["digest_eligible", "portal_only", "sent", "delivery_unknown", "known_not_sent"]
          .includes(deliveryState)
      ) {
        throw new Error("Refund manager notification policy result is invalid.");
      }
      return {
        actionId,
        attentionVersion,
        channel,
        deliveryState: deliveryState as RefundManagerNotificationDeliveryState,
        noticeReason,
        managerRecipientCount: 0,
        recipientCount: 0,
        resolutionStatus: "policy_suppressed",
        usedOpsFallback: false,
      };
    }
    claimToken = typeof reservation.claimToken === "string"
      ? reservation.claimToken
      : undefined;
    if (!actionId || !claimToken || deliveryState !== "reserved") {
      throw new Error("Refund manager notification reservation is invalid.");
    }
    routing = bindRefundManagerNoticeReservationRouting({
      refundCaseId,
      customerEmail: normalizedCustomerEmail,
      mailboxIdentities: routeInputs.mailboxIdentities,
      reservation,
    });
  }

  if (!routing) {
    throw new Error("Refund manager notification routing is unavailable.");
  }
  if (
    routing.refundCaseId !== refundCaseId ||
    routing.customerEmail !== normalizedCustomerEmail
  ) {
    throw new Error("Refund action-notice routing does not match the case.");
  }

  const routingNote = routing.usedOpsFallback
    ? "Routing exception: the complete current Machine Manager route could not be safely resolved, so Bloomjoy operations is receiving this action notice."
    : "This action notice was routed only to the currently assigned Machine Managers.";

  let providerAccepted = false;
  try {
    const receipt = await sendTransactionalEmail({
      to: routing.recipients,
      subject,
      text: [
        summaryText.trim(),
        "",
        `Open the case: ${getRefundManagerCaseUrl(refundCaseId)}`,
        "",
        routingNote,
        "Customer PII, payment details, complaint text, and provider payloads are intentionally omitted.",
      ].join("\n"),
      ...(actionId
        ? { idempotencyKey: `refund_manager_${actionId.replaceAll("-", "")}` }
        : {}),
    });
    providerAccepted = true;
    if (actionId && claimToken) {
      const { data: settled, error: settlementError } = await supabase.rpc(
        "service_complete_refund_manager_notification",
        {
          p_action_id: actionId,
          p_claim_token: claimToken,
          p_outcome: "sent",
          p_provider_message_id: receipt.providerMessageId,
        },
      );
      if (settlementError) throw settlementError;
      if (settled !== true) {
        throw new TransactionalEmailDeliveryUnknownError();
      }
    }
  } catch (error) {
    if (actionId && claimToken) {
      const outcome = providerAccepted ||
          error instanceof TransactionalEmailDeliveryUnknownError
        ? "delivery_unknown"
        : "known_not_sent";
      await supabase.rpc("service_complete_refund_manager_notification", {
        p_action_id: actionId,
        p_claim_token: claimToken,
        p_outcome: outcome,
        p_provider_message_id: null,
      });
    }
    throw error;
  }

  return {
    actionId,
    attentionVersion,
    channel,
    deliveryState: "sent",
    noticeReason,
    managerRecipientCount: routing.managerRecipientCount,
    recipientCount: routing.recipientCount,
    resolutionStatus: routing.resolutionStatus,
    usedOpsFallback: routing.usedOpsFallback,
  };
};
