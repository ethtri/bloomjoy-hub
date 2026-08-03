import {
  getRefundGmailConfig,
  getRefundGmailMailboxIdentities,
  RefundGmailError,
  sendRefundGmailReply,
  sha256Hex,
} from "./refund-gmail.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";

type RefundEmailPayload = {
  subject: string;
  text: string;
  html: string;
};

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

const parseManagerCc = (
  value: unknown,
  customerEmail: string,
  mailboxIdentities: string[],
): string[] => {
  if (!Array.isArray(value)) return [];
  if (!value.every((entry): entry is string => typeof entry === "string")) {
    throw new RefundGmailError(
      "manager_cc_resolution_invalid",
      "The Machine Manager recipient result was invalid.",
    );
  }
  const normalized = Array.from(
    new Set(
      value.map((entry) => entry.trim().toLowerCase()).filter(Boolean),
    ),
  );
  const excluded = new Set([
    customerEmail.trim().toLowerCase(),
    ...mailboxIdentities.map((email) => email.trim().toLowerCase()),
  ]);
  if (
    normalized.length > 3 ||
    normalized.some((email) =>
      email.length > 320 ||
      !EMAIL_PATTERN.test(email) ||
      excluded.has(email)
    )
  ) {
    throw new RefundGmailError(
      "manager_cc_resolution_invalid",
      "The Machine Manager recipient result was invalid.",
    );
  }
  return normalized;
};

export const dispatchRefundCaseGmailReply = async ({
  supabase,
  refundCaseId,
  refundCaseMessageId,
  recipientEmail,
  email,
  deliveryKind = "manual",
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  refundCaseMessageId: string;
  recipientEmail: string;
  email: RefundEmailPayload;
  deliveryKind?: "manual" | "automatic";
}) => {
  if (/\/refunds\?case=/i.test(`${email.text}\n${email.html}`)) {
    throw new RefundGmailError(
      "internal_case_link_blocked",
      "Customer email cannot contain an internal refund case link.",
    );
  }

  const { data: link, error: linkError } = await supabase
    .from("refund_gmail_threads")
    .select("id,mailbox_hash")
    .eq("refund_case_id", refundCaseId)
    .order("latest_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (linkError) {
    throw new RefundGmailError("gmail_link_lookup_failed", "Unable to resolve Gmail thread transport.");
  }
  if (!link) {
    const mailboxIdentities = getRefundGmailMailboxIdentities();
    const { data: recipientResolution, error: recipientResolutionError } = await supabase.rpc(
      "service_resolve_refund_customer_manager_cc",
      {
        p_refund_case_id: refundCaseId,
        p_customer_email: recipientEmail,
        p_mailbox_identities: mailboxIdentities,
      },
    );
    if (recipientResolutionError) {
      throw new RefundGmailError(
        "manager_cc_resolution_failed",
        "Unable to resolve the current Machine Manager recipients.",
      );
    }
    const resolvedManagerCc = parseManagerCc(
      recipientResolution?.managerCcEmails,
      recipientEmail,
      mailboxIdentities,
    );
    const recipientResolutionStatus = typeof recipientResolution?.status === "string"
      ? recipientResolution.status
      : "unavailable";
    return {
      usedGmail: false as const,
      managerCcEmails: resolvedManagerCc,
      managerCcCount: resolvedManagerCc.length,
      recipientResolutionStatus,
    };
  }

  const config = getRefundGmailConfig();
  if (!config) {
    throw new RefundGmailError("gmail_configuration_missing", "Gmail reply transport is not configured.");
  }
  const mailboxHash = await sha256Hex(config.mailbox);
  if (link.mailbox_hash !== mailboxHash) {
    throw new RefundGmailError("mailbox_mismatch", "Gmail reply transport is connected to the wrong mailbox.");
  }

  const operationKey = `refund-case-message:${refundCaseMessageId}`;
  const { data: claim, error: claimError } = await supabase.rpc(
    "service_claim_refund_gmail_outbound_v2",
    {
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
      p_operation_key: operationKey,
      p_sender_email: config.mailbox,
      p_recipient_email: recipientEmail,
      p_plain_body: email.text,
      p_mailbox_identities: config.mailboxIdentities,
      p_delivery_kind: deliveryKind,
    },
  );
  if (claimError) {
    throw new RefundGmailError("gmail_send_claim_failed", "Unable to claim Gmail reply delivery.");
  }
  if (!claim?.linked) {
    throw new RefundGmailError(
      "gmail_link_changed",
      "The linked Gmail thread changed before delivery. Review the case before sending again.",
    );
  }
  if (!claim.claimed) {
    if (claim.status === "automatic_contact_paused") {
      throw new RefundGmailError(
        "gmail_automatic_contact_paused",
        "Automatic customer contact is paused after a Gmail delivery failure.",
      );
    }
    throw new RefundGmailError(
      claim.status === "sent" ? "gmail_reply_already_sent" : "gmail_reply_already_claimed",
      "This Gmail reply has already been processed.",
    );
  }

  const transportMessageId = typeof claim.transportMessageId === "string"
    ? claim.transportMessageId
    : "";
  const providerThreadId = typeof claim.providerThreadId === "string"
    ? claim.providerThreadId
    : "";
  const subject = typeof claim.subject === "string" && claim.subject.trim()
    ? claim.subject.trim()
    : email.subject;
  const managerCcEmails = parseManagerCc(
    claim.managerCcEmails,
    recipientEmail,
    config.mailboxIdentities,
  );
  const claimedResolutionStatus = typeof claim.recipientResolutionStatus === "string"
    ? claim.recipientResolutionStatus
    : "unavailable";
  if (!transportMessageId || !providerThreadId) {
    throw new RefundGmailError("gmail_send_claim_invalid", "Gmail reply claim was incomplete.");
  }

  try {
    const sent = await sendRefundGmailReply({
      config,
      providerThreadId,
      operationKey,
      recipientEmail,
      ccEmails: managerCcEmails,
      deliveryKind,
      subject,
      text: email.text,
      html: email.html,
      inReplyTo: typeof claim.inReplyTo === "string" ? claim.inReplyTo : null,
      references: typeof claim.references === "string" ? claim.references : null,
    });

    const { data: finished, error: finishError } = await supabase.rpc(
      "service_finish_refund_gmail_outbound",
      {
        p_transport_message_id: transportMessageId,
        p_status: "sent",
        p_provider_message_id: sent.providerMessageId,
        p_provider_message_header: sent.providerMessageHeader,
        p_error_code: null,
      },
    );
    if (finishError || finished !== true) {
      throw new RefundGmailError(
        "gmail_delivery_record_failed",
        "Gmail sent the reply, but the delivery record could not be finalized.",
        true,
      );
    }

    return {
      usedGmail: true as const,
      subject,
      managerCcEmails,
      managerCcCount: managerCcEmails.length,
      recipientResolutionStatus: claimedResolutionStatus,
    };
  } catch (error) {
    const gmailError = error instanceof RefundGmailError
      ? error
      : new RefundGmailError("gmail_send_failed", "Unable to send Gmail reply.");
    const completionStatus = gmailError.deliveryUncertain ? "delivery_unknown" : "failed";
    await supabase.rpc("service_finish_refund_gmail_outbound", {
      p_transport_message_id: transportMessageId,
      p_status: completionStatus,
      p_provider_message_id: null,
      p_provider_message_header: null,
      p_error_code: gmailError.code,
    });
    throw gmailError;
  }
};
