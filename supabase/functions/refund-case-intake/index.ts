import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildRefundCustomerEmail,
  redactRefundStatusLinksForStorage,
  sendRefundTransactionalEmail,
} from "../_shared/refund-email.ts";
import { inferRefundCustomerLocale } from "../_shared/refund-language.ts";
import { automaticRefundCustomerContactEnabled } from "../_shared/refund-deterministic-follow-up.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { RefundGmailError } from "../_shared/refund-gmail.ts";
import {
  RefundEmailContextUnavailableError,
  requireLinkedRefundEmailCase,
  requireLinkedRefundEmailThreadId,
} from "../_shared/refund-email-context.ts";
import { sendRefundManagerActionNotice } from "../_shared/refund-manager-notification.ts";
import {
  bindRefundTransactionalDelivery,
  markRefundTransactionalDeliveryAttempt,
} from "../_shared/refund-transactional-delivery.ts";
import {
  lookupNayaxCandidatesForRefundCase,
  type NayaxLookupResult,
} from "../_shared/nayax-lookup.ts";
import { resolveLocalDateTimeInZone } from "../_shared/timezone-resolution.mjs";
import {
  isPlaceholderRefundLocation,
  resolveRefundPublicLabels,
} from "../_shared/refund-location.ts";
import {
  buildPublicIntakeDedupeKey,
  buildPublicIntakeKeyHashes,
  checkPublicIntakeRateLimits,
  getPublicIntakeClientIp,
  getPublicIntakeWindowStart,
  PUBLIC_INTAKE_DEDUPE_WINDOW_SECONDS,
  PUBLIC_INTAKE_NOTIFICATION_LIMITS,
  PUBLIC_INTAKE_SUBMISSION_LIMITS,
  PUBLIC_REFUND_QR_CLAIM_LIMITS,
  PUBLIC_REFUND_WALLET_CORRECTION_LIMITS,
  sanitizePublicIntakeSourcePage,
  type PublicIntakeAbuseSupabaseClient,
} from "../_shared/public-intake-abuse-controls.ts";
import {
  createRefundQrClaimToken,
  hashRefundQrClaimToken,
  isRefundQrOpaqueToken,
  REFUND_QR_CLAIM_TTL_MINUTES,
} from "../_shared/refund-qr-claim.ts";
import {
  hashRefundWalletCorrectionToken,
  isRefundWalletCorrectionToken,
} from "../_shared/refund-wallet-correction.ts";
import { runAutomaticNayaxLookupIfReady } from "../_shared/automatic-nayax-lookup.ts";
import { handlePurchaseCorrection } from "../_shared/refund-purchase-correction-handler.ts";
import { validateRefundIntakePayment } from "../_shared/refund-intake-payment.ts";
import { incidentTimeIsMateriallyFuture } from "../_shared/refund-request-time-boundary.mjs";
import {
  hashRefundStatusValue,
  issueRefundStatusCapability,
  readRefundStatusCapability,
  type RefundStatusCapability,
} from "../_shared/refund-status-capability.ts";
import {
  beginNayaxLookup,
  failNayaxLookup,
  persistNayaxLookupResult,
} from "../_shared/nayax-lookup-persistence.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const attachmentBucket = "refund-case-attachments";
const maxAttachments = 3;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxRequestBytes = 18 * 1024 * 1024;
const allowedContentTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const automaticCustomerContactEnabled = automaticRefundCustomerContactEnabled();
const refundEmailPilotAttachmentsEnabled = false;
const refundStatusResponseHeaders = {
  ...corsHeaders,
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

const automaticCustomerContactAllowed = async () => {
  if (!automaticCustomerContactEnabled || !supabase) return false;
  const { data, error } = await supabase
    .from("refund_customer_contact_settings")
    .select("automatic_customer_contact_enabled")
    .eq("singleton", true)
    .maybeSingle();
  if (error) {
    console.error("refund intake customer-contact gate unavailable", {
      errorType: typeof error.code === "string" ? error.code : "database_error",
    });
    return false;
  }
  return data?.automatic_customer_contact_enabled === true;
};

type RefundAttachmentInput = {
  fileName?: unknown;
  contentType?: unknown;
  byteSize?: unknown;
  base64?: unknown;
};

type PreparedRefundAttachment = {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
};

type SubmittedRefundCase = {
  id: string;
  public_reference: string;
  status: string;
  correlation_status: string;
  gmail_thread_id?: string;
};

type VerifiedRefundQrClaim = {
  id: string;
  reportingMachineId: string;
  openedAt: string;
  expiresAt: string;
};

const isRefundEmailContextToken = (value: string) =>
  /^[A-Za-z0-9_-]{43}$/.test(value);

const hashRefundEmailContextToken = async (value: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

type RefundWalletCorrectionContext = {
  state?: string;
  expiresAt?: string;
  version?: number;
  publicReference?: string;
  machineLabel?: string;
  locationName?: string;
  locationTimezone?: string;
  paymentAmountCents?: number;
  incidentLocalDateTime?: string | null;
  incidentAt?: string;
};

class RequestValidationError extends Error {}

const sanitizeText = (value: unknown, maxLength = 2000) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const sanitizeEmail = (value: unknown) => sanitizeText(value, 320).toLowerCase();

const normalizeCardNetwork = (value: unknown) => {
  const normalized = sanitizeText(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!normalized) return null;
  if (normalized.includes("visa")) return "visa";
  if (normalized.includes("mastercard") || normalized.includes("master card") || normalized === "mc") {
    return "mastercard";
  }
  if (normalized.includes("discover")) return "discover";
  if (normalized.includes("american express") || normalized.includes("amex")) {
    return "american_express";
  }
  if (["other", "unknown", "not sure", "other unknown"].includes(normalized)) {
    return "other_unknown";
  }
  return null;
};

const centsFromAmount = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value * 100));
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/[$,\s]/g, "");
  if (!normalized) {
    return null;
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount) || amount < 0) {
    return null;
  }

  return Math.round(amount * 100);
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const isEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const issueStatusCapability = async (
  refundCaseId: string,
): Promise<RefundStatusCapability | null> => {
  if (!supabase) return null;
  try {
    return await issueRefundStatusCapability({ supabase, refundCaseId });
  } catch (error) {
    console.error("refund status capability issuance failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
};

const waitForStatusTimingEnvelope = async (startedAt: number) => {
  const remaining = 150 - (Date.now() - startedAt);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
};

const readCustomerRefundStatus = async (
  req: Request,
  body: Record<string, unknown>,
) => {
  const startedAt = Date.now();
  const token = sanitizeText(body?.token, 80);
  const clientIp = getPublicIntakeClientIp(req) || "unknown";
  const accessKeyDigest = await hashRefundStatusValue(
    `${getAbuseControlSalt()}|refund-status|${clientIp}`,
  );
  let result: Awaited<ReturnType<typeof readRefundStatusCapability>>;
  try {
    result = await readRefundStatusCapability({
      supabase: supabase!,
      token,
      accessKeyDigest,
    });
  } catch {
    result = { available: false, rateLimited: false };
  }
  await waitForStatusTimingEnvelope(startedAt);

  if (!result.available) {
    return new Response(
      JSON.stringify({
        error: result.rateLimited
          ? "Please wait before checking this secure link again."
          : "This secure refund status link is not available.",
        errorCode: result.rateLimited
          ? "refund_status_rate_limited"
          : "refund_status_unavailable",
        payloadRedacted: true,
      }),
      { status: result.rateLimited ? 429 : 404, headers: refundStatusResponseHeaders },
    );
  }

  return new Response(
    JSON.stringify({
      lifecycle: result.lifecycle,
      expiresAt: result.expiresAt,
      payloadRedacted: true,
    }),
    { headers: refundStatusResponseHeaders },
  );
};

const getAbuseControlSalt = () =>
  Deno.env.get("PUBLIC_INTAKE_ABUSE_HASH_SALT") ||
  supabaseServiceRoleKey ||
  "bloomjoy-public-intake";

const readJsonBody = async (
  req: Request,
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; status: number; error: string }
> => {
  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > maxRequestBytes) {
    return {
      ok: false,
      status: 413,
      error: "Unable to submit refund request.",
    };
  }

  const reader = req.body?.getReader();
  if (!reader) {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxRequestBytes) {
      await reader.cancel();
      return {
        ok: false,
        status: 413,
        error: "Unable to submit refund request.",
      };
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, status: 400, error: "Invalid request body." };
    }
    return { ok: true, body: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, status: 400, error: "Invalid request body." };
  }
};

