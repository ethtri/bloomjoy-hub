import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  claimRefundGmailDeliveryWhenEnabled,
  extractPlainTextBody,
  getGmailHeader,
  getRefundGmailAttachment,
  getRefundGmailConfig,
  getRefundGmailThread,
  type GmailMessage,
  type GmailMessagePart,
  inspectRefundGmailParticipantSignals,
  inspectRefundGmailReplyByMessageHeader,
  listLabeledRefundThreads,
  redactPaymentCardNumbers,
  REFUND_GMAIL_ALLOWED_MIME_TYPES,
  REFUND_GMAIL_MAX_ATTACHMENT_BYTES,
  REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE,
  refundGmailEnabled,
  RefundGmailError,
  requireRefundGmailEnabled,
  sendRefundGmailReply,
  sha256Hex,
  verifyRefundGmailMailbox,
} from "../_shared/refund-gmail.ts";
import { ingestRefundGmailThreadBeforeFirstContact } from "../_shared/refund-gmail-orchestration.ts";
import {
  buildRefundFirstContactEmail,
  isRefundFirstContactSenderAllowed,
  REFUND_FIRST_CONTACT_TEMPLATE_KEY,
  type RefundFirstContactConfig,
  resolveRefundFirstContactConfig,
} from "../_shared/refund-first-contact.ts";
import {
  classifyRefundGmailStorageDelete,
  classifyRefundGmailStorageUpload,
  getRefundGmailRetentionRuntimeConfig,
  isRefundGmailQuarantineStorageTarget,
  isRefundGmailWorkflowRunKey,
  redactedRefundGmailRetentionSummary,
  refundGmailRetentionLedgerRunKey,
  type RefundGmailRetentionSummary,
} from "../_shared/refund-gmail-retention.ts";
import { sendRefundManagerActionNotice } from "../_shared/refund-manager-notification.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = (Deno.env.get("REFUND_GMAIL_SYNC_SECRET") ?? "").trim();
const retentionRuntime = getRefundGmailRetentionRuntimeConfig((name) =>
  Deno.env.get(name)
);
const refundEmailPilotAttachmentsEnabled = false;

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength: number) =>
  typeof value === "string" || typeof value === "number" ||
    typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isEnabled = () => refundGmailEnabled();

const safeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length || leftBytes.length === 0) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
};

const authorize = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";
  return Boolean(syncSecret) && safeEqual(token, syncSecret);
};

type AttachmentDescriptor = {
  providerAttachmentId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  disposition: "attachment" | "inline";
  allowed: boolean;
  rejectionCode: string | null;
};

const extensionForType = (contentType: string) => ({
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
}[contentType] ?? "bin");

const safeFileName = (value: string) => {
  const basename = value.split(/[\\/]/).pop() ?? "attachment";
  const printable = Array.from(basename)
    .filter((character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
    )
    .join("");
  const cleaned = printable
    .replace(/[^\p{L}\p{N}._() -]/gu, "_")
    .trim();
  return (cleaned || "attachment").slice(0, 255);
};

const contentDisposition = (part: GmailMessagePart) =>
  getGmailHeader(part.headers, "Content-Disposition").toLowerCase();

const collectAttachmentDescriptors = (
  payload: GmailMessagePart | undefined,
) => {
  const descriptors: AttachmentDescriptor[] = [];
  const visit = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    const providerAttachmentId = sanitizeText(part.body?.attachmentId, 512);
    const rawFileName = sanitizeText(part.filename, 255);
    if (providerAttachmentId && rawFileName) {
      const fileName = safeFileName(rawFileName);
      const contentType = sanitizeText(part.mimeType, 160).toLowerCase() ||
        "application/octet-stream";
      const byteSize = Math.max(0, Number(part.body?.size ?? 0));
      const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
      const expectedExtension = extensionForType(contentType);
      const typeAllowed = REFUND_GMAIL_ALLOWED_MIME_TYPES.has(contentType);
      const extensionAllowed = expectedExtension === "jpg"
        ? ["jpg", "jpeg"].includes(extension)
        : extension === expectedExtension;
      const underCount =
        descriptors.length < REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE;
      const sizeAllowed = byteSize > 0 &&
        byteSize <= REFUND_GMAIL_MAX_ATTACHMENT_BYTES;
      const allowed = typeAllowed && extensionAllowed && underCount &&
        sizeAllowed;
      const rejectionCode = allowed
        ? null
        : !underCount
        ? "attachment_count_exceeded"
        : !sizeAllowed
        ? "attachment_size_rejected"
        : !typeAllowed
        ? "attachment_type_rejected"
        : "attachment_extension_mismatch";
      descriptors.push({
        providerAttachmentId,
        fileName,
        contentType,
        byteSize: Math.min(byteSize, 25 * 1024 * 1024),
        disposition: contentDisposition(part).startsWith("inline")
          ? "inline"
          : "attachment",
        allowed,
        rejectionCode,
      });
    }
    for (const child of part.parts ?? []) visit(child);
  };
  visit(payload);
  return descriptors;
};

const extractPublicReference = (subject: string, body: string) =>
  `${subject}\n${body}`.match(/\bRF-[A-Z0-9]{6,20}\b/i)?.[0]?.toUpperCase() ??
    null;

