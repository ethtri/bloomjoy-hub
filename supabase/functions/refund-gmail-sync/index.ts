import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  extractPlainTextBody,
  getGmailHeader,
  getRefundGmailAttachment,
  getRefundGmailConfig,
  getRefundGmailThread,
  inspectRefundGmailReplyByMessageHeader,
  isRefundGmailAutomatedMessage,
  isRefundGmailBounceMessage,
  isRefundGmailMailboxIdentity,
  listLabeledRefundThreads,
  parseEmailAddress,
  redactPaymentCardNumbers,
  REFUND_GMAIL_ALLOWED_MIME_TYPES,
  REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE,
  REFUND_GMAIL_MAX_ATTACHMENT_BYTES,
  RefundGmailError,
  sendRefundGmailReply,
  sha256Hex,
  verifyRefundGmailMailbox,
  type GmailMessage,
  type GmailMessagePart,
} from "../_shared/refund-gmail.ts";
import { ingestRefundGmailThreadBeforeFirstContact } from "../_shared/refund-gmail-orchestration.ts";
import {
  buildRefundFirstContactEmail,
  isRefundFirstContactSenderAllowed,
  REFUND_FIRST_CONTACT_TEMPLATE_KEY,
  resolveRefundFirstContactConfig,
  type RefundFirstContactConfig,
} from "../_shared/refund-first-contact.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = (Deno.env.get("REFUND_GMAIL_SYNC_SECRET") ?? "").trim();

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, { auth: { persistSession: false } })
  : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const sanitizeText = (value: unknown, maxLength: number) =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value).trim().slice(0, maxLength)
    : "";

const isEnabled = () =>
  ["1", "true", "yes", "on"].includes((Deno.env.get("REFUND_GMAIL_ENABLED") ?? "").trim().toLowerCase());

const safeEqual = (left: string, right: string) => {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  if (leftBytes.length !== rightBytes.length || leftBytes.length === 0) return false;
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
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join("");
  const cleaned = printable
    .replace(/[^\p{L}\p{N}._() -]/gu, "_")
    .trim();
  return (cleaned || "attachment").slice(0, 255);
};

const contentDisposition = (part: GmailMessagePart) =>
  getGmailHeader(part.headers, "Content-Disposition").toLowerCase();

