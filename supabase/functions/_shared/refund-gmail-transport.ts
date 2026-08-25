import {
  getRefundGmailConfig,
  getRefundGmailMailboxIdentities,
  REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
  RefundGmailError,
  requireRefundGmailEnabled,
  sendRefundGmailReply,
  sha256Hex,
} from "./refund-gmail.ts";
import { automaticRefundCustomerContactEnabled } from "./refund-deterministic-follow-up.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { verifyRefundSyntheticGmailProofTransport } from "./refund-synthetic-gmail-proof.ts";

type RefundEmailPayload = {
  subject: string;
  text: string;
  html: string;
};

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CUSTOMER_MANAGER_CC_ALLOWED_STATUS = "resolved";

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
    normalized.length > 4 ||
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

export const requireRefundCustomerManagerCcResolution = ({
  resolution,
  customerEmail,
  mailboxIdentities,
}: {
  resolution: unknown;
  customerEmail: string;
  mailboxIdentities: string[];
}) => {
  const result = resolution && typeof resolution === "object"
    ? resolution as Record<string, unknown>
    : {};
  const recipientResolutionStatus = typeof result.status === "string"
    ? result.status
    : "unavailable";
  const managerCcEmails = parseManagerCc(
    result.managerCcEmails,
    customerEmail,
    mailboxIdentities,
  );
  const managerRecipientOverlap = result.managerRecipientOverlap === true;
  const managerRecipientCount = Number(result.managerRecipientCount);

  if (
    recipientResolutionStatus !== CUSTOMER_MANAGER_CC_ALLOWED_STATUS ||
    !Number.isSafeInteger(managerRecipientCount) ||
    managerRecipientCount < 1 ||
    managerRecipientCount > 4 ||
    managerCcEmails.length + (managerRecipientOverlap ? 1 : 0) !==
      managerRecipientCount
  ) {
    throw new RefundGmailError(
      "manager_cc_required",
      "Customer contact requires at least one current active mapped Machine Manager in CC.",
    );
  }

  return {
    managerCcEmails,
    managerCcCount: managerCcEmails.length,
    managerRecipientOverlap,
    managerRecipientCount,
    recipientResolutionStatus,
  };
};