const receivedAtForMessage = (message: GmailMessage) => {
  const timestamp = Number(message.internalDate ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
};

const rpc = async <T = Record<string, unknown> | null>(
  name: string,
  args: Record<string, unknown>,
) => {
  if (!supabase) {
    throw new RefundGmailError(
      "service_configuration_missing",
      "Refund Gmail service is unavailable.",
    );
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new RefundGmailError(
      "database_operation_failed",
      "Refund Gmail database operation failed.",
    );
  }
  return data as T;
};

const getFirstContactConfig = () =>
  resolveRefundFirstContactConfig({
    REFUND_GMAIL_FIRST_CONTACT_MODE: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_MODE",
    ),
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT",
    ),
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_ISOLATED_CONFIRMED",
    ),
    GMAIL_REFUND_LABEL_ID: Deno.env.get("GMAIL_REFUND_LABEL_ID"),
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_ISOLATED_LABEL_ID",
    ),
    REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_PRODUCTION_LABEL_ID",
    ),
    REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_ISOLATED_SENDERS",
    ),
    REFUND_GMAIL_LEGACY_RESPONDER_DISABLED: Deno.env.get(
      "REFUND_GMAIL_LEGACY_RESPONDER_DISABLED",
    ),
    REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_CUTOVER_APPROVED",
    ),
    REFUND_GMAIL_FIRST_CONTACT_REFUND_URL: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_REFUND_URL",
    ),
    REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL: Deno.env.get(
      "REFUND_GMAIL_FIRST_CONTACT_SUPPORT_URL",
    ),
  });

type FirstContactCounters = {
  firstContactShadowed: number;
  firstContactSent: number;
  firstContactSuppressed: number;
  firstContactFailed: number;
  firstContactReconciliationOutstanding: number;
};

type FirstContactCandidate = {
  refundCaseId: string;
  sourceMessageId: string;
  publicReference: string;
  customerName: string;
  customerEmail: string;
};

const createRefundGmailIntakeContextToken = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
};

const refundRequestUrlWithEmailContext = (baseUrl: string, token: string) => {
  const url = new URL(baseUrl);
  url.searchParams.set("emailContext", token);
  return url.toString();
};

type FirstContactReconciliationRow = {
  operation_id?: string;
  operation_key?: string;
  provider_thread_id?: string;
  operation_status?: string;
  attempt_version?: number;
};

type OutboundReconciliationRow = {
  transport_message_id?: string;
  operation_key?: string;
  provider_thread_id?: string;
  operation_status?: string;
  attempt_version?: number;
};

type OutboundReconciliationCounters = {
  outboundReconciled: number;
  outboundReconciliationFailed: number;
  outboundReconciliationOutstanding: number;
};

const reconcileOutstandingFirstContacts = async ({
  config,
  counters,
}: {
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
  counters: FirstContactCounters;
}) => {
  const outstanding = await rpc<FirstContactReconciliationRow[]>(
    "service_claim_refund_gmail_first_contact_reconciliation_batch",
    { p_limit: 100 },
  );
  for (const row of outstanding ?? []) {
    const operationId = sanitizeText(row.operation_id, 80);
    const operationKey = sanitizeText(row.operation_key, 255);
    const providerThreadId = sanitizeText(row.provider_thread_id, 255);
    const attemptVersion = Number(row.attempt_version);
    if (
      !operationId || !operationKey || !providerThreadId ||
      !Number.isInteger(attemptVersion) || attemptVersion < 1
    ) {
      counters.firstContactFailed += 1;
      continue;
    }
    try {
      const providerResult = await inspectRefundGmailReplyByMessageHeader({
        config,
        providerThreadId,
        operationKey,
      });
      if (providerResult.status === "no_match") {
        const recorded = await rpc<boolean>(
          "service_finish_refund_gmail_first_contact_no_match",
          {
            p_operation_id: operationId,
            p_attempt_version: attemptVersion,
          },
        );
        if (!recorded) counters.firstContactFailed += 1;
        continue;
      }
      if (providerResult.status === "ambiguous") {
        counters.firstContactFailed += 1;
        continue;
      }
      const providerEvidence = providerResult.evidence;
      const reconciled = await rpc<boolean>(
        "service_finish_refund_gmail_first_contact",
        {
          p_operation_id: operationId,
          p_status: "sent",
          p_provider_message_id: providerEvidence.providerMessageId,
          p_provider_message_header: providerEvidence.providerMessageHeader,
          p_error_code: null,
          p_attempt_version: attemptVersion,
        },
      );
      if (reconciled) counters.firstContactSent += 1;
      else counters.firstContactFailed += 1;
    } catch {
      counters.firstContactFailed += 1;
    }
  }
  try {
    counters.firstContactReconciliationOutstanding = await rpc<number>(
      "service_count_refund_gmail_first_contact_reconciliation",
      {},
    );
  } catch {
    counters.firstContactFailed += 1;
    counters.firstContactReconciliationOutstanding = Math.max(
      counters.firstContactReconciliationOutstanding,
      1,
    );
  }
};

