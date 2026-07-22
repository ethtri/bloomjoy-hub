import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  extractPlainTextBody,
  getGmailHeader,
  getRefundGmailAttachment,
  getRefundGmailConfig,
  getRefundGmailThread,
  listLabeledRefundThreads,
  parseEmailAddress,
  redactPaymentCardNumbers,
  REFUND_GMAIL_ALLOWED_MIME_TYPES,
  REFUND_GMAIL_MAX_ATTACHMENTS_PER_MESSAGE,
  REFUND_GMAIL_MAX_ATTACHMENT_BYTES,
  RefundGmailError,
  sha256Hex,
  verifyRefundGmailMailbox,
  type GmailMessage,
  type GmailMessagePart,
} from "../_shared/refund-gmail.ts";

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

const isBounceMessage = (message: GmailMessage) => {
  const headers = message.payload?.headers;
  const sender = parseEmailAddress(getGmailHeader(headers, "From")).email;
  const subject = getGmailHeader(headers, "Subject").toLowerCase();
  return sender.startsWith("mailer-daemon@") || sender.startsWith("postmaster@") ||
    Boolean(getGmailHeader(headers, "X-Failed-Recipients")) ||
    subject.includes("delivery status notification") || subject.includes("undeliverable");
};

const isAutomatedMessage = (message: GmailMessage) => {
  const headers = message.payload?.headers;
  const autoSubmitted = getGmailHeader(headers, "Auto-Submitted").toLowerCase();
  const precedence = getGmailHeader(headers, "Precedence").toLowerCase();
  return (autoSubmitted && autoSubmitted !== "no") ||
    ["bulk", "junk", "list"].includes(precedence) ||
    Boolean(getGmailHeader(headers, "X-Auto-Response-Suppress"));
};

const extractPublicReference = (subject: string, body: string) =>
  `${subject}\n${body}`.match(/\bRF-[A-Z0-9]{6,20}\b/i)?.[0]?.toUpperCase() ?? null;

const receivedAtForMessage = (message: GmailMessage) => {
  const timestamp = Number(message.internalDate ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();
};

const rpc = async (name: string, args: Record<string, unknown>) => {
  if (!supabase) throw new RefundGmailError("service_configuration_missing", "Refund Gmail service is unavailable.");
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new RefundGmailError("database_operation_failed", "Refund Gmail database operation failed.");
  return data as Record<string, unknown> | null;
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
    const profile = await verifyRefundGmailMailbox(config);
    profileHistoryId = sanitizeText(profile.historyId, 255) || null;
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
          for (const message of messages) {
            counters.messagesSeen += 1;
            const providerMessageId = sanitizeText(message.id, 255);
            if (!providerMessageId) {
              counters.messagesFailed += 1;
              continue;
            }
            const headers = message.payload?.headers;
            const from = parseEmailAddress(getGmailHeader(headers, "From"));
            const to = parseEmailAddress(getGmailHeader(headers, "To"));
            const isBounce = isBounceMessage(message);
            const isAutomated = isAutomatedMessage(message);
            const direction = isBounce || isAutomated
              ? "system"
              : from.email === config.mailbox
              ? "outbound"
              : "inbound";
            if (!from.email && direction !== "system") {
              counters.messagesFailed += 1;
              continue;
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
          }
        } catch {
          counters.messagesFailed += 1;
        }
      }
      nextPageToken = page.nextPageToken;
      if (!nextPageToken) break;
    }

    if (counters.messagesFailed === 0) {
      await runRetentionSweep();
    }
  } catch (error) {
    fatalError = error instanceof RefundGmailError
      ? error
      : new RefundGmailError("gmail_sync_failed", "Gmail sync failed.");
    counters.messagesFailed += 1;
  }

  const succeeded = !fatalError && counters.messagesFailed === 0;
  const errorCode = fatalError?.code ?? (succeeded ? null : "gmail_message_processing_failed");
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
    p_failure_category: succeeded ? null : fatalError ? "provider_or_auth" : "message_processing",
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