const collectAttachmentDescriptors = (payload: GmailMessagePart | undefined) => {
  const descriptors: AttachmentDescriptor[] = [];
  const visit = (part: GmailMessagePart | undefined) => {
    if (!part) return;
    const providerAttachmentId = sanitizeText(part.body?.attachmentId, 512);
    const rawFileName = sanitizeText(part.filename, 255);
    if (providerAttachmentId && rawFileName) {
      const fileName = safeFileName(rawFileName);
      const contentType = sanitizeText(part.mimeType, 160).toLowerCase() || "application/octet-stream";
      const byteSize = Math.max(0, Number(part.body?.size ?? 0));
      const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
      const expectedExtension = extensionForType(contentType);
      const typeAllowed = REFUND_GMAIL_ALLOWED_MIME_TYPES.has(contentType);
      const extensionAllowed = expectedExtension === "jpg"
        ? ["jpg", "jpeg"].includes(extension)
        : extension === expectedExtension;
      const underCount = descriptors.length < REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE;
      const sizeAllowed = byteSize > 0 && byteSize <= REFUND_GMAIL_MAX_ATTACHMENT_BYTES;
      const allowed = typeAllowed && extensionAllowed && underCount && sizeAllowed;
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
        disposition: contentDisposition(part).startsWith("inline") ? "inline" : "attachment",
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
  `${subject}\n${body}`.match(/\bRF-[A-Z0-9]{6,20}\b/i)?.[0]?.toUpperCase() ?? null;

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
  if (!supabase) throw new RefundGmailError("service_configuration_missing", "Refund Gmail service is unavailable.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RefundGmailError("database_operation_failed", "Refund Gmail database operation failed.");
  return data as T;
};

const getFirstContactConfig = () => resolveRefundFirstContactConfig({
  REFUND_GMAIL_FIRST_CONTACT_MODE: Deno.env.get("REFUND_GMAIL_FIRST_CONTACT_MODE"),
  REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT: Deno.env.get("REFUND_GMAIL_FIRST_CONTACT_CUTOVER_AT"),
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
  REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL: Deno.env.get(
    "REFUND_GMAIL_FIRST_CONTACT_LEGACY_URL",
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
  sourceMessageId: string;
  publicReference: string;
  customerName: string;
  customerEmail: string;
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
      const reconciled = await rpc<boolean>("service_finish_refund_gmail_first_contact", {
        p_operation_id: operationId,
        p_status: "sent",
        p_provider_message_id: providerEvidence.providerMessageId,
        p_provider_message_header: providerEvidence.providerMessageHeader,
        p_error_code: null,
        p_attempt_version: attemptVersion,
      });
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
  sourceMessageId,
  publicReference,
  customerName,
  customerEmail,
  threadHasOutbound,
  counters,
}: {
  firstContact: RefundFirstContactConfig;
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
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

  let email: ReturnType<typeof buildRefundFirstContactEmail>;
  try {
    email = buildRefundFirstContactEmail({
      publicReference,
      customerName,
      refundRequestUrl: firstContact.refundRequestUrl,
      legacyRefundUrl: firstContact.legacyRefundUrl,
      supportUrl: firstContact.supportUrl,
    });
  } catch {
    counters.firstContactFailed += 1;
    return { failed: true };
  }

  const claim = await rpc<Record<string, unknown> | null>(
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
    sent = await sendRefundGmailReply({
      config,
      providerThreadId,
      operationKey,
      recipientEmail,
      subject,
      text: email.text,
      html: email.html,
      inReplyTo: sanitizeText(claim.inReplyTo, 998) || null,
      references: sanitizeText(claim.references, 4000) || null,
      automatic: true,
    });
  } catch (error) {
    const gmailError = error instanceof RefundGmailError
      ? error
      : new RefundGmailError("gmail_first_contact_send_failed", "Unable to send first-contact acknowledgement.");
    const completionStatus = gmailError.deliveryUncertain ? "delivery_unknown" : "failed";
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
      const finished = await rpc<boolean>("service_finish_refund_gmail_first_contact", {
        p_operation_id: operationId,
        p_status: "sent",
        p_provider_message_id: sent.providerMessageId,
        p_provider_message_header: sent.providerMessageHeader,
        p_error_code: null,
      });
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

const quarantinePendingAttachments = async ({
  config,
  providerMessageId,
  messageId,
  caseId,
  descriptors,
  attachmentRows,
}: {
  config: NonNullable<ReturnType<typeof getRefundGmailConfig>>;
  providerMessageId: string;
  messageId: string;
  caseId: string;
  descriptors: AttachmentDescriptor[];
  attachmentRows: Array<Record<string, unknown>>;
}) => {
  if (!supabase) return { quarantined: 0, failed: 0 };
  let quarantined = 0;
  let failed = 0;
  const descriptorMap = new Map(descriptors.map((descriptor) => [descriptor.providerAttachmentId, descriptor]));
  for (const row of attachmentRows) {
    const attachmentId = sanitizeText(row.attachmentId, 80);
    const providerAttachmentId = sanitizeText(row.providerAttachmentId, 512);
    const status = sanitizeText(row.status, 40);
    const descriptor = descriptorMap.get(providerAttachmentId);
    if (!attachmentId || !descriptor || !descriptor.allowed || !["pending", "error"].includes(status)) continue;
    try {
      const attachment = await getRefundGmailAttachment(config, providerMessageId, providerAttachmentId);
      if (attachment.bytes.length <= 0 || attachment.bytes.length > REFUND_GMAIL_MAX_ATTACHMENT_BYTES) {
        await rpc("service_mark_refund_gmail_attachment", {
          p_attachment_id: attachmentId,
          p_status: "rejected",
          p_storage_bucket: null,
          p_storage_path: null,
          p_rejection_code: "attachment_download_size_rejected",
        });
        continue;
      }
      const storagePath = `${caseId}/${messageId}/${attachmentId}.${extensionForType(descriptor.contentType)}`;
      const { error } = await supabase.storage
        .from("refund-gmail-quarantine")
        .upload(storagePath, attachment.bytes, {
          contentType: descriptor.contentType,
          upsert: true,
        });
      if (error) throw new Error("quarantine_upload_failed");
      await rpc("service_mark_refund_gmail_attachment", {
        p_attachment_id: attachmentId,
        p_status: "quarantined",
        p_storage_bucket: "refund-gmail-quarantine",
        p_storage_path: storagePath,
        p_rejection_code: "malware_scan_pending",
      });
      quarantined += 1;
    } catch {
      failed += 1;
      await rpc("service_mark_refund_gmail_attachment", {
        p_attachment_id: attachmentId,
        p_status: "error",
        p_storage_bucket: null,
        p_storage_path: null,
        p_rejection_code: "attachment_quarantine_failed",
      }).catch(() => null);
    }
  }
  return { quarantined, failed };
};

const runRetentionSweep = async () => {
  if (!supabase) return;
  const expired = await rpc("service_list_refund_gmail_expired_attachments", { p_limit: 50 });
  const items = Array.isArray(expired) ? expired : [];
  for (const item of items as Array<Record<string, unknown>>) {
    const attachmentId = sanitizeText(item.attachmentId, 80);
    const bucket = sanitizeText(item.storageBucket, 160);
    const path = sanitizeText(item.storagePath, 1024);
    if (!attachmentId || !bucket || !path) continue;
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) continue;
    await rpc("service_mark_refund_gmail_attachment", {
      p_attachment_id: attachmentId,
      p_status: "deleted",
      p_storage_bucket: null,
      p_storage_path: null,
      p_rejection_code: "retention_expired",
    });
  }
  await rpc("service_purge_refund_gmail_expired_message_content", { p_limit: 200 });
};

serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!authorize(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  if (!supabase) return jsonResponse({ error: "Refund Gmail sync is not configured." }, 500);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const triggerSource = sanitizeText(body.trigger, 40).toLowerCase() || "scheduled";
  const runKey = sanitizeText(body.runKey, 255);
  if (!runKey || !["scheduled", "manual", "failure_test"].includes(triggerSource)) {
    return jsonResponse({ error: "Valid run key and trigger are required." }, 400);
  }

  const config = getRefundGmailConfig();
  const firstContact = getFirstContactConfig();
  const mailboxHash = config ? await sha256Hex(config.mailbox) : await sha256Hex("not-configured");
  const labelHash = config ? await sha256Hex(config.labelId) : await sha256Hex("not-configured");
  const enabled = triggerSource === "failure_test" || (isEnabled() && Boolean(config));
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
      reason: start?.reason ?? (enabled ? "not_claimed" : "integration_disabled"),
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
    return jsonResponse({ status: "failed", failureTest: true, payloadRedacted: true }, 503);
  }

  if (!config) {
    return jsonResponse({ error: "Refund Gmail sync configuration is incomplete." }, 500);
  }

  let profileHistoryId: string | null = null;
  let fatalError: RefundGmailError | null = null;
  try {
    // Retention is a local privacy obligation and must not depend on Google authorization remaining healthy.
    await runRetentionSweep();
    if (firstContact.mode === "blocked") {
      counters.firstContactFailed += 1;
      counters.messagesFailed += 1;
    }
    await rpc<number>("service_mark_stale_refund_gmail_first_contacts_unknown", {
      p_stale_before: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
    }).catch(() => {
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
      Math.max(Number(Deno.env.get("GMAIL_REFUND_MAX_THREADS_PER_RUN") ?? 100), 1),
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
            (left, right) => Number(left.internalDate ?? 0) - Number(right.internalDate ?? 0),
          );
          const threadHasOutbound = messages.some((message) =>
            isRefundGmailMailboxIdentity(
              config,
              parseEmailAddress(getGmailHeader(message.payload?.headers, "From")).email,
            )
          );
          await ingestRefundGmailThreadBeforeFirstContact<GmailMessage, FirstContactCandidate>({
            messages,
            ingestMessage: async (message) => {
              counters.messagesSeen += 1;
              const providerMessageId = sanitizeText(message.id, 255);
              if (!providerMessageId) {
                counters.messagesFailed += 1;
                return null;
              }
              const headers = message.payload?.headers;
              const from = parseEmailAddress(getGmailHeader(headers, "From"));
              const to = parseEmailAddress(getGmailHeader(headers, "To"));
              const isBounce = isRefundGmailBounceMessage(message);
              const isAutomated = isRefundGmailAutomatedMessage(message);
              const direction = isRefundGmailMailboxIdentity(config, from.email)
                ? "outbound"
                : isBounce || isAutomated
                ? "system"
                : "inbound";
              if (!from.email && direction !== "system") {
                counters.messagesFailed += 1;
                return null;
              }
              const rawSubject = sanitizeText(getGmailHeader(headers, "Subject"), 998) || "(no subject)";
              const rawBody = extractPlainTextBody(message.payload);
              const redactedSubject = redactPaymentCardNumbers(rawSubject);
              const redactedBody = redactPaymentCardNumbers(rawBody);
              const attachmentDescriptors = direction === "inbound" && !isBounce
                ? collectAttachmentDescriptors(message.payload)
                : [];
              const ingestion = await rpc("service_ingest_refund_gmail_message", {
                p_mailbox_hash: mailboxHash,
                p_provider_thread_id: providerThreadId,
                p_provider_message_id: providerMessageId,
                p_provider_message_header: sanitizeText(getGmailHeader(headers, "Message-ID"), 998) || null,
                p_references_header: sanitizeText(getGmailHeader(headers, "References"), 4000) || null,
                p_direction: direction,
                p_is_bounce: isBounce,
                p_sender_email: from.email || null,
                p_sender_name: from.name || null,
                p_recipient_email: to.email || config.mailbox,
                p_subject: redactedSubject.text,
                p_plain_body: redactedBody.text,
                p_sensitive_data_redacted: redactedSubject.redacted || redactedBody.redacted,
                p_received_at: receivedAtForMessage(message),
                p_public_reference: extractPublicReference(redactedSubject.text, redactedBody.text),
                p_attachments: attachmentDescriptors,
              });
              if (ingestion?.created) counters.messagesCreated += 1;
              if (ingestion?.duplicate) counters.messagesDeduplicated += 1;
              const caseId = sanitizeText(ingestion?.caseId, 80);
              const internalMessageId = sanitizeText(ingestion?.messageId, 80);
              const publicReference = sanitizeText(ingestion?.publicReference, 80);
              const candidate = direction === "inbound" && internalMessageId
                ? {
                  sourceMessageId: internalMessageId,
                  publicReference,
                  customerName: from.name,
                  customerEmail: from.email,
                }
                : null;
              const attachmentRows = Array.isArray(ingestion?.attachments)
                ? ingestion.attachments as Array<Record<string, unknown>>
                : [];
              if (caseId && internalMessageId && attachmentRows.length > 0) {
                const attachmentResult = await quarantinePendingAttachments({
                  config,
                  providerMessageId,
                  messageId: internalMessageId,
                  caseId,
                  descriptors: attachmentDescriptors,
                  attachmentRows,
                });
                counters.attachmentsQuarantined += attachmentResult.quarantined;
                counters.messagesFailed += attachmentResult.failed;
              }
              return candidate;
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
  const errorCode = fatalError?.code ?? (succeeded
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