const reconcileOutstandingOutbound = async ({
  config,
  counters,
}: {
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
  counters: OutboundReconciliationCounters;
}) => {
  const outstanding = await rpc<OutboundReconciliationRow[]>(
    "service_claim_refund_gmail_outbound_reconciliation_batch",
    { p_limit: 100 },
  );
  for (const row of outstanding ?? []) {
    const transportMessageId = sanitizeText(row.transport_message_id, 80);
    const operationKey = sanitizeText(row.operation_key, 255);
    const providerThreadId = sanitizeText(row.provider_thread_id, 255);
    const attemptVersion = Number(row.attempt_version);
    if (
      !transportMessageId || !operationKey || !providerThreadId ||
      !Number.isInteger(attemptVersion) || attemptVersion < 1
    ) {
      counters.outboundReconciliationFailed += 1;
      continue;
    }
    try {
      const providerResult = await inspectRefundGmailReplyByMessageHeader({
        config,
        providerThreadId,
        operationKey,
      });
      if (providerResult.status === "no_match") {
        const recorded = await rpc<boolean>(
          "service_finish_refund_gmail_outbound_reconciliation_no_match",
          {
            p_transport_message_id: transportMessageId,
            p_attempt_version: attemptVersion,
          },
        );
        if (!recorded) counters.outboundReconciliationFailed += 1;
        continue;
      }
      if (providerResult.status === "ambiguous") {
        counters.outboundReconciliationFailed += 1;
        continue;
      }
      const providerEvidence = providerResult.evidence;
      const reconciled = await rpc<boolean>(
        "service_finish_refund_gmail_outbound_reconciliation",
        {
          p_transport_message_id: transportMessageId,
          p_provider_message_id: providerEvidence.providerMessageId,
          p_provider_message_header: providerEvidence.providerMessageHeader,
          p_attempt_version: attemptVersion,
        },
      );
      if (reconciled) counters.outboundReconciled += 1;
      else counters.outboundReconciliationFailed += 1;
    } catch {
      counters.outboundReconciliationFailed += 1;
    }
  }
  try {
    counters.outboundReconciliationOutstanding = await rpc<number>(
      "service_count_refund_gmail_outbound_reconciliation",
      {},
    );
  } catch {
    counters.outboundReconciliationFailed += 1;
    counters.outboundReconciliationOutstanding = Math.max(
      counters.outboundReconciliationOutstanding,
      1,
    );
  }
};

const processFirstContact = async ({
  firstContact,
  config,
  refundCaseId,
  sourceMessageId,
  publicReference,
  customerName,
  customerEmail,
  threadHasOutbound,
  counters,
}: {
  firstContact: RefundFirstContactConfig;
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
  refundCaseId: string;
  sourceMessageId: string;
  publicReference: string;
  customerName: string;
  customerEmail: string;
  threadHasOutbound: boolean;
  counters: FirstContactCounters;
}) => {
  if (!firstContact.shouldClaim) return { failed: false };
  if (!isRefundFirstContactSenderAllowed(firstContact, customerEmail)) {
    counters.firstContactSuppressed += 1;
    return { failed: false };
  }

  const intakeContextToken = firstContact.shouldSend
    ? createRefundGmailIntakeContextToken()
    : "";
  const refundRequestUrl = intakeContextToken
    ? refundRequestUrlWithEmailContext(
      firstContact.refundRequestUrl,
      intakeContextToken,
    )
    : firstContact.refundRequestUrl;

  let email: ReturnType<typeof buildRefundFirstContactEmail>;
  try {
    email = buildRefundFirstContactEmail({
      publicReference,
      customerName,
      refundRequestUrl,
      supportUrl: firstContact.supportUrl,
    });
  } catch {
    counters.firstContactFailed += 1;
    return { failed: true };
  }

  if (firstContact.shouldSend) {
    try {
      // Never create a customer-delivery claim while the shared Gmail
      // shutdown switch is closed, even if credentials remain configured.
      requireRefundGmailEnabled();
    } catch {
      counters.firstContactFailed += 1;
      return { failed: true };
    }
  }

  const claim = await claimRefundGmailDeliveryWhenEnabled(
    () =>
      rpc<Record<string, unknown> | null>(
        "service_claim_refund_gmail_first_contact",
        {
          p_source_message_id: sourceMessageId,
          p_mode: firstContact.mode,
          p_cutover_at: firstContact.cutoverAt,
          p_template_key: REFUND_FIRST_CONTACT_TEMPLATE_KEY,
          p_sender_email: config.mailbox,
          p_plain_body: email.text,
          p_thread_has_outbound: threadHasOutbound,
        },
      ),
  );

  if (!claim?.eligible) {
    counters.firstContactSuppressed += 1;
    return { failed: false };
  }
  if (!claim.claimed) {
    counters.firstContactSuppressed += 1;
    return { failed: false };
  }
  if (firstContact.mode === "shadow") {
    counters.firstContactShadowed += 1;
    return { failed: false };
  }

  const operationId = sanitizeText(claim.operationId, 80);
  const operationKey = sanitizeText(claim.operationKey, 255);
  const providerThreadId = sanitizeText(claim.providerThreadId, 255);
  const recipientEmail = sanitizeText(claim.recipientEmail, 320).toLowerCase();
  const subject = sanitizeText(claim.subject, 998) || email.subject;
  if (!operationId || !operationKey || !providerThreadId || !recipientEmail) {
    counters.firstContactFailed += 1;
    return { failed: true };
  }

  let sent: Awaited<ReturnType<typeof sendRefundGmailReply>>;
  try {
    const intakeLinkRegistered = await rpc<boolean>(
      "service_register_refund_gmail_intake_link",
      {
        p_operation_id: operationId,
        p_token_hash: await sha256Hex(intakeContextToken),
        p_expires_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
          .toISOString(),
      },
    );
    if (!intakeLinkRegistered) {
      throw new RefundGmailError(
        "gmail_first_contact_intake_link_failed",
        "Unable to prepare the refund request link.",
      );
    }
    const preparedDelivery = await rpc<Record<string, unknown>>(
      "service_prepare_refund_gmail_first_contact_delivery",
      {
        p_operation_id: operationId,
        p_mailbox_identities: config.mailboxIdentities,
      },
    );
    if (preparedDelivery.allowed !== true) {
      throw new RefundGmailError(
        "gmail_first_contact_preparation_blocked",
        "First-contact acknowledgement was not eligible for delivery.",
      );
    }
    sent = await sendRefundGmailReply({
      config,
      providerThreadId,
      operationKey,
      recipientEmail,
      ccEmails: [],
      deliveryKind: "automatic",
      subject,
      text: email.text,
      html: email.html,
      inReplyTo: sanitizeText(claim.inReplyTo, 998) || null,
      references: sanitizeText(claim.references, 4000) || null,
      recipientPolicy: "premapping_acknowledgement",
    });
  } catch (error) {
    const gmailError = error instanceof RefundGmailError
      ? error
      : new RefundGmailError(
        "gmail_first_contact_send_failed",
        "Unable to send first-contact acknowledgement.",
      );
    const completionStatus = gmailError.deliveryUncertain
      ? "delivery_unknown"
      : "failed";
    await rpc<boolean>("service_finish_refund_gmail_first_contact", {
      p_operation_id: operationId,
      p_status: completionStatus,
      p_provider_message_id: null,
      p_provider_message_header: null,
      p_error_code: gmailError.code,
    }).catch(() => false);
    counters.firstContactFailed += 1;
    return { failed: true };
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const finished = await rpc<boolean>(
        "service_finish_refund_gmail_first_contact",
        {
          p_operation_id: operationId,
          p_status: "sent",
          p_provider_message_id: sent.providerMessageId,
          p_provider_message_header: sent.providerMessageHeader,
          p_error_code: null,
        },
      );
      if (finished) {
        counters.firstContactSent += 1;
        return { failed: false };
      }
    } catch {
      // A confirmed Gmail send must never be downgraded to a known failure.
    }
  }

  await rpc<boolean>("service_finish_refund_gmail_first_contact", {
    p_operation_id: operationId,
    p_status: "delivery_unknown",
    p_provider_message_id: null,
    p_provider_message_header: null,
    p_error_code: "gmail_first_contact_finalize_unconfirmed",
  }).catch(() => false);
  counters.firstContactFailed += 1;
  return { failed: true };
};