export const dispatchRefundCaseGmailReply = async ({
  supabase,
  refundCaseId,
  refundCaseMessageId,
  recipientEmail,
  email,
  deliveryKind = "manual",
  gmailThreadId = null,
  syntheticProofAuthorizationId = null,
}: {
  supabase: SupabaseClient;
  refundCaseId: string;
  refundCaseMessageId: string;
  recipientEmail: string;
  email: RefundEmailPayload;
  deliveryKind?: "manual" | "automatic";
  gmailThreadId?: string | null;
  syntheticProofAuthorizationId?: string | null;
}) => {
  if (
    deliveryKind === "automatic" &&
    !automaticRefundCustomerContactEnabled()
  ) {
    throw new RefundGmailError(
      "automatic_contact_disabled",
      "Automatic customer contact is disabled.",
    );
  }
  if (/\/refunds\?case=/i.test(`${email.text}\n${email.html}`)) {
    throw new RefundGmailError(
      "internal_case_link_blocked",
      "Customer email cannot contain an internal refund case link.",
    );
  }

  // An unclosed synthetic proof authorization is an exclusive transport
  // boundary. Verify it before link selection, Gmail configuration, OAuth,
  // delivery claim, provider access, or transactional fallback.
  const syntheticProof = await verifyRefundSyntheticGmailProofTransport({
    supabase,
    refundCaseId,
    refundCaseMessageId,
    recipientEmail,
    authorizationId: syntheticProofAuthorizationId,
  });
  const targetGmailThreadId = syntheticProof.required
    ? syntheticProof.gmailThreadId
    : gmailThreadId;
  if (
    syntheticProof.required && gmailThreadId &&
    gmailThreadId !== targetGmailThreadId
  ) {
    throw new RefundGmailError(
      "synthetic_proof_thread_mismatch",
      "The synthetic proof is not bound to this Gmail conversation.",
    );
  }

  let linkQuery = supabase
    .from("refund_gmail_threads")
    .select("id,mailbox_hash")
    .eq("refund_case_id", refundCaseId);
  linkQuery = targetGmailThreadId
    ? linkQuery.eq("id", targetGmailThreadId)
    : linkQuery.order("latest_message_at", { ascending: false });
  const { data: link, error: linkError } = await linkQuery
    .limit(1)
    .maybeSingle();

  if (linkError) {
    throw new RefundGmailError(
      "gmail_link_lookup_failed",
      "Unable to resolve Gmail thread transport.",
    );
  }
  if (!link) {
    if (targetGmailThreadId) {
      throw new RefundGmailError(
        "gmail_source_thread_invalid",
        "The source Gmail conversation is no longer linked to this refund case.",
      );
    }
    const mailboxIdentities = getRefundGmailMailboxIdentities();
    const { data: deliveryAuthorization, error: recipientResolutionError } =
      await supabase.rpc(
        "service_authorize_refund_customer_outbound",
        {
          p_refund_case_id: refundCaseId,
          p_recipient_email: recipientEmail,
          p_mailbox_identities: mailboxIdentities,
          p_delivery_kind: deliveryKind,
        },
      );
    if (recipientResolutionError) {
      throw new RefundGmailError(
        "manager_cc_resolution_failed",
        "Unable to resolve the current Machine Manager recipients.",
      );
    }
    const authorization =
      deliveryAuthorization && typeof deliveryAuthorization === "object"
        ? deliveryAuthorization as Record<string, unknown>
        : {};
    if (authorization.allowed !== true) {
      const status = typeof authorization.status === "string"
        ? authorization.status
        : "customer_delivery_not_authorized";
      throw new RefundGmailError(
        status,
        status === "terminal_case"
          ? "Automatic customer contact stopped because the refund case is already decided."
          : status === "automatic_contact_disabled"
          ? "Automatic customer contact is disabled."
          : "Customer contact requires at least one current active mapped Machine Manager in CC.",
      );
    }
    const managerResolution = requireRefundCustomerManagerCcResolution({
      resolution: {
        status: authorization.recipientResolutionStatus,
        managerCcEmails: authorization.managerCcEmails,
        managerRecipientOverlap: authorization.managerRecipientOverlap,
        managerRecipientCount: authorization.managerRecipientCount,
      },
      customerEmail: recipientEmail,
      mailboxIdentities,
    });
    return {
      usedGmail: false as const,
      ...managerResolution,
    };
  }

  // This is the shared Gmail-only shutdown boundary. Keep it after the
  // non-Gmail fallback branch so hosted-form intake can continue, but before
  // configuration, delivery claims, OAuth, or provider access.
  requireRefundGmailEnabled();

  const config = getRefundGmailConfig();
  if (!config) {
    throw new RefundGmailError(
      "gmail_configuration_missing",
      "Gmail reply transport is not configured.",
    );
  }
  if (
    syntheticProof.required &&
    config.mailbox.trim().toLowerCase() !== "info@bloomjoysweets.com"
  ) {
    throw new RefundGmailError(
      "synthetic_proof_sender_mismatch",
      "The synthetic proof requires the reviewed Info mailbox sender.",
    );
  }
  const mailboxHash = await sha256Hex(config.mailbox);
  if (link.mailbox_hash !== mailboxHash) {
    throw new RefundGmailError(
      "mailbox_mismatch",
      "Gmail reply transport is connected to the wrong mailbox.",
    );
  }

  const operationKey = `refund-case-message:${refundCaseMessageId}`;
  const { data: claim, error: claimError } = await supabase.rpc(
    "service_claim_refund_gmail_outbound_v3",
    {
      p_refund_case_id: refundCaseId,
      p_refund_case_message_id: refundCaseMessageId,
      p_operation_key: operationKey,
      p_sender_email: config.mailbox,
      p_recipient_email: recipientEmail,
      p_plain_body: email.text,
      p_mailbox_identities: config.mailboxIdentities,
      p_delivery_kind: deliveryKind,
      p_target_gmail_thread_id: targetGmailThreadId,
    },
  );
  if (claimError) {
    if (
      String(claimError.message ?? "").includes(
        "refund_gmail_delivery_reconciliation_required",
      )
    ) {
      throw new RefundGmailError(
        "gmail_delivery_reconciliation_required",
        REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
        true,
      );
    }
    throw new RefundGmailError(
      "gmail_send_claim_failed",
      "Unable to claim Gmail reply delivery.",
    );
  }
  if (!claim?.linked) {
    throw new RefundGmailError(
      "gmail_link_changed",
      "The linked Gmail thread changed before delivery. Review the case before sending again.",
    );
  }
  if (claim.reconciled === true && claim.status === "sent") {
    const reconciledResolution = requireRefundCustomerManagerCcResolution({
      resolution: {
        status: claim.recipientResolutionStatus,
        managerCcEmails: claim.managerCcEmails,
        managerRecipientOverlap: claim.managerRecipientOverlap,
        managerRecipientCount: claim.managerRecipientCount,
      },
      customerEmail: recipientEmail,
      mailboxIdentities: config.mailboxIdentities,
    });
    return {
      usedGmail: true as const,
      subject: typeof claim.subject === "string" && claim.subject.trim()
        ? claim.subject.trim()
        : email.subject,
      ...reconciledResolution,
      reconciled: true as const,
    };
  }
  if (!claim.claimed) {
    if (
      claim.status === "pending_send" || claim.status === "delivery_unknown"
    ) {
      throw new RefundGmailError(
        "gmail_delivery_reconciliation_required",
        REFUND_GMAIL_DELIVERY_UNCERTAIN_MESSAGE,
        true,
      );
    }
    if (claim.status === "automatic_contact_paused") {
      throw new RefundGmailError(
        "gmail_automatic_contact_paused",
        "Automatic customer contact is paused after a Gmail delivery failure.",
      );
    }
    if (claim.status === "manager_cc_required") {
      throw new RefundGmailError(
        "manager_cc_required",
        "Customer contact requires at least one current active mapped Machine Manager in CC.",
      );
    }
    if (claim.status === "automatic_contact_disabled") {
      throw new RefundGmailError(
        "automatic_contact_disabled",
        "Automatic customer contact is disabled.",
      );
    }
    if (claim.status === "terminal_case") {
      throw new RefundGmailError(
        "terminal_case",
        "Automatic customer contact stopped because the refund case is already decided.",
      );
    }
    if (claim.status === "source_thread_required") {
      throw new RefundGmailError(
        "gmail_source_thread_required",
        "Automatic Gmail contact requires the exact source conversation.",
      );
    }
    if (
      ["unsafe_automatic_message", "delivery_kind_mismatch"].includes(
        claim.status,
      )
    ) {
      throw new RefundGmailError(
        "gmail_delivery_evidence_invalid",
        "The tracked customer message is not authorized for this delivery kind.",
      );
    }
    throw new RefundGmailError(
      claim.status === "sent"
        ? "gmail_reply_already_sent"
        : "gmail_reply_already_claimed",
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
  const managerResolution = requireRefundCustomerManagerCcResolution({
    resolution: {
      status: claim.recipientResolutionStatus,
      managerCcEmails: claim.managerCcEmails,
      managerRecipientOverlap: claim.managerRecipientOverlap,
      managerRecipientCount: claim.managerRecipientCount,
    },
    customerEmail: recipientEmail,
    mailboxIdentities: config.mailboxIdentities,
  });
  const managerCcEmails = managerResolution.managerCcEmails;
  const claimedResolutionStatus = managerResolution.recipientResolutionStatus;
  if (!transportMessageId || !providerThreadId) {
    throw new RefundGmailError(
      "gmail_send_claim_invalid",
      "Gmail reply claim was incomplete.",
    );
  }

  if (syntheticProof.required) {
    const managerRouteDigest = await sha256Hex(
      [...managerCcEmails].sort().join(","),
    );
    if (
      managerCcEmails.length !== syntheticProof.expectedManagerCount ||
      managerRouteDigest !== syntheticProof.managerRouteDigest
    ) {
      await supabase.rpc("service_finish_refund_gmail_outbound", {
        p_transport_message_id: transportMessageId,
        p_status: "failed",
        p_provider_message_id: null,
        p_provider_message_header: null,
        p_error_code: "synthetic_proof_manager_route_changed",
      });
      throw new RefundGmailError(
        "synthetic_proof_manager_route_changed",
        "The mapped Machine Manager route changed after proof authorization.",
      );
    }
  }

  try {
    const sent = await sendRefundGmailReply({
      config,
      providerThreadId,
      operationKey,
      recipientEmail,
      ccEmails: managerCcEmails,
      managerRecipientOverlap: managerResolution.managerRecipientOverlap,
      managerRecipientCount: managerResolution.managerRecipientCount,
      deliveryKind,
      subject,
      text: email.text,
      html: email.html,
      inReplyTo: typeof claim.inReplyTo === "string" ? claim.inReplyTo : null,
      references: typeof claim.references === "string"
        ? claim.references
        : null,
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
      : new RefundGmailError(
        "gmail_send_failed",
        "Unable to send Gmail reply.",
      );
    const completionStatus = gmailError.deliveryUncertain
      ? "delivery_unknown"
      : "failed";
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