const parseIncidentAt = (value: unknown) => {
  const raw = sanitizeText(value, 80);
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const safeFileName = (value: string) =>
  value
    .replace(/[^a-z0-9.\-_]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || "photo";

const decodeBase64 = (value: string) => {
  try {
    const payload = (value.includes(",") ? value.split(",").pop() ?? "" : value)
      .replace(/\s/g, "");
    const binary = atob(payload);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new RequestValidationError("Attachments must be valid image uploads.");
  }
};

const buildManagerNotificationSummary = ({
  publicReference,
  machineLabel,
  locationName,
  status,
}: {
  publicReference: string;
  machineLabel: string;
  locationName: string;
  status: string;
}) => [
  "A new Bloomjoy refund request is ready for manager review.",
  "",
  `Reference: ${publicReference}`,
  `Machine: ${machineLabel}`,
  `Location: ${locationName}`,
  `Current status: ${status}`,
].join("\n");

const sendManagerIntakeNotification = async ({
  refundCaseId,
  publicReference,
  customerEmail,
  machineLabel,
  locationName,
  status,
}: {
  refundCaseId: string;
  publicReference: string;
  customerEmail: string;
  machineLabel: string;
  locationName: string;
  status: string;
}) => {
  if (!supabase) return;

  try {
    const summaryText = buildManagerNotificationSummary({
      publicReference,
      machineLabel,
      locationName,
      status,
    });

    const notice = await sendRefundManagerActionNotice({
      supabase,
      refundCaseId,
      customerEmail,
      subject: `New Bloomjoy refund request ${publicReference}`,
      summaryText,
    });

    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: "manager_notification_sent",
      message: notice.usedOpsFallback
        ? "New refund request created an operations routing-exception notice because the complete current Machine Manager route could not be safely resolved."
        : "New refund request action notice sent only to the currently assigned Machine Managers.",
      metadata: {
        recipient_count: notice.recipientCount,
        machine_manager_recipient_count: notice.managerRecipientCount,
        manager_resolution_status: notice.resolutionStatus,
        used_ops_fallback: notice.usedOpsFallback,
        payload_redacted: true,
      },
    });
  } catch (notificationError) {
    console.error("refund-case-intake manager notification failed", {
      errorType: notificationError instanceof Error ? notificationError.name : typeof notificationError,
    });

    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: "manager_notification_failed",
      message: "New refund request notification could not be sent. Customer submission was not blocked.",
      metadata: {
        error_type: notificationError instanceof Error ? notificationError.name : typeof notificationError,
        payload_redacted: true,
      },
    });
  }
};

const prepareAttachments = (
  attachments: RefundAttachmentInput[],
): PreparedRefundAttachment[] => {
  if (attachments.length > maxAttachments) {
    throw new RequestValidationError("Please upload no more than 3 photos.");
  }

  return attachments.map((attachment) => {
    const contentType = sanitizeText(attachment.contentType, 100).toLowerCase();
    const fileName = safeFileName(sanitizeText(attachment.fileName, 160));
    const base64 = typeof attachment.base64 === "string" ? attachment.base64.trim() : "";
    const declaredByteSize = Number(attachment.byteSize ?? 0);

    if (!allowedContentTypes.has(contentType) || !base64) {
      throw new RequestValidationError("Attachments must be PNG, JPEG, or WebP images.");
    }

    if (base64.length > maxAttachmentBytes * 2) {
      throw new RequestValidationError("Each attachment must be 5MB or smaller.");
    }

    const bytes = decodeBase64(base64);
    if (bytes.byteLength <= 0 || bytes.byteLength > maxAttachmentBytes) {
      throw new RequestValidationError("Each attachment must be 5MB or smaller.");
    }

    if (declaredByteSize > 0 && Math.abs(declaredByteSize - bytes.byteLength) > 64) {
      throw new RequestValidationError("Attachment size did not match the submitted file.");
    }

    return { fileName, contentType, bytes };
  });
};

const cleanupPartialRefundCase = async (
  refundCaseId: string,
  storagePaths: string[],
) => {
  if (!supabase) return;

  try {
    if (storagePaths.length > 0) {
      await supabase.storage.from(attachmentBucket).remove(storagePaths);
    }

    await supabase.from("refund_cases").delete().eq("id", refundCaseId);
  } catch (cleanupError) {
    console.warn("refund-case-intake partial cleanup failed", {
      stage: "attachment_compensation",
      errorType: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
    });
  }
};

const uploadAttachments = async (
  refundCaseId: string,
  attachments: PreparedRefundAttachment[],
) => {
  if (!supabase || attachments.length === 0) return [];

  const uploaded = [];
  const uploadedStoragePaths: string[] = [];

  try {
    for (const [index, attachment] of attachments.entries()) {
      const storagePath =
        `refund-cases/${refundCaseId}/${index + 1}-${crypto.randomUUID()}-${attachment.fileName}`;
      const { error: uploadError } = await supabase.storage
        .from(attachmentBucket)
        .upload(storagePath, attachment.bytes, {
          contentType: attachment.contentType,
          upsert: false,
        });

      if (uploadError) {
        throw uploadError;
      }

      uploadedStoragePaths.push(storagePath);

      const { data, error: insertError } = await supabase
        .from("refund_case_attachments")
        .insert({
          refund_case_id: refundCaseId,
          storage_bucket: attachmentBucket,
          storage_path: storagePath,
          file_name: attachment.fileName,
          content_type: attachment.contentType,
          byte_size: attachment.bytes.byteLength,
        })
        .select("*")
        .single();

      if (insertError) {
        throw insertError;
      }

      uploaded.push(data);
    }
  } catch (error) {
    await cleanupPartialRefundCase(refundCaseId, uploadedStoragePaths);
    throw error;
  }

  return uploaded;
};