const sendGmailCaseActionNotice = async ({
  refundCaseId,
  publicReference,
  reason,
}: {
  refundCaseId: string;
  publicReference: string;
  reason: "customer_message" | "hard_bounce";
}) => {
  if (!supabase) return;
  try {
    const { data: refundCase, error: caseError } = await supabase
      .from("refund_cases")
      .select("customer_email")
      .eq("id", refundCaseId)
      .single();
    if (caseError) throw caseError;

    const customerEmail = sanitizeText(refundCase?.customer_email, 320)
      .toLowerCase();
    const isHardBounce = reason === "hard_bounce";
    const notice = await sendRefundManagerActionNotice({
      supabase,
      refundCaseId,
      customerEmail,
      subject: isHardBounce
        ? `Refund delivery exception needs attention: ${publicReference}`
        : `Refund email needs attention: ${publicReference}`,
      summaryText: [
        isHardBounce
          ? "Gmail reported a trusted hard delivery failure for this refund customer. Automatic customer contact is paused for review."
          : "A verified customer message arrived in the linked refund Gmail thread and needs review.",
        "",
        `Reference: ${publicReference}`,
        `Reason: ${
          isHardBounce
            ? "customer delivery exception"
            : "new verified customer correspondence"
        }`,
      ].join("\n"),
    });

    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: isHardBounce
        ? "gmail_bounce_action_notice_sent"
        : "gmail_customer_action_notice_sent",
      message: notice.usedOpsFallback
        ? "Gmail action-needed work was routed to operations because the complete current Machine Manager route could not be safely resolved."
        : "Gmail action-needed notice sent only to the currently assigned Machine Managers.",
      metadata: {
        notice_reason: reason,
        recipient_count: notice.recipientCount,
        machine_manager_recipient_count: notice.managerRecipientCount,
        manager_resolution_status: notice.resolutionStatus,
        used_ops_fallback: notice.usedOpsFallback,
        payload_redacted: true,
      },
    });
  } catch (notificationError) {
    console.error("refund-gmail-sync manager action notice failed", {
      errorType: notificationError instanceof Error
        ? notificationError.name
        : typeof notificationError,
      noticeReason: reason,
      payloadRedacted: true,
    });
    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: "gmail_manager_action_notice_failed",
      message:
        "Gmail action-needed work was retained, but the manager notification needs a retry.",
      metadata: {
        notice_reason: reason,
        payload_redacted: true,
      },
    });
  }
};

