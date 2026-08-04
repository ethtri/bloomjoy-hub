import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  getInternalNotificationRecipients,
  sendTransactionalEmail,
} from "./internal-email.ts";
import { getRefundGmailMailboxIdentities } from "./refund-gmail.ts";

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_MANAGER_CC_RECIPIENTS = 3;
const MAX_OPS_FALLBACK_RECIPIENTS = 5;

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

export const sendRefundManagerActionNotice = async ({
  supabase,
  refundCaseId,
  customerEmail,
  subject,
  summaryText,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  customerEmail: string;
  subject: string;
  summaryText: string;
}): Promise<RefundManagerNoticeResult> => {
  const mailboxIdentities = getRefundGmailMailboxIdentities();
  const { data, error } = await supabase.rpc(
    "service_resolve_refund_customer_manager_cc",
    {
      p_refund_case_id: refundCaseId,
      p_customer_email: customerEmail,
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
    ...sanitizeEmailList([customerEmail]),
    ...sanitizeEmailList(mailboxIdentities),
  ]);
  const rawManagerRecipients = sanitizeEmailList(resolution.managerCcEmails);
  const resolvedManagerRecipients = rawManagerRecipients.filter((email) =>
    !excludedManagerRecipients.has(email)
  );
  const managerRecipients =
    resolvedManagerRecipients.length === rawManagerRecipients.length &&
      resolvedManagerRecipients.length <= MAX_MANAGER_CC_RECIPIENTS
    ? resolvedManagerRecipients
    : [];
  const usedOpsFallback = managerRecipients.length === 0;
  const recipients = usedOpsFallback
    ? resolveRefundOpsFallbackRecipients({
      recipients: getInternalNotificationRecipients(),
      customerEmail,
      mailboxIdentities,
    })
    : managerRecipients;
  if (recipients.length === 0) {
    throw new Error(
      "No eligible refund action-notice recipients are configured.",
    );
  }

  const routingNote = usedOpsFallback
    ? "Routing exception: no eligible active Machine Manager was resolved, so Bloomjoy operations is receiving this action notice."
    : "This action notice was routed only to the currently assigned Machine Managers.";

  await sendTransactionalEmail({
    to: recipients,
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
    managerRecipientCount: managerRecipients.length,
    recipientCount: recipients.length,
    resolutionStatus,
    usedOpsFallback,
  };
};
