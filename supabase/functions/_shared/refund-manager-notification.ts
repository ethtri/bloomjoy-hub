import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  getInternalNotificationRecipients,
  sendTransactionalEmail,
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
};

export type RefundManagerNoticeRouting = RefundManagerNoticeResult & {
  refundCaseId: string;
  customerEmail: string;
  recipients: string[];
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
  subject,
  summaryText,
  resolvedRouting,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  customerEmail: string;
  subject: string;
  summaryText: string;
  resolvedRouting?: RefundManagerNoticeRouting;
}): Promise<RefundManagerNoticeResult> => {
  const normalizedCustomerEmail = customerEmail.trim().toLowerCase();
  const routing = resolvedRouting ??
    await resolveRefundManagerActionNoticeRouting({
      supabase,
      refundCaseId,
      customerEmail: normalizedCustomerEmail,
    });
  if (
    routing.refundCaseId !== refundCaseId ||
    routing.customerEmail !== normalizedCustomerEmail
  ) {
    throw new Error("Refund action-notice routing does not match the case.");
  }

  const routingNote = routing.usedOpsFallback
    ? "Routing exception: the complete current Machine Manager route could not be safely resolved, so Bloomjoy operations is receiving this action notice."
    : "This action notice was routed only to the currently assigned Machine Managers.";

  await sendTransactionalEmail({
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
  });

  return {
    managerRecipientCount: routing.managerRecipientCount,
    recipientCount: routing.recipientCount,
    resolutionStatus: routing.resolutionStatus,
    usedOpsFallback: routing.usedOpsFallback,
  };
};