const quarantinePendingAttachments = async ({
  config,
  providerMessageId,
  descriptors,
  attachmentRows,
}: {
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
  providerMessageId: string;
  descriptors: AttachmentDescriptor[];
  attachmentRows: Array<Record<string, unknown>>;
}) => {
  if (!supabase) return { quarantined: 0, failed: 0 };
  let quarantined = 0;
  let failed = 0;
  const descriptorMap = new Map(
    descriptors.map((
      descriptor,
    ) => [descriptor.providerAttachmentId, descriptor]),
  );
  for (const row of attachmentRows) {
    const attachmentId = sanitizeText(row.attachmentId, 80);
    const providerAttachmentId = sanitizeText(row.providerAttachmentId, 512);
    const status = sanitizeText(row.status, 40);
    const descriptor = descriptorMap.get(providerAttachmentId);
    if (
      !attachmentId || !descriptor || !descriptor.allowed ||
      !["pending", "error"].includes(status)
    ) continue;
    let intentId = "";
    let intentToken = "";
    try {
      const attachment = await getRefundGmailAttachment(
        config,
        providerMessageId,
        providerAttachmentId,
      );
      if (
        attachment.bytes.length <= 0 ||
        attachment.bytes.length > REFUND_GMAIL_MAX_ATTACHMENT_BYTES
      ) {
        await rpc("service_record_refund_gmail_attachment_not_uploaded", {
          p_attachment_id: attachmentId,
          p_status: "rejected",
          p_rejection_code: "attachment_download_size_rejected",
        });
        continue;
      }
      // The database records and derives the only permitted object target
      // before any Storage transport begins. A lost response after upload
      // therefore leaves durable, provider-independent deletion coordinates.
      const reservation = await rpc(
        "service_reserve_refund_gmail_attachment_upload",
        {
          p_attachment_id: attachmentId,
        },
      );
      intentId = sanitizeText(reservation?.intentId, 80);
      intentToken = sanitizeText(reservation?.claimToken, 80);
      const storageBucket = sanitizeText(reservation?.storageBucket, 160);
      const storagePath = sanitizeText(reservation?.storagePath, 1024);
      if (
        reservation?.claimed !== true ||
        !intentId ||
        !intentToken ||
        !isRefundGmailQuarantineStorageTarget(storageBucket, storagePath)
      ) {
        throw new Error("quarantine_reservation_invalid");
      }

      let uploadOutcome: "uploaded" | "upload_failed" | "upload_unknown" =
        "upload_unknown";
      try {
        const { data, error } = await supabase.storage
          .from(storageBucket)
          .upload(storagePath, attachment.bytes, {
            contentType: descriptor.contentType,
            upsert: false,
          });
        uploadOutcome = classifyRefundGmailStorageUpload({
          data,
          error,
          expectedPath: storagePath,
        });
      } catch {
        // A transport exception may occur after Storage accepted the bytes.
        // The reservation remains the durable deletion source of truth.
        uploadOutcome = "upload_unknown";
      }

      const settlement = await rpc(
        "service_settle_refund_gmail_attachment_upload",
        {
          p_intent_id: intentId,
          p_claim_token: intentToken,
          p_outcome: uploadOutcome,
        },
      );
      if (settlement?.status === "uploaded") quarantined += 1;
      else failed += 1;
    } catch {
      failed += 1;
      if (intentId && intentToken) {
        await rpc("service_settle_refund_gmail_attachment_upload", {
          p_intent_id: intentId,
          p_claim_token: intentToken,
          p_outcome: "upload_unknown",
        }).catch(() => null);
      } else {
        // No reservation token means Storage transport was never authorized.
        // This narrow RPC refuses to clear any existing upload intent.
        await rpc("service_record_refund_gmail_attachment_not_uploaded", {
          p_attachment_id: attachmentId,
          p_status: "error",
          p_rejection_code: "attachment_quarantine_failed",
        }).catch(() => null);
      }
    }
  }
  return { quarantined, failed };
};

const runRetentionSweep = async ({
  runKey,
  triggerSource,
}: {
  runKey: string;
  triggerSource: "retention" | "pre_sync";
}): Promise<RefundGmailRetentionSummary & { payloadRedacted: true }> => {
  if (!supabase) {
    throw new RefundGmailError(
      "service_configuration_missing",
      "Refund Gmail retention service is unavailable.",
    );
  }

  const start = await rpc("service_claim_refund_gmail_retention_run", {
    p_run_key: runKey,
    p_trigger_source: triggerSource,
    p_worker_enabled: retentionRuntime.workerEnabled,
    p_policy_version: retentionRuntime.policyVersion,
  });
  const startSummary = redactedRefundGmailRetentionSummary(start);
  if (start?.claimed !== true) {
    if (startSummary.status === "succeeded") return startSummary;
    throw new RefundGmailError(
      startSummary.errorCode ?? "gmail_retention_not_claimed",
      "Refund Gmail retention was not claimed.",
    );
  }

  const runId = sanitizeText(start.runId, 80);
  const runToken = sanitizeText(start.claimToken, 80);
  if (!runId || !runToken) {
    throw new RefundGmailError(
      "gmail_retention_claim_invalid",
      "Refund Gmail retention claim was invalid.",
    );
  }

  let requestedOutcome: "succeeded" | "retry_required" | "manual_review" =
    "succeeded";
  let failureCode: string | null = null;
  try {
    let claimsProcessed = 0;
    const maxClaimsPerRun = 200;
    while (claimsProcessed < maxClaimsPerRun) {
      const claim = await rpc(
        "service_claim_refund_gmail_retention_attachment",
        {
          p_run_id: runId,
          p_run_token: runToken,
        },
      );
      if (claim?.claimed !== true) break;
      claimsProcessed += 1;

      const actionId = sanitizeText(claim.actionId, 80);
      const actionToken = sanitizeText(claim.claimToken, 80);
      const storageBucket = sanitizeText(claim.storageBucket, 160);
      const storagePath = sanitizeText(claim.storagePath, 1024);
      let outcome: "deleted" | "delete_failed" | "delete_unknown" =
        "delete_unknown";

      if (
        actionId &&
        actionToken &&
        isRefundGmailQuarantineStorageTarget(storageBucket, storagePath)
      ) {
        try {
          const { data, error } = await supabase.storage.from(storageBucket)
            .remove([storagePath]);
          outcome = classifyRefundGmailStorageDelete({
            data,
            error,
            expectedPath: storagePath,
          });
        } catch {
          // A thrown transport exception can occur before or after provider
          // acceptance. Its outcome is unknown and must never auto-retry.
          outcome = "delete_unknown";
        }
      }

      if (!actionId || !actionToken) {
        requestedOutcome = "manual_review";
        failureCode = "storage_delete_outcome_unknown";
        break;
      }

      const settlement = await rpc(
        "service_settle_refund_gmail_retention_attachment",
        {
          p_action_id: actionId,
          p_claim_token: actionToken,
          p_outcome: outcome,
        },
      );
      const settlementStatus = sanitizeText(settlement?.status, 80);
      if (settlementStatus === "manual_review") {
        requestedOutcome = "manual_review";
        failureCode = "storage_delete_outcome_unknown";
      } else if (
        settlementStatus === "retry_required" &&
        requestedOutcome !== "manual_review"
      ) {
        requestedOutcome = "retry_required";
        failureCode = "storage_delete_failed";
      } else if (settlementStatus !== "deleted") {
        requestedOutcome = "manual_review";
        failureCode = "storage_delete_outcome_unknown";
      }
    }

    if (
      claimsProcessed >= maxClaimsPerRun && requestedOutcome === "succeeded"
    ) {
      requestedOutcome = "retry_required";
      failureCode = "cleanup_batch_incomplete";
    }

    const purge = await rpc("service_purge_refund_gmail_retention_content", {
      p_run_id: runId,
      p_run_token: runToken,
      p_limit: 500,
    });
    if (purge?.purged !== true && requestedOutcome !== "manual_review") {
      requestedOutcome = "retry_required";
      failureCode = "cleanup_batch_incomplete";
    }

    const settlement = await rpc("service_settle_refund_gmail_retention_run", {
      p_run_id: runId,
      p_run_token: runToken,
      p_outcome: requestedOutcome,
      p_failure_code: failureCode,
    });
    const summary = redactedRefundGmailRetentionSummary(settlement);
    if (summary.status !== "succeeded") {
      throw new RefundGmailError(
        summary.errorCode ?? "gmail_retention_failed",
        "Refund Gmail retention did not complete safely.",
      );
    }
    return summary;
  } catch (error) {
    await rpc("service_abandon_refund_gmail_retention_run", {
      p_run_id: runId,
      p_run_token: runToken,
    }).catch(() => null);
    if (error instanceof RefundGmailError) throw error;
    throw new RefundGmailError(
      "gmail_retention_failed",
      "Refund Gmail retention failed.",
    );
  }
};