const refundQrUnavailableResponse = () =>
  new Response(
    JSON.stringify({
      error:
        "This machine's refund code is no longer available. Please use the regular refund form.",
      errorCode: "refund_qr_unavailable",
    }),
    {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );

const startRefundQrClaim = async (
  req: Request,
  body: Record<string, unknown>,
) => {
  if (!supabase) {
    throw new Error("Refund intake is not configured.");
  }

  const qrCode = sanitizeText(body.qrCode, 80);
  if (!isRefundQrOpaqueToken(qrCode)) {
    return refundQrUnavailableResponse();
  }

  const sourcePage = sanitizePublicIntakeSourcePage(
    "/refunds/request?qr=present",
  );
  const keyHashes = await buildPublicIntakeKeyHashes({
    salt: getAbuseControlSalt(),
    ip: getPublicIntakeClientIp(req),
    email: "refund-qr-claim",
    sourcePage,
  });
  const claimLimitResult = await checkPublicIntakeRateLimits({
    supabase: supabase as unknown as PublicIntakeAbuseSupabaseClient,
    keyHashes,
    rules: PUBLIC_REFUND_QR_CLAIM_LIMITS,
  });

  if (!claimLimitResult.allowed) {
    console.warn("Public refund QR claim throttled.", claimLimitResult.reason);
    return new Response(
      JSON.stringify({
        error: "Too many attempts. Please wait and scan the refund code again.",
        errorCode: "refund_qr_rate_limited",
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { data: qrCodeRow, error: qrCodeError } = await supabase
    .from("refund_machine_qr_codes")
    .select("id, reporting_machine_id")
    .eq("public_code", qrCode)
    .eq("status", "active")
    .maybeSingle();

  if (qrCodeError) {
    throw qrCodeError;
  }

  if (!qrCodeRow) {
    return refundQrUnavailableResponse();
  }

  const { data: qrMachineIsPublic, error: qrMachineEligibilityError } = await supabase.rpc(
    "service_refund_machine_is_public",
    { p_machine_id: qrCodeRow.reporting_machine_id },
  );
  if (qrMachineEligibilityError || qrMachineIsPublic !== true) {
    return refundQrUnavailableResponse();
  }

  const { data: machine, error: machineError } = await supabase
    .from("reporting_machines")
    .select(
      "id, machine_label, machine_type, location_id, refund_public_display_label, reporting_locations(id, name, timezone, status)",
    )
    .eq("id", qrCodeRow.reporting_machine_id)
    .eq("status", "active")
    .single();

  if (machineError || !machine) {
    return refundQrUnavailableResponse();
  }

  const machineRecord = machine as unknown as {
    id: string;
    machine_label: string;
    machine_type: string;
    location_id: string;
    refund_public_display_label: string | null;
    reporting_locations?:
      | { id: string; name: string; timezone: string; status: string }
      | { id: string; name: string; timezone: string; status: string }[]
      | null;
  };
  const locationRecord = Array.isArray(machineRecord.reporting_locations)
    ? machineRecord.reporting_locations[0] ?? null
    : machineRecord.reporting_locations ?? null;

  if (locationRecord?.status !== "active") {
    return refundQrUnavailableResponse();
  }

  if (
    (!locationRecord.name || isPlaceholderRefundLocation(locationRecord.name)) &&
    !machineRecord.refund_public_display_label?.trim()
  ) {
    return refundQrUnavailableResponse();
  }

  const publicLabels = resolveRefundPublicLabels({
    locationName: locationRecord.name,
    publicMachineLabel: machineRecord.refund_public_display_label,
    machineLabel: machineRecord.machine_label,
  });

  let claimToken = "";
  let insertedClaim:
    | { id: string; opened_at: string; expires_at: string }
    | null = null;

  for (let attempt = 0; attempt < 2 && !insertedClaim; attempt += 1) {
    claimToken = createRefundQrClaimToken();
    const claimTokenHash = await hashRefundQrClaimToken(claimToken);
    const { data, error } = await supabase
      .from("refund_qr_claim_contexts")
      .insert({
        qr_code_id: qrCodeRow.id,
        reporting_machine_id: machineRecord.id,
        claim_token_hash: claimTokenHash,
      })
      .select("id, opened_at, expires_at")
      .single();

    if (!error && data) {
      insertedClaim = data;
      break;
    }

    if (error?.code !== "23505") {
      throw error ?? new Error("Unable to start refund QR claim.");
    }
  }

  if (!insertedClaim || !claimToken) {
    throw new Error("Unable to start refund QR claim.");
  }

  return new Response(
    JSON.stringify({
      qrClaim: {
        claimToken,
        openedAt: insertedClaim.opened_at,
        expiresAt: insertedClaim.expires_at,
        ttlMinutes: REFUND_QR_CLAIM_TTL_MINUTES,
        machine: {
          machineId: machineRecord.id,
          machineLabel: publicLabels.machineLabel,
          locationId: machineRecord.location_id,
          locationName: publicLabels.locationName,
          locationTimezone: locationRecord.timezone,
        },
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
};

const resolveRefundQrClaim = async (
  claimToken: string,
): Promise<VerifiedRefundQrClaim | null> => {
  if (!supabase || !isRefundQrOpaqueToken(claimToken)) {
    return null;
  }

  const claimTokenHash = await hashRefundQrClaimToken(claimToken);
  const { data: claim, error: claimError } = await supabase
    .from("refund_qr_claim_contexts")
    .select(
      "id, qr_code_id, reporting_machine_id, opened_at, expires_at, consumed_at",
    )
    .eq("claim_token_hash", claimTokenHash)
    .maybeSingle();

  if (claimError) {
    throw claimError;
  }

  if (!claim || Date.parse(claim.expires_at) <= Date.now()) {
    return null;
  }

  const { data: qrCode, error: qrCodeError } = await supabase
    .from("refund_machine_qr_codes")
    .select("status")
    .eq("id", claim.qr_code_id)
    .maybeSingle();

  if (qrCodeError) {
    throw qrCodeError;
  }

  if (qrCode?.status !== "active") {
    return null;
  }

  return {
    id: claim.id,
    reportingMachineId: claim.reporting_machine_id,
    openedAt: claim.opened_at,
    expiresAt: claim.expires_at,
  };
};

const walletCorrectionUnavailableResponse = (
  state = "invalid",
  status = 410,
) =>
  new Response(
    JSON.stringify({
      error:
        "This secure wallet-detail link is invalid, expired, or has already been used.",
      errorCode: "refund_wallet_correction_unavailable",
      state,
    }),
    {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );

const checkWalletCorrectionRateLimit = async (req: Request) => {
  if (!supabase) return false;
  const sourcePage = sanitizePublicIntakeSourcePage(
    "/refunds/correct-wallet",
  );
  const keyHashes = await buildPublicIntakeKeyHashes({
    salt: getAbuseControlSalt(),
    ip: getPublicIntakeClientIp(req),
    email: "refund-wallet-correction",
    sourcePage,
  });
  const result = await checkPublicIntakeRateLimits({
    supabase: supabase as unknown as PublicIntakeAbuseSupabaseClient,
    keyHashes,
    rules: PUBLIC_REFUND_WALLET_CORRECTION_LIMITS,
  });

  return result.allowed;
};

const getWalletCorrectionContext = async (
  token: string,
): Promise<RefundWalletCorrectionContext | null> => {
  if (!supabase || !isRefundWalletCorrectionToken(token)) return null;
  const tokenHash = await hashRefundWalletCorrectionToken(token);
  const { data, error } = await supabase.rpc(
    "service_get_refund_wallet_correction",
    { p_token_hash: tokenHash },
  );
  if (error) throw error;
  return data as RefundWalletCorrectionContext | null;
};

const inspectWalletCorrection = async (
  req: Request,
  body: Record<string, unknown>,
) => {
  if (!supabase) throw new Error("Refund intake is not configured.");
  if (
    Object.keys(body).some((key) => !["action", "token"].includes(key))
  ) {
    return walletCorrectionUnavailableResponse();
  }

  const token = sanitizeText(body.token, 80);
  if (!isRefundWalletCorrectionToken(token)) {
    return walletCorrectionUnavailableResponse();
  }

  if (!(await checkWalletCorrectionRateLimit(req))) {
    return new Response(
      JSON.stringify({
        error: "Too many attempts. Please wait and try the secure link again.",
        errorCode: "refund_wallet_correction_rate_limited",
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const correction = await getWalletCorrectionContext(token);
  if (!correction || correction.state !== "ready") {
    return walletCorrectionUnavailableResponse(correction?.state);
  }

  return new Response(JSON.stringify({ correction }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
};

const sendWalletMatchReadyNotification = async ({
  refundCaseId,
  publicReference,
  customerEmail,
  machineLabel,
  locationName,
  confidenceClass,
}: {
  refundCaseId: string;
  publicReference: string;
  customerEmail: string;
  machineLabel: string;
  locationName: string;
  confidenceClass: string;
}) => {
  if (!supabase) return;
  const notice = await sendRefundManagerActionNotice({
    supabase,
    refundCaseId,
    customerEmail,
    subject: `Refund transaction ready for approval: ${publicReference}`,
    summaryText: [
      "Bloomjoy automatically re-checked corrected mobile-wallet details and found one high-confidence transaction.",
      "",
      `Reference: ${publicReference}`,
      `Machine: ${machineLabel}`,
      `Location: ${locationName}`,
    ].join("\n"),
  });

  await supabase.from("refund_case_events").insert({
    refund_case_id: refundCaseId,
    event_type: "wallet_correction_match_ready_notification_sent",
    message: notice.usedOpsFallback
      ? "High-confidence wallet correction match created an operations routing-exception notice because the complete current Machine Manager route could not be safely resolved."
      : "High-confidence wallet correction action notice sent only to the currently assigned Machine Managers.",
    metadata: {
      recipient_count: notice.recipientCount,
      machine_manager_recipient_count: notice.managerRecipientCount,
      manager_resolution_status: notice.resolutionStatus,
      used_ops_fallback: notice.usedOpsFallback,
      confidence_class: confidenceClass,
      payload_redacted: true,
    },
  });
};

const persistWalletCorrectionLookup = async (
  refundCaseId: string,
  result: NayaxLookupResult,
  expectedFactVersion: number,
  lookupGeneration: number,
) => {
  if (!supabase) throw new Error("Refund intake is not configured.");

  await persistNayaxLookupResult({
    supabase,
    caseId: refundCaseId,
    actorUserId: null,
    result,
    trigger: "wallet_correction",
    expectedFactVersion,
    lookupGeneration,
  });

  if (!result.configured) {
    const { error } = await supabase.from("refund_cases")
      .update({ automation_state: "under_review" })
      .eq("id", refundCaseId)
      .eq("nayax_lookup_generation", lookupGeneration);
    if (error) throw error;
    return "still_reviewing" as const;
  }

  if (result.recommendationState === "high_confidence") {
    const { error } = await supabase.from("refund_cases").update({
      automation_state: "under_review",
      wallet_correction_state: "received",
    }).eq("id", refundCaseId)
      .eq("nayax_lookup_generation", lookupGeneration);
    if (error) throw error;

    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: "wallet_correction_auto_match_ready",
      message:
        "Corrected wallet details produced one high-confidence Nayax recommendation for manager selection and confirmation.",
      metadata: {
        lookup_generation: lookupGeneration,
        recommendation_state: result.recommendationState,
        confidence_class: result.confidenceClass,
        reason_codes: result.reasonCodes,
        policy_version: result.policyVersion,
        candidate_count: result.candidates.length,
        provider_payload_redacted: true,
        payload_redacted: true,
      },
    });
    return "match_ready" as const;
  }

  const { error } = await supabase.from("refund_cases").update({
    status: "needs_review",
    correlation_status:
      result.recommendationState === "ambiguous"
        ? "multiple_candidates"
        : result.recommendationState === "no_safe_match"
        ? "no_match"
        : "manual_review",
    correlation_source: "nayax",
    correlation_confidence: 0,
    correlation_summary: result.summary,
    automation_state: "fallback_eligible",
    wallet_correction_state: "fallback_eligible",
    nayax_recommendation_state: result.recommendationState,
    nayax_recommendation_policy_version: result.policyVersion,
    nayax_recommendation_evaluated_at: result.lastCheckedAt,
    nayax_match_execution_eligible: false,
  }).eq("id", refundCaseId)
    .eq("nayax_lookup_generation", lookupGeneration);
  if (error) throw error;

  await supabase.from("refund_case_events").insert({
    refund_case_id: refundCaseId,
    event_type: "wallet_correction_fallback_eligible",
    message:
      "Corrected wallet details did not produce one high-confidence transaction; the case is eligible for the approved fallback route.",
    metadata: {
      recommendation_state: result.recommendationState,
      confidence_class: result.confidenceClass,
      reason_codes: result.reasonCodes,
      policy_version: result.policyVersion,
      candidate_count: result.candidates.length,
      fallback_method: "tbd",
      payload_redacted: true,
    },
  });
  return "fallback_eligible" as const;
};

const submitWalletCorrection = async (
  req: Request,
  body: Record<string, unknown>,
) => {
  if (!supabase) throw new Error("Refund intake is not configured.");
  const allowedKeys = new Set([
    "action",
    "token",
    "walletType",
    "cardNetwork",
    "cardLast4",
    "incidentDate",
    "incidentTime",
    "amountConfirmed",
  ]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    return new Response(
      JSON.stringify({
        error:
          "Submit only the requested wallet last four, purchase time, and amount confirmation.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const token = sanitizeText(body.token, 80);
  const walletType = sanitizeText(body.walletType, 40).toLowerCase();
  const cardNetwork = normalizeCardNetwork(body.cardNetwork);
  const cardLast4 = sanitizeText(body.cardLast4, 4);
  const incidentDate = sanitizeText(body.incidentDate, 10);
  const incidentTime = sanitizeText(body.incidentTime, 8);
  if (
    !isRefundWalletCorrectionToken(token) ||
    !["apple_pay", "google_pay", "other_wallet"].includes(walletType) ||
    !cardNetwork ||
    !/^[0-9]{4}$/.test(cardLast4) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) ||
    !/^\d{2}:\d{2}$/.test(incidentTime) ||
    body.amountConfirmed !== true
  ) {
    return new Response(
      JSON.stringify({
        error:
          "Enter the mobile wallet used, card type, virtual card last four, approximate purchase time, and confirm the amount.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (!(await checkWalletCorrectionRateLimit(req))) {
    return new Response(
      JSON.stringify({
        error: "Too many attempts. Please wait and try the secure link again.",
        errorCode: "refund_wallet_correction_rate_limited",
      }),
      {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const correction = await getWalletCorrectionContext(token);
  if (
    !correction ||
    correction.state !== "ready" ||
    !sanitizeText(correction.locationTimezone, 80)
  ) {
    return walletCorrectionUnavailableResponse(correction?.state);
  }

  const incidentResolution = resolveLocalDateTimeInZone({
    localDate: incidentDate,
    localTime: incidentTime,
    timeZone: correction.locationTimezone,
  });
  if (!incidentResolution.instant || incidentResolution.resolution !== "exact") {
    return new Response(
      JSON.stringify({
        error:
          "That local time is not exact because of a clock change. Choose the nearest valid time.",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const tokenHash = await hashRefundWalletCorrectionToken(token);
  const { data: applied, error: applyError } = await supabase.rpc(
    "service_apply_refund_wallet_correction_v2",
    {
      p_token_hash: tokenHash,
      p_wallet_type: walletType,
      p_card_network: cardNetwork,
      p_card_last4: cardLast4,
      p_incident_at: incidentResolution.instant,
      p_incident_local_datetime: `${incidentDate}T${incidentTime}`,
      p_amount_confirmed: true,
    },
  );
  if (applyError) {
    return walletCorrectionUnavailableResponse();
  }

  const refundCaseId = sanitizeText(applied?.refundCaseId, 80);
  const publicReference = sanitizeText(applied?.publicReference, 80);
  let resolution:
    | "match_ready"
    | "fallback_eligible"
    | "still_reviewing" = "still_reviewing";
  let lookupResult: NayaxLookupResult | null = null;
  let expectedFactVersion: number | null = null;
  let lookupGeneration: number | null = null;
  try {
    const { data: lookupCase, error: lookupCaseError } = await supabase
      .from("refund_cases")
      .select("deterministic_fact_version")
      .eq("id", refundCaseId)
      .single();
    if (lookupCaseError) throw lookupCaseError;
    expectedFactVersion = Number(lookupCase.deterministic_fact_version);
    if (!Number.isInteger(expectedFactVersion)) {
      throw new Error("Refund case matching evidence version is unavailable.");
    }
    lookupGeneration = await beginNayaxLookup({
      supabase,
      caseId: refundCaseId,
      actorUserId: null,
      expectedFactVersion,
      trigger: "wallet_correction",
    });
    lookupResult = await lookupNayaxCandidatesForRefundCase({
      supabase,
      caseId: refundCaseId,
      actorUserId: null,
      lookupGeneration,
      expectedFactVersion,
    });
    resolution = await persistWalletCorrectionLookup(
      refundCaseId,
      lookupResult,
      expectedFactVersion,
      lookupGeneration,
    );
  } catch (lookupError) {
    console.error("refund wallet correction automatic lookup failed", {
      errorType:
        lookupError instanceof Error ? lookupError.name : typeof lookupError,
    });
    if (expectedFactVersion !== null && lookupGeneration !== null) {
      try {
        await failNayaxLookup({
          supabase,
          caseId: refundCaseId,
          actorUserId: null,
          expectedFactVersion,
          lookupGeneration,
          trigger: "wallet_correction",
          error: lookupError,
        });
      } catch (failureRecordingError) {
        console.error("wallet correction lookup failure state could not be recorded", {
          errorType: failureRecordingError instanceof Error
            ? failureRecordingError.name
            : typeof failureRecordingError,
        });
      }
    }
  }

  if (
    resolution === "match_ready" &&
    lookupResult?.refundCase
  ) {
    try {
      const { data: caseContext } = await supabase
        .from("refund_cases")
        .select("customer_email")
        .eq("id", refundCaseId)
        .single();
      await sendWalletMatchReadyNotification({
        refundCaseId,
        publicReference,
        customerEmail: sanitizeEmail(caseContext?.customer_email),
        machineLabel: lookupResult.refundCase.machineLabel ?? "Bloomjoy machine",
        locationName: lookupResult.refundCase.locationName ?? "Bloomjoy location",
        confidenceClass: lookupResult.confidenceClass,
      });
    } catch (notificationError) {
      console.error("wallet correction manager notification failed", {
        errorType:
          notificationError instanceof Error
            ? notificationError.name
            : typeof notificationError,
      });
      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCaseId,
        event_type: "wallet_correction_match_ready_notification_failed",
        message:
          "The high-confidence transaction is ready, but its manager notification needs a retry.",
        metadata: { payload_redacted: true },
      });
    }
  }

  return new Response(
    JSON.stringify({
      result: {
        publicReference,
        resolution,
      },
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed." }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!supabase) {
      return new Response(JSON.stringify({ error: "Refund intake is not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return new Response(JSON.stringify({ error: parsedBody.error }), {
        status: parsedBody.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = parsedBody.body;
    const action = sanitizeText(body?.action, 40);
    if (action === "startQrClaim") {
      return await startRefundQrClaim(req, body);
    }
    if (action === "inspectWalletCorrection") {
      return await inspectWalletCorrection(req, body);
    }
    if (action === "inspectPurchaseCorrection" || action === "submitPurchaseCorrection") {
      if (!(await checkWalletCorrectionRateLimit(req))) {
        return new Response(JSON.stringify({ errorCode: "correction_rate_limited" }), {
          status: 429, headers: { ...refundStatusResponseHeaders },
        });
      }
      return await handlePurchaseCorrection(body, supabase);
    }
    if (action === "submitWalletCorrection") {
      return await submitWalletCorrection(req, body);
    }
    if (action === "readStatus") {
      return await readCustomerRefundStatus(req, body);
    }

    const customerRequestReceivedAt = new Date().toISOString();
    const sourcePage = sanitizePublicIntakeSourcePage("/refunds/request");
    const requestedMachineId = sanitizeText(body?.machineId, 80);
    const requestedSelectionKey = sanitizeText(body?.selectionKey, 80).toLowerCase();
    let machineId = requestedMachineId;
    let intakeSelectionKey: string | null = null;
    let intakeSelectionKind: "exact_machine" | "livermore_pair" | "machine_qr" | null = null;
    let intakeSelectionMachineIds: string[] | null = null;
    let intakeSelectionDisplayLabel = "";
    let intakeSelectionLocationId = "";
    let intakeSelectionLocationTimezone = "";
    const qrClaimToken = sanitizeText(body?.qrClaimToken, 80);
    const emailContextToken = sanitizeText(body?.emailContextToken, 80);
    const customerEmail = sanitizeEmail(body?.customerEmail);
    const customerName = sanitizeText(body?.customerName, 160);
    const customerPhone = sanitizeText(body?.customerPhone, 80);
    const issueSummary = sanitizeText(body?.issueSummary, 2500);
    const customerLocale = inferRefundCustomerLocale({
      explicitLocale: body?.customerLocale,
      acceptLanguage: req.headers.get("accept-language"),
      customerText: issueSummary,
    });
    const paymentMethod = sanitizeText(body?.paymentMethod, 40).toLowerCase();
    const amountCents = centsFromAmount(body?.paymentAmount);
    const cardLast4 = sanitizeText(body?.cardLast4, 4);
    const submittedCardLast4Source = sanitizeText(body?.cardLast4Source, 40).toLowerCase();
    const cardLast4Source = ["physical_card", "wallet_device", "bank_record", "unknown"].includes(submittedCardLast4Source)
      ? submittedCardLast4Source
      : null;
    const submittedCardNetwork = sanitizeText(body?.cardNetwork, 80);
    const cardNetwork = normalizeCardNetwork(submittedCardNetwork);
    const submittedPaymentInteraction = sanitizeText(body?.paymentInteraction, 40).toLowerCase();
    const paymentInteraction = [
      "phone_watch_wallet",
      "tap_card",
      "insert_card",
      "swipe_card",
      "insert_or_swipe",
      "cash",
      "unsure",
    ].includes(submittedPaymentInteraction)
      ? submittedPaymentInteraction
      : paymentMethod === "cash"
      ? "cash"
      : body?.cardWalletUsed === true
      ? "phone_watch_wallet"
      : "unsure";
    const cardWalletUsed =
      paymentMethod === "card" &&
      (Boolean(body?.cardWalletUsed) || paymentInteraction === "phone_watch_wallet");
    const submittedWalletProvider = sanitizeText(body?.walletProvider, 40).toLowerCase();
    const walletProvider = paymentInteraction === "phone_watch_wallet" && [
      "apple_pay",
      "google_wallet",
      "other",
      "unsure",
    ].includes(submittedWalletProvider)
      ? submittedWalletProvider
      : null;
    const submittedWalletDeviceKind = sanitizeText(body?.walletDeviceKind, 40).toLowerCase();
    const walletDeviceKind = paymentInteraction === "phone_watch_wallet" && ["phone", "watch", "unknown"].includes(submittedWalletDeviceKind)
      ? submittedWalletDeviceKind
      : null;
    const submittedTimeConfidence = sanitizeText(body?.incidentTimeConfidence, 40).toLowerCase();
    const incidentTimeConfidence = [
      "exact",
      "within_15_minutes",
      "within_1_hour",
      "rough",
    ].includes(submittedTimeConfidence)
      ? submittedTimeConfidence
      : "rough";
    const submittedIncidentTimeSource = sanitizeText(body?.incidentTimeSource, 40).toLowerCase();
    const incidentTimeSource = ["transaction_alert_or_receipt", "memory", "unknown"].includes(submittedIncidentTimeSource)
      ? submittedIncidentTimeSource
      : null;
    const submittedIssueCategory = sanitizeText(body?.issueCategory, 60).toLowerCase();
    const issueCategory = [
      "charged_no_product",
      "product_problem",
      "charged_more_than_once",
      "wrong_amount",
      "other",
    ].includes(submittedIssueCategory)
      ? submittedIssueCategory
      : "other";
    const productDescription = sanitizeText(body?.productDescription, 160);
    const incidentDate = sanitizeText(body?.incidentDate, 10);
    const incidentTime = sanitizeText(body?.incidentTime, 8);
    const legacyIncidentAt = parseIncidentAt(body?.incidentAt);
    const hasLocalIncidentInput = Boolean(incidentDate && incidentTime);
    if (body?.attachments !== undefined && !Array.isArray(body.attachments)) {
      throw new RequestValidationError("Attachments must be uploaded as a list.");
    }

    const rawAttachments = Array.isArray(body?.attachments)
      ? body.attachments as RefundAttachmentInput[]
      : [];
    if (rawAttachments.length > 0) {
      throw new RequestValidationError(
        "Photo uploads are temporarily unavailable. Please submit the request without attachments.",
      );
    }

    if (!refundEmailPilotAttachmentsEnabled && rawAttachments.length > 0) {
      throw new RequestValidationError(
        "Photo attachments are not available during the email refund pilot.",
      );
    }

    if (emailContextToken && !isRefundEmailContextToken(emailContextToken)) {
      throw new RequestValidationError(
        "This email refund link is not valid. Open the latest link from your Bloomjoy email or submit the form without it.",
      );
    }

    if (!qrClaimToken && !requestedSelectionKey && !isUuid(machineId)) {
      return new Response(JSON.stringify({ error: "Please choose a machine location." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (requestedSelectionKey && !/^[0-9a-f]{64}$/.test(requestedSelectionKey)) {
      return new Response(JSON.stringify({ error: "Please choose a machine location." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (qrClaimToken && !isRefundQrOpaqueToken(qrClaimToken)) {
      return refundQrUnavailableResponse();
    }

    if (!customerEmail || !isEmail(customerEmail)) {
      return new Response(JSON.stringify({ error: "Please enter a valid email address." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hasLocalIncidentInput && !legacyIncidentAt) {
      return new Response(JSON.stringify({ error: "Please enter the incident date and time." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const paymentValidation = validateRefundIntakePayment({
      paymentMethod,
      amountCents,
      cardLast4,
      cardNetwork,
      cardNetworkProvided: body?.cardNetwork !== undefined,
      paymentInteraction,
      submittedPaymentInteraction,
      paymentInteractionProvided: body?.paymentInteraction !== undefined,
      cardWalletUsed,
      walletProvider,
      walletProviderProvided: body?.walletProvider !== undefined,
    });
    if (!paymentValidation.ok) {
      return new Response(JSON.stringify({ error: paymentValidation.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      body?.incidentTimeConfidence !== undefined &&
      !["exact", "within_15_minutes", "within_1_hour", "rough"].includes(
        submittedTimeConfidence,
      )
    ) {
      return new Response(JSON.stringify({ error: "Please choose how closely you remember the purchase time." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body?.cardLast4Source !== undefined && !cardLast4Source) {
      return new Response(JSON.stringify({ error: "Please choose where you found the last four digits." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body?.walletDeviceKind !== undefined && !walletDeviceKind) {
      return new Response(JSON.stringify({ error: "Please choose whether you used a phone or watch." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (body?.incidentTimeSource !== undefined && !incidentTimeSource) {
      return new Response(JSON.stringify({ error: "Please choose how you found the purchase time." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      body?.issueCategory !== undefined &&
      !["charged_no_product", "product_problem", "charged_more_than_once", "wrong_amount", "other"].includes(
        submittedIssueCategory,
      )
    ) {
      return new Response(JSON.stringify({ error: "Please choose what best describes the problem." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const abuseControlSalt = getAbuseControlSalt();
    const abuseSupabase = supabase as unknown as PublicIntakeAbuseSupabaseClient;
    const keyHashes = await buildPublicIntakeKeyHashes({
      salt: abuseControlSalt,
      ip: getPublicIntakeClientIp(req),
      email: customerEmail,
      sourcePage,
    });
    const submissionLimitResult = await checkPublicIntakeRateLimits({
      supabase: abuseSupabase,
      keyHashes,
      rules: PUBLIC_INTAKE_SUBMISSION_LIMITS,
    });

    if (!submissionLimitResult.allowed) {
      console.warn("Public refund intake throttled.", submissionLimitResult.reason);
      return new Response(
        JSON.stringify({ error: "Too many submissions. Please wait and try again." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let verifiedQrClaim: VerifiedRefundQrClaim | null = null;
    if (qrClaimToken) {
      verifiedQrClaim = await resolveRefundQrClaim(qrClaimToken);
      if (!verifiedQrClaim) {
        return refundQrUnavailableResponse();
      }

      if (
        requestedMachineId &&
        requestedMachineId !== verifiedQrClaim.reportingMachineId
      ) {
        return refundQrUnavailableResponse();
      }

      machineId = verifiedQrClaim.reportingMachineId;
      intakeSelectionKind = "machine_qr";
      intakeSelectionMachineIds = [machineId];
    } else if (requestedSelectionKey) {
      const { data: resolvedSelection, error: selectionError } = await supabase.rpc(
        "service_resolve_refund_public_selection",
        { p_selection_key: requestedSelectionKey },
      );
      const selectionKind = sanitizeText(resolvedSelection?.selectionKind, 40);
      const selectionMachineIds = Array.isArray(resolvedSelection?.machineIds)
        ? resolvedSelection.machineIds.map((value: unknown) => sanitizeText(value, 80))
        : [];
      if (
        selectionError ||
        !["exact_machine", "livermore_pair"].includes(selectionKind) ||
        selectionMachineIds.some((value: string) => !isUuid(value)) ||
        (selectionKind === "exact_machine" && selectionMachineIds.length !== 1) ||
        (selectionKind === "livermore_pair" && selectionMachineIds.length !== 2)
      ) {
        return new Response(JSON.stringify({ error: "That location is temporarily unavailable. Please choose another location or email info@bloomjoysweets.com." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      intakeSelectionKey = requestedSelectionKey;
      intakeSelectionKind = selectionKind as "exact_machine" | "livermore_pair";
      intakeSelectionMachineIds = selectionMachineIds;
      intakeSelectionDisplayLabel = sanitizeText(resolvedSelection?.displayLabel, 180);
      intakeSelectionLocationId = sanitizeText(resolvedSelection?.locationId, 80);
      intakeSelectionLocationTimezone = sanitizeText(resolvedSelection?.locationTimezone, 80);
      machineId = selectionKind === "exact_machine" ? selectionMachineIds[0] : "";
    } else {
      // Compatibility for the previously deployed form while the new contract
      // is rolled out migration-first. It remains one exact public machine.
      intakeSelectionKind = "exact_machine";
      intakeSelectionMachineIds = [machineId];
    }

    const attachments = refundEmailPilotAttachmentsEnabled
      ? prepareAttachments(rawAttachments)
      : [];

    let machineRecord: {
      id: string | null;
      machine_label: string;
      machine_type: string;
      location_id: string;
      refund_public_display_label: string | null;
      reporting_locations?:
        | { id: string; name: string; timezone: string; status: string }
        | { id: string; name: string; timezone: string; status: string }[]
        | null;
    };
    if (intakeSelectionKind === "livermore_pair") {
      if (paymentMethod !== "card") {
        return new Response(JSON.stringify({ error: "This grouped location is available for card purchases. For other payment help, email info@bloomjoysweets.com." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data: groupedLocation, error: groupedLocationError } = await supabase
        .from("reporting_locations")
        .select("id, name, timezone, status")
        .eq("id", intakeSelectionLocationId)
        .eq("status", "active")
        .single();
      if (groupedLocationError || !groupedLocation || groupedLocation.timezone !== intakeSelectionLocationTimezone) {
        return new Response(JSON.stringify({ error: "That location is temporarily unavailable. Please email info@bloomjoysweets.com." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      machineRecord = {
        id: null,
        machine_label: intakeSelectionDisplayLabel,
        machine_type: "commercial",
        location_id: groupedLocation.id,
        refund_public_display_label: intakeSelectionDisplayLabel,
        reporting_locations: groupedLocation,
      };
    } else {
      const { data: machineIsPublic, error: machineEligibilityError } = await supabase.rpc(
        "service_refund_machine_is_public",
        { p_machine_id: machineId },
      );
      if (machineEligibilityError || machineIsPublic !== true) {
        return new Response(JSON.stringify({ error: "That machine is not available for refund intake." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: machine, error: machineError } = await supabase
        .from("reporting_machines")
        .select("id, machine_label, machine_type, location_id, refund_public_display_label, reporting_locations(id, name, timezone, status)")
        .eq("id", machineId)
        .eq("status", "active")
        .single();

      if (machineError || !machine) {
        return new Response(JSON.stringify({ error: "That machine is not available for refund intake." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      machineRecord = machine as unknown as typeof machineRecord;
    }
    const locationRecord = Array.isArray(machineRecord.reporting_locations)
      ? machineRecord.reporting_locations[0] ?? null
      : machineRecord.reporting_locations ?? null;
    if (locationRecord?.status !== "active") {
      return new Response(JSON.stringify({ error: "That location is not available for refund intake." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (
      (!locationRecord.name || isPlaceholderRefundLocation(locationRecord.name)) &&
      !machineRecord.refund_public_display_label?.trim()
    ) {
      return new Response(JSON.stringify({ error: "That location is not available for refund intake." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const publicLabels = resolveRefundPublicLabels({
      locationName: locationRecord?.name,
      publicMachineLabel: machineRecord.refund_public_display_label,
      machineLabel: machineRecord.machine_label,
    });

    const incidentResolution = hasLocalIncidentInput
      ? resolveLocalDateTimeInZone({
          localDate: incidentDate,
          localTime: incidentTime,
          timeZone: locationRecord?.timezone ?? "",
        })
      : {
          instant: legacyIncidentAt?.toISOString() ?? null,
          resolution: "legacy_absolute",
          possibleInstantCount: legacyIncidentAt ? 1 : 0,
        };
    const incidentAt = parseIncidentAt(incidentResolution.instant);
    if (!incidentAt) {
      return new Response(JSON.stringify({ error: "Please enter a valid incident date and time." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (incidentTimeIsMateriallyFuture({
      incidentAt: incidentAt.toISOString(),
      customerRequestReceivedAt,
    })) {
      return new Response(JSON.stringify({
        error: "The purchase time cannot be after this refund request. Check the date, time, and location, then try again.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let status = "submitted";
    let correlationStatus = "not_started";
    let correlationSource: string | null = null;
    let correlationConfidence = 0;
    let correlationSummary = "";
    let matchedSalesFactId: string | null = null;
    const candidateIds: string[] = [];

    if (paymentMethod === "card") {
      status = "needs_review";
      correlationStatus = "needs_nayax";
      correlationSummary = "Card payment requires manager review through Nayax Lynx lookup.";
    } else if (paymentMethod === "cash") {
      const windowStart = new Date(incidentAt.getTime() - 60 * 60 * 1000);
      const windowEnd = new Date(incidentAt.getTime() + 60 * 60 * 1000);
      let query = supabase
        .from("machine_sales_facts")
        .select("id, net_sales_cents, payment_time, source_trade_name")
        .eq("reporting_machine_id", machineRecord.id as string)
        .eq("payment_method", "cash")
        .gte("payment_time", windowStart.toISOString())
        .lte("payment_time", windowEnd.toISOString())
        .order("payment_time", { ascending: true })
        .limit(4);

      if (amountCents !== null && amountCents > 0) {
        query = query.eq("net_sales_cents", amountCents);
      }

      const { data: candidates, error: candidateError } = await query;
      if (candidateError) {
        throw candidateError;
      }

      for (const candidate of candidates ?? []) {
        if (candidate?.id) candidateIds.push(String(candidate.id));
      }

      if (candidateIds.length === 1) {
        status = "correlated";
        correlationStatus = "matched";
        correlationSource = "sunze";
        correlationConfidence = amountCents !== null && amountCents > 0 ? 0.96 : 0.82;
        matchedSalesFactId = candidateIds[0];
        correlationSummary = amountCents !== null && amountCents > 0
          ? "Matched one cash Sunze sales fact for this machine within +/- 1 hour and exact amount."
          : "Matched one cash Sunze sales fact for this machine within +/- 1 hour.";
      } else if (candidateIds.length > 1) {
        status = "needs_review";
        correlationStatus = "multiple_candidates";
        correlationSource = "sunze";
        correlationConfidence = 0.4;
        correlationSummary = "Multiple cash Sunze candidates were found in the conservative time window.";
      } else {
        status = "needs_review";
        correlationStatus = "no_match";
        correlationSource = "sunze";
        correlationSummary = "No cash Sunze sales fact matched this machine within +/- 1 hour.";
      }
    }

    const serverDedupeWindowStartedAt = getPublicIntakeWindowStart(
      new Date(),
      PUBLIC_INTAKE_DEDUPE_WINDOW_SECONDS,
    );
    const serverDedupeKey = await buildPublicIntakeDedupeKey({
      salt: abuseControlSalt,
      submissionType: "refund_case",
      email: customerEmail,
      sourcePage,
      message: [
        intakeSelectionKey ?? machineRecord.id,
        incidentAt.toISOString(),
        paymentMethod,
        amountCents ?? "amount-not-provided",
        paymentMethod === "card" ? cardLast4 : "no-card-last4",
        paymentInteraction,
        cardLast4Source ?? "source-not-provided",
        walletDeviceKind ?? "device-not-provided",
        incidentTimeConfidence,
        incidentTimeSource ?? "time-source-not-provided",
        issueCategory,
        productDescription,
        issueSummary,
      ].join("|"),
      windowStartedAt: serverDedupeWindowStartedAt,
    });
    const selectedRefundCaseColumns =
      "id, public_reference, status, correlation_status";
    const intakeMeta = {
      source: "hosted_refund_intake",
      intake_path: verifiedQrClaim ? "machine_qr" : "direct_form",
      qr_claim_present: Boolean(verifiedQrClaim),
      qr_claim_opened_at: verifiedQrClaim?.openedAt ?? null,
      qr_claim_expires_at: verifiedQrClaim?.expiresAt ?? null,
      incident_time_resolution: incidentResolution.resolution,
      incident_time_confidence: incidentTimeConfidence,
      incident_time_source: incidentTimeSource,
      payment_interaction: paymentValidation.paymentInteraction,
      card_last4_source: cardLast4Source,
      wallet_provider_supplied: Boolean(paymentValidation.walletProvider),
      wallet_device_kind: walletDeviceKind,
      card_network: paymentValidation.cardNetwork,
      issue_category: issueCategory,
      product_description_supplied: Boolean(productDescription),
      incident_possible_instant_count: incidentResolution.possibleInstantCount,
      candidate_sales_fact_ids: candidateIds,
      customer_locale: customerLocale,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    };
    const insertValues = {
      reporting_machine_id: machineRecord.id,
      reporting_location_id: machineRecord.location_id,
      intake_selection_key: intakeSelectionKey,
      intake_selection_kind: intakeSelectionKind,
      intake_selection_machine_ids: intakeSelectionMachineIds,
      customer_email: customerEmail,
      customer_name: customerName || null,
      customer_phone: customerPhone || null,
      zelle_payment_contact: null,
      issue_summary: issueSummary,
      incident_at: incidentAt.toISOString(),
      incident_local_datetime: hasLocalIncidentInput ? `${incidentDate}T${incidentTime}` : null,
      incident_timezone: locationRecord?.timezone ?? null,
      incident_time_resolution: incidentResolution.resolution,
      payment_method: paymentValidation.paymentMethod,
      payment_amount_cents: paymentValidation.amountCents,
      card_last4: paymentValidation.cardLast4,
      card_last4_source: paymentValidation.paymentMethod === "card" ? cardLast4Source : null,
      card_last4_provenance: paymentValidation.paymentMethod === "card" &&
          paymentValidation.cardLast4
        ? cardLast4Source === "physical_card"
          ? "physical_card"
          : cardLast4Source === "wallet_device" && paymentValidation.cardWalletUsed
          ? "wallet_device_token"
          : cardLast4Source
          ? null
          : paymentValidation.cardWalletUsed
          ? "wallet_device_token"
          : "physical_card"
        : null,
      card_network: paymentValidation.cardNetwork,
      card_wallet_used: paymentValidation.cardWalletUsed,
      payment_interaction: paymentValidation.paymentInteraction,
      wallet_provider: paymentValidation.walletProvider,
      wallet_device_kind: paymentValidation.paymentMethod === "card" ? walletDeviceKind : null,
      incident_time_confidence: incidentTimeConfidence,
      incident_time_source: incidentTimeSource,
      nearby_attempt_count: null,
      issue_category: issueCategory,
      product_description: productDescription || null,
      status,
      correlation_status: correlationStatus,
      correlation_source: correlationSource,
      correlation_confidence: correlationConfidence,
      correlation_summary: correlationSummary,
      matched_sales_fact_id: matchedSalesFactId,
      cash_match_evaluated_fact_version: paymentValidation.paymentMethod === "cash" ? 1 : null,
      refund_amount_cents: paymentValidation.amountCents,
      refund_qr_claim_context_id: verifiedQrClaim?.id ?? null,
      customer_request_received_at: customerRequestReceivedAt,
      customer_request_received_source: "hosted_refund_intake",
      intake_meta: intakeMeta,
      server_dedupe_key: serverDedupeKey,
      server_dedupe_window_started_at: serverDedupeWindowStartedAt.toISOString(),
    };

    let refundCase: SubmittedRefundCase | null = null;
    let linkedGmailThreadId: string | null = null;
    if (emailContextToken) {
      const { data: linkedRefundCase, error: linkError } = await supabase.rpc(
        "service_create_refund_case_from_gmail_contact_form",
        {
          p_token_hash: await hashRefundEmailContextToken(emailContextToken),
          p_customer_email: customerEmail,
          p_case_values: {
            reportingMachineId: insertValues.reporting_machine_id,
            reportingLocationId: insertValues.reporting_location_id,
            intakeSelectionKey: insertValues.intake_selection_key,
            intakeSelectionKind: insertValues.intake_selection_kind,
            intakeSelectionMachineIds: insertValues.intake_selection_machine_ids,
            customerName: insertValues.customer_name,
            customerPhone: insertValues.customer_phone,
            zellePaymentContact: insertValues.zelle_payment_contact,
            issueSummary: insertValues.issue_summary,
            incidentAt: insertValues.incident_at,
            incidentLocalDateTime: insertValues.incident_local_datetime,
            incidentTimezone: insertValues.incident_timezone,
            incidentTimeResolution: insertValues.incident_time_resolution,
            paymentMethod: insertValues.payment_method,
            paymentAmountCents: insertValues.payment_amount_cents,
            cardLast4: insertValues.card_last4,
            cardLast4Source: insertValues.card_last4_source,
            cardNetwork: insertValues.card_network,
            cardWalletUsed: insertValues.card_wallet_used,
            paymentInteraction: insertValues.payment_interaction,
            walletProvider: insertValues.wallet_provider,
            walletDeviceKind: insertValues.wallet_device_kind,
            incidentTimeConfidence: insertValues.incident_time_confidence,
            incidentTimeSource: insertValues.incident_time_source,
            nearbyAttemptCount: insertValues.nearby_attempt_count,
            issueCategory: insertValues.issue_category,
            productDescription: insertValues.product_description,
            status: insertValues.status,
            correlationStatus: insertValues.correlation_status,
            correlationSource: insertValues.correlation_source,
            correlationConfidence: insertValues.correlation_confidence,
            correlationSummary: insertValues.correlation_summary,
            matchedSalesFactId: insertValues.matched_sales_fact_id,
            intakeMeta,
            serverDedupeKey,
            serverDedupeWindowStartedAt:
              serverDedupeWindowStartedAt.toISOString(),
          },
        },
      );
      if (linkError) {
        throw new RefundEmailContextUnavailableError();
      }
      const linkedCase = requireLinkedRefundEmailCase(
        emailContextToken,
        linkedRefundCase as SubmittedRefundCase | null,
      );
      if (!linkedCase) throw new RefundEmailContextUnavailableError();
      linkedGmailThreadId = requireLinkedRefundEmailThreadId(
        emailContextToken,
        linkedCase,
      );
      refundCase = linkedCase;
    }

    if (!refundCase) {
      const { data: insertedRefundCase, error: insertError } = await supabase
        .from("refund_cases")
        .insert(insertValues)
        .select(selectedRefundCaseColumns)
        .single();

      if (insertError) {
        if (insertError.code !== "23505") {
          if (verifiedQrClaim && insertError.code === "23514") {
            return refundQrUnavailableResponse();
          }
          throw new Error(insertError.message || "Unable to create refund case.");
        }

        const { data: dedupedRefundCase, error: dedupeLookupError } = await supabase
          .from("refund_cases")
          .select(selectedRefundCaseColumns)
          .eq("server_dedupe_key", serverDedupeKey)
          .maybeSingle();

        if (dedupeLookupError || !dedupedRefundCase) {
          if (verifiedQrClaim) {
            return new Response(
              JSON.stringify({
                error:
                  "This QR session has already been used. Scan the code again or use the regular refund form.",
                errorCode: "refund_qr_claim_used",
              }),
              {
                status: 409,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
              },
            );
          }
          throw new Error("Unable to create refund case.");
        }

        if (paymentValidation.shouldRunNayaxLookup) {
          await runAutomaticNayaxLookupIfReady({
            supabase,
            caseId: dedupedRefundCase.id,
            source: "hosted_intake",
          }).catch((lookupError) => {
            console.error("refund intake automatic Nayax trigger failed", {
              errorType: lookupError instanceof Error ? lookupError.name : typeof lookupError,
            });
          });
        }
        const statusCapability = await issueStatusCapability(dedupedRefundCase.id);
        return new Response(
          JSON.stringify({
            refundCase: {
              id: dedupedRefundCase.id,
              publicReference: dedupedRefundCase.public_reference,
              status: dedupedRefundCase.status,
              correlationStatus: dedupedRefundCase.correlation_status,
            },
            statusToken: statusCapability?.token ?? null,
            statusExpiresAt: statusCapability?.expiresAt ?? null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      refundCase = insertedRefundCase as SubmittedRefundCase | null;
    }

    if (!refundCase) {
      throw new Error("Unable to create refund case.");
    }

    let uploadedAttachments: unknown[] = [];
    if (attachments.length > 0) {
      uploadedAttachments = await uploadAttachments(refundCase.id, attachments);
    }

    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCase.id,
      event_type: "customer_submitted",
      message: "Customer submitted hosted refund intake.",
      metadata: {
        status,
        correlation_status: correlationStatus,
        intake_path: verifiedQrClaim ? "machine_qr" : "direct_form",
        qr_claim_present: Boolean(verifiedQrClaim),
        incident_time_confidence: incidentTimeConfidence,
        payment_interaction: paymentValidation.paymentInteraction,
        issue_category: issueCategory,
        candidate_sales_fact_ids: candidateIds,
        attachment_count: uploadedAttachments.length,
      },
    });

    if (paymentValidation.shouldRunNayaxLookup) {
      await runAutomaticNayaxLookupIfReady({
        supabase,
        caseId: refundCase.id,
        source: emailContextToken ? "linked_customer_update" : "hosted_intake",
      }).catch((lookupError) => {
        console.error("refund intake automatic Nayax trigger failed", {
          errorType: lookupError instanceof Error ? lookupError.name : typeof lookupError,
        });
      });
    }

    await sendManagerIntakeNotification({
      refundCaseId: refundCase.id,
      publicReference: refundCase.public_reference,
      customerEmail,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      status,
    });

    const statusCapability = await issueStatusCapability(refundCase.id);

    const email = buildRefundCustomerEmail({
      messageType: "confirmation",
      publicReference: refundCase.public_reference,
      customerName,
      customerEmail,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      refundAmountCents: paymentValidation.amountCents,
      paymentMethod: paymentValidation.paymentMethod,
      cardWalletUsed: paymentValidation.cardWalletUsed,
      incidentLocalDateTime: hasLocalIncidentInput ? `${incidentDate} ${incidentTime}` : null,
      statusUrl: statusCapability?.url ?? null,
      customerLocale,
    });

    const { data: messageRow } = await supabase
      .from("refund_case_messages")
      .insert({
        refund_case_id: refundCase.id,
        message_type: "confirmation",
        status: "pending",
        recipient_email: customerEmail,
        subject: email.subject,
        body: redactRefundStatusLinksForStorage(email.text),
        template_key: "refund_confirmation_v1",
        status_capability_id: statusCapability?.capabilityId ?? null,
        status_link_included: Boolean(statusCapability),
      })
      .select("id")
      .single();

    if (!(await automaticCustomerContactAllowed())) {
      if (messageRow?.id) {
        await supabase
          .from("refund_case_messages")
          .update({
            status: "skipped",
            error_message: "automatic_customer_contact_disabled",
          })
          .eq("id", messageRow.id);
      }
      return new Response(
        JSON.stringify({
          refundCase: {
            id: refundCase.id,
            publicReference: refundCase.public_reference,
            status: refundCase.status,
            correlationStatus: refundCase.correlation_status,
          },
          statusToken: statusCapability?.token ?? null,
          statusExpiresAt: statusCapability?.expiresAt ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const notificationLimitResult = await checkPublicIntakeRateLimits({
      supabase: abuseSupabase,
      keyHashes,
      rules: PUBLIC_INTAKE_NOTIFICATION_LIMITS,
    });

    if (!notificationLimitResult.allowed) {
      console.warn(
        "Public refund intake customer email suppressed.",
        notificationLimitResult.reason,
      );

      if (messageRow?.id) {
        await supabase
          .from("refund_case_messages")
          .update({
            status: "skipped",
            error_message: "public_intake_notification_quota",
          })
          .eq("id", messageRow.id);
      }

      return new Response(
        JSON.stringify({
          refundCase: {
            id: refundCase.id,
            publicReference: refundCase.public_reference,
            status: refundCase.status,
            correlationStatus: refundCase.correlation_status,
          },
          statusToken: statusCapability?.token ?? null,
          statusExpiresAt: statusCapability?.expiresAt ?? null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    try {
      if (!messageRow?.id) {
        throw new Error("Refund customer message record is required.");
      }
      const gmailDelivery = await dispatchRefundCaseGmailReply({
        supabase,
        refundCaseId: refundCase.id,
        refundCaseMessageId: messageRow.id,
        recipientEmail: customerEmail,
        email,
        deliveryKind: "automatic",
        gmailThreadId: linkedGmailThreadId,
      });
      if (!gmailDelivery.usedGmail) {
        if (!(await automaticCustomerContactAllowed())) {
          throw new RefundGmailError(
            "automatic_contact_disabled",
            "Automatic customer contact was disabled before provider delivery.",
          );
        }
        await markRefundTransactionalDeliveryAttempt({
          supabase,
          refundCaseMessageId: messageRow.id,
        });
        const receipt = await sendRefundTransactionalEmail({
          to: [customerEmail],
          cc: gmailDelivery.managerCcEmails,
          subject: email.subject,
          text: email.text,
          html: email.html,
          idempotencyKey: `refund-message-${messageRow.id}`,
        });
        await bindRefundTransactionalDelivery({
          supabase,
          refundCaseMessageId: messageRow.id,
          receipt,
        });
      }

      await supabase
        .from("refund_case_messages")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          subject: gmailDelivery.usedGmail ? gmailDelivery.subject : email.subject,
        })
        .eq("id", messageRow.id);
    } catch (emailError) {
      console.error("refund-case-intake email failed", {
        errorType: emailError instanceof Error ? emailError.name : typeof emailError,
      });
      if (messageRow?.id) {
        await supabase
          .from("refund_case_messages")
          .update({
            status: "failed",
            error_message: emailError instanceof RefundGmailError
              ? emailError.code
              : "customer_email_delivery_failed",
          })
          .eq("id", messageRow.id);
      }
    }

    return new Response(
      JSON.stringify({
        refundCase: {
          id: refundCase.id,
          publicReference: refundCase.public_reference,
          status: refundCase.status,
          correlationStatus: refundCase.correlation_status,
        },
        statusToken: statusCapability?.token ?? null,
        statusExpiresAt: statusCapability?.expiresAt ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    if (error instanceof RefundEmailContextUnavailableError) {
      console.warn("refund-case-intake email context unavailable");
      return new Response(
        JSON.stringify({ error: error.message, errorCode: error.code }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (error instanceof RequestValidationError) {
      console.warn("refund-case-intake validation error", { message: error.message });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.error("refund-case-intake error", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return new Response(JSON.stringify({ error: "Unable to submit refund request." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
