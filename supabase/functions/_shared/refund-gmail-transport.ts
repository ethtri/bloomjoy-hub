import {
  getRefundGmailConfig,
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

export const dispatchRefundCaseGmailReply = async ({
  supabase,
  refundCaseId,
  refundCaseMessageId,
  recipientEmail,
  email,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  refundCaseMessageId: string;
  recipientEmail: string;
  email: RefundEmailPayload;
}) => {
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
    return { usedGmail: false as const };
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
    "service_claim_refund_gmail_outbound",
    {
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
      p_operation_key: operationKey,
      p_sender_email: config.mailbox,
      p_recipient_email: recipientEmail,
      p_plain_body: email.text,
    },
  );
  if (claimError) {
    throw new RefundGmailError("gmail_send_claim_failed", "Unable to claim Gmail reply delivery.");
  }
  if (!claim?.linked) {
    return { usedGmail: false as const };
  }
  if (!claim.claimed) {
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
  if (!transportMessageId || !providerThreadId) {
    throw new RefundGmailError("gmail_send_claim_invalid", "Gmail reply claim was incomplete.");
  }

  try {
    const sent = await sendRefundGmailReply({
      config,
      providerThreadId,
      operationKey,
      recipientEmail,
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

    return { usedGmail: true as const, subject };
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