const authorizeNewGmailCopies = async () => {
  const gate = await rpc("service_authorize_refund_gmail_copy", {
    p_worker_enabled: retentionRuntime.workerEnabled,
    p_policy_version: retentionRuntime.policyVersion,
    p_attachments_enabled: refundEmailPilotAttachmentsEnabled,
    p_scanner_enabled: retentionRuntime.scannerEnabled,
    p_scanner_version: retentionRuntime.scannerVersion,
  });
  if (gate?.allowed !== true) {
    throw new RefundGmailError(
      sanitizeText(gate?.status, 80) || "gmail_copy_safety_gate_closed",
      "Refund Gmail copy safety gate is closed.",
    );
  }
};

serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!authorize(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  if (!supabase) {
    return jsonResponse({ error: "Refund Gmail sync is not configured." }, 500);
  }

  const body = await request.json().catch(() => ({})) as Record<
    string,
    unknown
  >;
  const requestedTrigger = sanitizeText(body.trigger, 40).toLowerCase() ||
    "scheduled";
  const runKey = sanitizeText(body.runKey, 255);
  if (!isRefundGmailWorkflowRunKey(runKey, requestedTrigger)) {
    return jsonResponse(
      { error: "Valid run key and trigger are required." },
      400,
    );
  }
  const triggerSource = requestedTrigger;

  if (triggerSource === "retention") {
    try {
      const summary = await runRetentionSweep({
        runKey: refundGmailRetentionLedgerRunKey(runKey, "retention"),
        triggerSource: "retention",
      });
      console.info("refund-gmail retention completed", summary);
      return jsonResponse({
        ...summary,
        retentionOnly: true,
      });
    } catch (error) {
      const errorCode = error instanceof RefundGmailError
        ? error.code
        : "gmail_retention_failed";
      console.error("refund-gmail retention failed", {
        errorCode,
        payloadRedacted: true,
      });
      return jsonResponse({
        status: "failed",
        retentionOnly: true,
        errorCode,
        payloadRedacted: true,
      }, 503);
    }
  }

  if (triggerSource !== "failure_test") {
    try {
      const summary = await runRetentionSweep({
        runKey: refundGmailRetentionLedgerRunKey(runKey, triggerSource),
        triggerSource: "pre_sync",
      });
      console.info("refund-gmail pre-sync retention completed", summary);
      await authorizeNewGmailCopies();
    } catch (error) {
      const errorCode = error instanceof RefundGmailError
        ? error.code
        : "gmail_copy_safety_gate_closed";
      console.error("refund-gmail pre-sync retention failed", {
        errorCode,
        payloadRedacted: true,
      });
      return jsonResponse({
        status: "failed",
        retentionOnly: false,
        errorCode,
        payloadRedacted: true,
      }, 503);
    }
  }

  // Gmail configuration and OAuth are intentionally unavailable until local
  // cleanup succeeds and the owner/scanner/copy-health gate authorizes copying.
  const config = getRefundGmailConfig();
  const firstContact = getFirstContactConfig();
  const mailboxHash = config
    ? await sha256Hex(config.mailbox)
    : await sha256Hex("not-configured");
  const labelHash = config
    ? await sha256Hex(config.labelId)
    : await sha256Hex("not-configured");
  const enabled = triggerSource === "failure_test" ||
    (isEnabled() && Boolean(config));
  const start = await rpc("service_start_refund_gmail_sync", {
    p_run_key: runKey,
    p_trigger_source: triggerSource,
    p_started_at: new Date().toISOString(),
    p_mailbox_hash: mailboxHash,
    p_label_hash: labelHash,
    p_enabled: enabled,
  });
  if (!start?.claimed) {
    return jsonResponse({
      status: start?.status ?? "suppressed",
      claimed: false,
      reason: start?.reason ??
        (enabled ? "not_claimed" : "integration_disabled"),
      payloadRedacted: true,
    });
  }

  const runId = sanitizeText(start.runId, 80);
  if (!runId) {
    return jsonResponse({ error: "Refund Gmail sync claim was invalid." }, 500);
  }

  const counters = {
    threadsScanned: 0,
    messagesSeen: 0,
    messagesCreated: 0,
    messagesDeduplicated: 0,
    attachmentsQuarantined: 0,
    messagesFailed: 0,
    firstContactShadowed: 0,
    firstContactSent: 0,
    firstContactSuppressed: 0,
    firstContactFailed: 0,
    firstContactReconciliationOutstanding: 0,
    outboundReconciled: 0,
    outboundReconciliationFailed: 0,
    outboundReconciliationOutstanding: 0,
  };

  if (triggerSource === "failure_test") {
    await rpc("service_finish_refund_gmail_sync", {
      p_run_id: runId,
      p_status: "failed",
      p_threads_scanned: 0,
      p_messages_seen: 0,
      p_messages_created: 0,
      p_messages_deduplicated: 0,
      p_attachments_quarantined: 0,
      p_messages_failed: 1,
      p_history_id: null,
      p_failure_category: "synthetic_test",
      p_error_code: "synthetic_failure_test",
    });
    return jsonResponse({
      status: "failed",
      failureTest: true,
      payloadRedacted: true,
    }, 503);
  }

  if (!config) {
    return jsonResponse({
      error: "Refund Gmail sync configuration is incomplete.",
    }, 500);
  }

  let profileHistoryId: string | null = null;
  let fatalError: RefundGmailError | null = null;
  try {
    if (firstContact.mode === "blocked") {
      counters.firstContactFailed += 1;
      counters.messagesFailed += 1;
    }
    await rpc<number>(
      "service_mark_stale_refund_gmail_first_contacts_unknown",
      {
        p_stale_before: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
      },
    ).catch(() => {
      counters.firstContactFailed += 1;
      counters.messagesFailed += 1;
      return 0;
    });
    await rpc<number>("service_mark_stale_refund_gmail_outbound_unknown", {
      p_stale_before: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    }).catch(() => {
      counters.outboundReconciliationFailed += 1;
      counters.messagesFailed += 1;
      return 0;
    });
    const profile = await verifyRefundGmailMailbox(config);
    profileHistoryId = sanitizeText(profile.historyId, 255) || null;
    await reconcileOutstandingFirstContacts({ config, counters });
    await reconcileOutstandingOutbound({ config, counters });
    const maxThreads = Math.min(
      Math.max(
        Number(Deno.env.get("GMAIL_REFUND_MAX_THREADS_PER_RUN") ?? 100),
        1,
      ),
      500,
    );
    let nextPageToken: string | undefined;
    while (counters.threadsScanned < maxThreads) {
      const page = await listLabeledRefundThreads(config, nextPageToken);
      const threadRefs = page.threads ?? [];
      if (threadRefs.length === 0) break;
      for (const threadRef of threadRefs) {
        if (counters.threadsScanned >= maxThreads) break;
        const providerThreadId = sanitizeText(threadRef.id, 255);
        if (!providerThreadId) continue;
        counters.threadsScanned += 1;
        try {
          const thread = await getRefundGmailThread(config, providerThreadId);
          const messages = [...(thread.messages ?? [])].sort(
            (left, right) =>
              Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0),
          );
          const threadHasOutbound = messages.some((message) =>
            (() => {
              const signals = inspectRefundGmailParticipantSignals({
                message,
                mailboxIdentities: config.mailboxIdentities,
              });
              return signals.mailboxOrigin && signals.providerSentEvidence;
            })()
          );
          await ingestRefundGmailThreadBeforeFirstContact<
            GmailMessage,
            FirstContactCandidate
          >({
            messages,
            ingestMessage: async (message) => {
              counters.messagesSeen += 1;
              const providerMessageId = sanitizeText(message.id, 255);
              if (!providerMessageId) {
                counters.messagesFailed += 1;
                return null;
              }
              const headers = message.payload?.headers;
              const participantSignals = inspectRefundGmailParticipantSignals({
                message,
                mailboxIdentities: config.mailboxIdentities,
              });
              const {
                from,
                isBounce,
                isHardBounce,
                isAutomated,
                mailboxOrigin,
                providerSentEvidence,
                participantTrust,
              } = participantSignals;
              const direction = isBounce
                ? "system"
                : mailboxOrigin && providerSentEvidence
                ? "outbound"
                : isAutomated
                ? "system"
                : "inbound";
              if (!from.email && direction !== "system") {
                counters.messagesFailed += 1;
                return null;
              }
              const rawSubject =
                sanitizeText(getGmailHeader(headers, "Subject"), 998) ||
                "(no subject)";
              const rawBody = extractPlainTextBody(message.payload);
              const redactedSubject = redactPaymentCardNumbers(rawSubject);
              const redactedBody = redactPaymentCardNumbers(rawBody);
              const attachmentDescriptors = refundEmailPilotAttachmentsEnabled &&
                  direction === "inbound" && !isBounce
                ? collectAttachmentDescriptors(message.payload)
                : [];
              const ingestion = await rpc(
                "service_ingest_refund_gmail_message_v2",
                {
                  p_mailbox_hash: mailboxHash,
                  p_provider_thread_id: providerThreadId,
                  p_provider_message_id: providerMessageId,
                  p_provider_message_header:
                    sanitizeText(getGmailHeader(headers, "Message-ID"), 998) ||
                    null,
                  p_references_header:
                    sanitizeText(getGmailHeader(headers, "References"), 4000) ||
                    null,
                  p_direction: direction,
                  p_is_bounce: isBounce,
                  p_sender_email: from.email || null,
                  p_sender_name: from.name || null,
                  p_recipient_email: participantSignals.toEmails[0] ||
                    config.mailbox,
                  p_subject: redactedSubject.text,
                  p_plain_body: redactedBody.text,
                  p_sensitive_data_redacted: redactedSubject.redacted ||
                    redactedBody.redacted,
                  p_received_at: receivedAtForMessage(message),
                  p_public_reference: extractPublicReference(
                    redactedSubject.text,
                    redactedBody.text,
                  ),
                  p_attachments: attachmentDescriptors,
                  p_recipient_cc_emails: participantSignals.ccEmails,
                  p_mailbox_identities: config.mailboxIdentities,
                  p_participant_trust: participantTrust,
                  p_provider_sent: providerSentEvidence,
                  p_is_hard_bounce: isHardBounce,
                  p_failed_recipient_emails:
                    participantSignals.failedRecipientEmails,
                },
              );
              if (ingestion?.created) counters.messagesCreated += 1;
              if (ingestion?.duplicate) counters.messagesDeduplicated += 1;
              const caseId = sanitizeText(ingestion?.caseId, 80);
              const internalMessageId = sanitizeText(ingestion?.messageId, 80);
              const publicReference =
                sanitizeText(ingestion?.publicReference, 80) || "refund case";
              const participantRole = sanitizeText(
                ingestion?.participantRole,
                80,
              );
              const automaticContactPaused =
                ingestion?.automaticCustomerContactPaused === true;
              if (
                ingestion?.created && caseId &&
                (participantRole === "customer" || automaticContactPaused)
              ) {
                await sendGmailCaseActionNotice({
                  refundCaseId: caseId,
                  publicReference,
                  reason: automaticContactPaused
                    ? "hard_bounce"
                    : "customer_message",
                });
              }
              const attachmentRows = Array.isArray(ingestion?.attachments)
                ? ingestion.attachments as Array<Record<string, unknown>>
                : [];
              if (caseId && internalMessageId && attachmentRows.length > 0) {
                const attachmentResult = await quarantinePendingAttachments({
                  config,
                  providerMessageId,
                  descriptors: attachmentDescriptors,
                  attachmentRows,
                });
                counters.attachmentsQuarantined += attachmentResult.quarantined;
                counters.messagesFailed += attachmentResult.failed;
              }
              return participantRole === "customer" && caseId &&
                  internalMessageId
                ? {
                  refundCaseId: caseId,
                  sourceMessageId: internalMessageId,
                  publicReference,
                  customerName: from.name,
                  customerEmail: from.email,
                }
                : null;
            },
            processFirstContact: async (firstContactCandidate) => {
              const firstContactResult = await processFirstContact({
                firstContact,
                config,
                ...firstContactCandidate,
                threadHasOutbound,
                counters,
              });
              if (firstContactResult.failed) counters.messagesFailed += 1;
            },
          });
        } catch {
          counters.messagesFailed += 1;
        }
      }
      nextPageToken = page.nextPageToken;
      if (!nextPageToken) break;
    }
  } catch (error) {
    fatalError = error instanceof RefundGmailError
      ? error
      : new RefundGmailError("gmail_sync_failed", "Gmail sync failed.");
    counters.messagesFailed += 1;
  }

  const succeeded = !fatalError &&
    counters.messagesFailed === 0 &&
    counters.firstContactFailed === 0 &&
    counters.firstContactReconciliationOutstanding === 0 &&
    counters.outboundReconciliationFailed === 0 &&
    counters.outboundReconciliationOutstanding === 0;
  const errorCode = fatalError?.code ??
    (succeeded
      ? null
      : counters.outboundReconciliationOutstanding > 0
      ? "gmail_outbound_delivery_reconciliation_required"
      : counters.firstContactReconciliationOutstanding > 0
      ? "gmail_first_contact_reconciliation_required"
      : counters.outboundReconciliationFailed > 0
      ? "gmail_outbound_reconciliation_failed"
      : counters.firstContactFailed > 0
      ? firstContact.errorCode ?? "gmail_first_contact_processing_failed"
      : "gmail_message_processing_failed");
  await rpc("service_finish_refund_gmail_sync", {
    p_run_id: runId,
    p_status: succeeded ? "succeeded" : "failed",
    p_threads_scanned: counters.threadsScanned,
    p_messages_seen: counters.messagesSeen,
    p_messages_created: counters.messagesCreated,
    p_messages_deduplicated: counters.messagesDeduplicated,
    p_attachments_quarantined: counters.attachmentsQuarantined,
    p_messages_failed: counters.messagesFailed,
    p_history_id: succeeded ? profileHistoryId : null,
    p_failure_category: succeeded
      ? null
      : fatalError
      ? "provider_or_auth"
      : counters.firstContactReconciliationOutstanding > 0 ||
          counters.outboundReconciliationOutstanding > 0 ||
          counters.outboundReconciliationFailed > 0
      ? "delivery_reconciliation"
      : "message_processing",
    p_error_code: errorCode,
  });

  console.info("refund-gmail-sync completed", {
    status: succeeded ? "succeeded" : "failed",
    ...counters,
    errorCode,
    payloadRedacted: true,
  });
  return jsonResponse({
    status: succeeded ? "succeeded" : "failed",
    ...counters,
    errorCode,
    payloadRedacted: true,
  }, succeeded ? 200 : 503);
});
