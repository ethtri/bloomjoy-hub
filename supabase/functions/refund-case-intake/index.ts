import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import { getRefundReplyToEmail } from "../_shared/refund-email.ts";
import { dispatchRefundCaseGmailReply } from "../_shared/refund-gmail-transport.ts";
import { sendRefundManagerActionNotice } from "../_shared/refund-manager-notification.ts";
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

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const attachmentBucket = "refund-case-attachments";
const maxAttachments = 3;
const maxAttachmentBytes = 5 * 1024 * 1024;
const maxRequestBytes = 18 * 1024 * 1024;
const allowedContentTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

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

type VerifiedRefundQrClaim = {
  id: string;
  reportingMachineId: string;
  openedAt: string;
  expiresAt: string;
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

const formatCurrency = (cents: number | null) => {
  if (typeof cents !== "number") return "not provided";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildCustomerEmail = ({
  publicReference,
  customerName,
  machineLabel,
  locationName,
  amountCents,
  paymentMethod,
  needsMoreInfo,
}: {
  publicReference: string;
  customerName: string;
  machineLabel: string;
  locationName: string;
  amountCents: number | null;
  paymentMethod: string;
  needsMoreInfo: boolean;
}) => {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = needsMoreInfo
    ? `We need one more detail for your Bloomjoy refund request ${publicReference}`
    : `We received your Bloomjoy refund request ${publicReference}`;
  const nextStep = needsMoreInfo
    ? "We could not confidently match the request to a machine transaction yet. Please reply to this email with any extra details you have, such as the exact purchase time, the amount charged, the virtual last 4 shown in Apple Pay or your mobile wallet when one was used, or a photo of the machine/payment screen. The wallet digits may differ from the physical card."
    : "Our team will review the transaction details and follow up as soon as we have the next step.";
  const safeGreeting = escapeHtml(greeting);
  const safeReference = escapeHtml(publicReference);
  const safeMachineLabel = escapeHtml(machineLabel);
  const safeLocationName = escapeHtml(locationName);
  const safeAmount = escapeHtml(formatCurrency(amountCents));
  const safeNextStep = escapeHtml(nextStep);
  const paymentNote = paymentMethod === "cash"
    ? "If approved, cash refunds are sent through Zelle using the contact information you shared."
    : "If approved, card refunds are completed through our payment provider.";
  const safePaymentNote = escapeHtml(paymentNote);

  const text = [
    greeting,
    "",
    "Thank you for reaching out. We are sorry the Bloomjoy experience did not go the way it should have, and we have opened a refund request for you.",
    "",
    `Reference: ${publicReference}`,
    `Machine: ${machineLabel}`,
    `Location: ${locationName}`,
    `Reported amount: ${formatCurrency(amountCents)}`,
    "",
    nextStep,
    paymentNote,
    "Our target is to complete refund reviews within 5 business days.",
    "",
    "You can reply directly to this email. We will keep the review friendly, careful, and quick.",
    "",
    "Warmly,",
    "The Bloomjoy Sweets Team",
  ].join("\n");

  const html = `
    <!doctype html>
    <html lang="en">
      <body style="margin:0;padding:0;background:#fff7f9;font-family:Arial,Helvetica,sans-serif;color:#2f2430;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7f9;padding:28px 0;">
          <tr>
            <td align="center" style="padding:0 16px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#ffffff;border:1px solid #f1d6de;border-radius:22px;overflow:hidden;">
                <tr>
                  <td style="background:#e96b8f;color:#ffffff;padding:26px 28px;">
                    <div style="font-size:12px;letter-spacing:1.4px;text-transform:uppercase;font-weight:700;">Bloomjoy refund request</div>
                    <div style="font-size:28px;line-height:34px;font-weight:800;margin-top:8px;">${needsMoreInfo ? "A quick detail check" : "We received your request"}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:28px;">
                    <p style="font-size:15px;line-height:24px;margin:0 0 16px;">${safeGreeting}</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 18px;">Thank you for reaching out. We are sorry the Bloomjoy experience did not go the way it should have, and we have opened a refund request for you.</p>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #f1d6de;border-radius:16px;background:#fff3f7;padding:16px;margin:0 0 18px;">
                      <tr><td style="font-size:13px;color:#756877;padding:4px 0;">Reference</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${safeReference}</td></tr>
                      <tr><td style="font-size:13px;color:#756877;padding:4px 0;">Machine</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${safeMachineLabel}</td></tr>
                      <tr><td style="font-size:13px;color:#756877;padding:4px 0;">Location</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${safeLocationName}</td></tr>
                      <tr><td style="font-size:13px;color:#756877;padding:4px 0;">Reported amount</td><td style="font-size:14px;font-weight:700;text-align:right;padding:4px 0;">${safeAmount}</td></tr>
                    </table>
                    <p style="font-size:15px;line-height:24px;margin:0 0 18px;">${safeNextStep}</p>
                    <p style="font-size:15px;line-height:24px;margin:0 0 18px;">${safePaymentNote} Our target is to complete refund reviews within 5 business days.</p>
                    <p style="font-size:14px;line-height:22px;margin:0;color:#756877;">You can reply directly to this email. We will keep the review friendly, careful, and quick.</p>
                    <p style="font-size:14px;line-height:22px;margin:20px 0 0;color:#756877;">Warmly,<br />The Bloomjoy Sweets Team</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return { subject, text, html };
};

const buildManagerNotificationSummary = ({
  publicReference,
  machineLabel,
  locationName,
  amountCents,
  paymentMethod,
  incidentAt,
  status,
}: {
  publicReference: string;
  machineLabel: string;
  locationName: string;
  amountCents: number | null;
  paymentMethod: string;
  incidentAt: Date;
  status: string;
}) => [
  "A new Bloomjoy refund request is ready for manager review.",
  "",
  `Reference: ${publicReference}`,
  `Machine: ${machineLabel}`,
  `Location: ${locationName}`,
  `Reported amount: ${formatCurrency(amountCents)}`,
  `Incident time: ${incidentAt.toISOString()}`,
  `Payment method: ${paymentMethod}`,
  `Current status: ${status}`,
].join("\n");

const sendManagerIntakeNotification = async ({
  refundCaseId,
  publicReference,
  customerEmail,
  machineLabel,
  locationName,
  amountCents,
  paymentMethod,
  incidentAt,
  status,
}: {
  refundCaseId: string;
  publicReference: string;
  customerEmail: string;
  machineLabel: string;
  locationName: string;
  amountCents: number | null;
  paymentMethod: string;
  incidentAt: Date;
  status: string;
}) => {
  if (!supabase) return;

  try {
    const summaryText = buildManagerNotificationSummary({
      publicReference,
      machineLabel,
      locationName,
      amountCents,
      paymentMethod,
      incidentAt,
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
        ? "New refund request created an operations routing-exception notice because no eligible current Machine Manager was resolved."
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

  const { data: machine, error: machineError } = await supabase
    .from("reporting_machines")
    .select(
      "id, machine_label, machine_type, location_id, refund_public_display_label, reporting_locations(id, name, timezone, status)",
    )
    .eq("id", qrCodeRow.reporting_machine_id)
    .eq("status", "active")
    .in("machine_type", ["commercial", "mini"])
    .eq("refund_intake_enabled", true)
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
      `Confidence class: ${confidenceClass}`,
    ].join("\n"),
  });

  await supabase.from("refund_case_events").insert({
    refund_case_id: refundCaseId,
    event_type: "wallet_correction_match_ready_notification_sent",
    message: notice.usedOpsFallback
      ? "High-confidence wallet correction match created an operations routing-exception notice because no eligible current Machine Manager was resolved."
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
) => {
  if (!supabase) throw new Error("Refund intake is not configured.");

  if (!result.configured) {
    const { error } = await supabase.from("refund_cases").update({
      status: "needs_review",
      correlation_status: "nayax_not_configured",
      correlation_source: "nayax",
      correlation_confidence: 0,
      correlation_summary:
        result.message ||
        "Nayax setup needs attention before corrected wallet details can be checked.",
      automation_state: "under_review",
      nayax_recommendation_state: "manual_exception",
      nayax_recommendation_policy_version: result.policyVersion,
      nayax_recommendation_evaluated_at: result.lastCheckedAt,
      nayax_match_execution_eligible: false,
    }).eq("id", refundCaseId);
    if (error) throw error;
    return "still_reviewing" as const;
  }

  if (result.recommendationState === "high_confidence") {
    const { data: candidate, error: candidateError } = await supabase
      .from("refund_nayax_lookup_candidates")
      .select(
        "provider_transaction_id, site_id, machine_authorization_time, amount_cents, card_last4, currency_code",
      )
      .eq("refund_case_id", refundCaseId)
      .contains("evidence_summary", { is_recommended: true })
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (candidateError) throw candidateError;

    if (candidate) {
      const { error } = await supabase.from("refund_cases").update({
        status: "needs_review",
        correlation_status: "matched",
        correlation_source: "nayax",
        correlation_confidence: 0,
        correlation_summary: result.summary,
        matched_nayax_transaction_id: candidate.provider_transaction_id,
        matched_nayax_site_id: candidate.site_id,
        matched_nayax_machine_auth_time: candidate.machine_authorization_time,
        matched_nayax_amount_cents: candidate.amount_cents,
        matched_nayax_card_last4: candidate.card_last4,
        matched_nayax_currency_code: candidate.currency_code,
        automation_state: "under_review",
        wallet_correction_state: "received",
        nayax_recommendation_state: result.recommendationState,
        nayax_recommendation_policy_version: result.policyVersion,
        nayax_recommendation_evaluated_at: result.lastCheckedAt,
        nayax_match_execution_eligible: false,
      }).eq("id", refundCaseId);
      if (error) throw error;

      await supabase.from("refund_case_events").insert({
        refund_case_id: refundCaseId,
        event_type: "wallet_correction_auto_match_ready",
        message:
          "Corrected wallet details produced one high-confidence Nayax recommendation for manager approval.",
        metadata: {
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
  }).eq("id", refundCaseId);
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
  const cardLast4 = sanitizeText(body.cardLast4, 4);
  const incidentDate = sanitizeText(body.incidentDate, 10);
  const incidentTime = sanitizeText(body.incidentTime, 8);
  if (
    !isRefundWalletCorrectionToken(token) ||
    !["apple_pay", "google_pay", "other_wallet"].includes(walletType) ||
    !/^[0-9]{4}$/.test(cardLast4) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(incidentDate) ||
    !/^\d{2}:\d{2}$/.test(incidentTime) ||
    body.amountConfirmed !== true
  ) {
    return new Response(
      JSON.stringify({
        error:
          "Enter the mobile wallet used, its virtual card last four, the approximate purchase time, and confirm the amount.",
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
    "service_apply_refund_wallet_correction",
    {
      p_token_hash: tokenHash,
      p_wallet_type: walletType,
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
  try {
    lookupResult = await lookupNayaxCandidatesForRefundCase({
      supabase,
      caseId: refundCaseId,
      actorUserId: null,
    });
    resolution = await persistWalletCorrectionLookup(
      refundCaseId,
      lookupResult,
    );
  } catch (lookupError) {
    console.error("refund wallet correction automatic lookup failed", {
      errorType:
        lookupError instanceof Error ? lookupError.name : typeof lookupError,
    });
    await supabase.from("refund_cases").update({
      status: "needs_review",
      automation_state: "under_review",
      correlation_status: "needs_nayax",
      correlation_summary:
        "Corrected wallet details were saved, but the automatic Nayax re-match needs a retry.",
    }).eq("id", refundCaseId);
    await supabase.from("refund_case_events").insert({
      refund_case_id: refundCaseId,
      event_type: "wallet_correction_auto_match_failed",
      message:
        "Corrected wallet details were saved, but automatic Nayax re-match failed and needs a system retry.",
      metadata: {
        error_type:
          lookupError instanceof Error ? lookupError.name : typeof lookupError,
        payload_redacted: true,
      },
    });
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
    if (action === "submitWalletCorrection") {
      return await submitWalletCorrection(req, body);
    }

    const sourcePage = sanitizePublicIntakeSourcePage("/refunds/request");
    const requestedMachineId = sanitizeText(body?.machineId, 80);
    let machineId = requestedMachineId;
    const qrClaimToken = sanitizeText(body?.qrClaimToken, 80);
    const customerEmail = sanitizeEmail(body?.customerEmail);
    const customerName = sanitizeText(body?.customerName, 160);
    const customerPhone = sanitizeText(body?.customerPhone, 80);
    const zellePaymentContact = sanitizeText(body?.zellePaymentContact, 160);
    const issueSummary = sanitizeText(body?.issueSummary, 2500);
    const paymentMethod = sanitizeText(body?.paymentMethod, 40).toLowerCase();
    const amountCents = centsFromAmount(body?.paymentAmount);
    const cardLast4 = sanitizeText(body?.cardLast4, 4);
    const cardWalletUsed = Boolean(body?.cardWalletUsed);
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

    if (!qrClaimToken && !isUuid(machineId)) {
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

    if (!customerName) {
      return new Response(JSON.stringify({ error: "Please enter your name." }), {
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

    if (!["card", "cash"].includes(paymentMethod)) {
      return new Response(JSON.stringify({ error: "Please choose a payment method." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (amountCents === null || amountCents <= 0) {
      return new Response(JSON.stringify({ error: "Please enter the amount you paid." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (paymentMethod === "card" && !/^[0-9]{4}$/.test(cardLast4)) {
      return new Response(JSON.stringify({ error: "Please enter the last 4 digits shown for the card payment." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (paymentMethod === "cash" && !zellePaymentContact) {
      return new Response(JSON.stringify({ error: "Please enter your Zelle phone number or email." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!issueSummary) {
      return new Response(JSON.stringify({ error: "Please describe what happened." }), {
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
    }

    const attachments = prepareAttachments(rawAttachments);

    const { data: machine, error: machineError } = await supabase
      .from("reporting_machines")
      .select("id, machine_label, machine_type, location_id, refund_public_display_label, reporting_locations(id, name, timezone, status)")
      .eq("id", machineId)
      .eq("status", "active")
      .in("machine_type", ["commercial", "mini"])
      .eq("refund_intake_enabled", true)
      .single();

    if (machineError || !machine) {
      return new Response(JSON.stringify({ error: "That machine is not available for refund intake." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
        .eq("reporting_machine_id", machineRecord.id)
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
        status = "waiting_on_customer";
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
        machineRecord.id,
        incidentAt.toISOString(),
        paymentMethod,
        amountCents ?? "amount-not-provided",
        paymentMethod === "card" ? cardLast4 : "no-card-last4",
        issueSummary,
      ].join("|"),
      windowStartedAt: serverDedupeWindowStartedAt,
    });
    const selectedRefundCaseColumns =
      "id, public_reference, status, correlation_status";

    const { data: insertedRefundCase, error: insertError } = await supabase
      .from("refund_cases")
      .insert({
        reporting_machine_id: machineRecord.id,
        reporting_location_id: machineRecord.location_id,
        customer_email: customerEmail,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        zelle_payment_contact: paymentMethod === "cash" ? zellePaymentContact : null,
        issue_summary: issueSummary,
        incident_at: incidentAt.toISOString(),
        incident_local_datetime: hasLocalIncidentInput ? `${incidentDate}T${incidentTime}` : null,
        incident_timezone: locationRecord?.timezone ?? null,
        incident_time_resolution: incidentResolution.resolution,
        payment_method: paymentMethod,
        payment_amount_cents: amountCents,
        card_last4: paymentMethod === "card" ? cardLast4 : null,
        card_wallet_used: cardWalletUsed,
        status,
        correlation_status: correlationStatus,
        correlation_source: correlationSource,
        correlation_confidence: correlationConfidence,
        correlation_summary: correlationSummary,
        matched_sales_fact_id: matchedSalesFactId,
        refund_amount_cents: amountCents,
        refund_qr_claim_context_id: verifiedQrClaim?.id ?? null,
        intake_meta: {
          source: "hosted_refund_intake",
          intake_path: verifiedQrClaim ? "machine_qr" : "direct_form",
          qr_claim_present: Boolean(verifiedQrClaim),
          qr_claim_opened_at: verifiedQrClaim?.openedAt ?? null,
          qr_claim_expires_at: verifiedQrClaim?.expiresAt ?? null,
          incident_time_resolution: incidentResolution.resolution,
          incident_possible_instant_count: incidentResolution.possibleInstantCount,
          candidate_sales_fact_ids: candidateIds,
          user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
        },
        server_dedupe_key: serverDedupeKey,
        server_dedupe_window_started_at: serverDedupeWindowStartedAt.toISOString(),
      })
      .select(selectedRefundCaseColumns)
      .single();

    const refundCase = insertedRefundCase;
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

      return new Response(
        JSON.stringify({
          refundCase: {
            id: dedupedRefundCase.id,
            publicReference: dedupedRefundCase.public_reference,
            status: dedupedRefundCase.status,
            correlationStatus: dedupedRefundCase.correlation_status,
          },
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
        candidate_sales_fact_ids: candidateIds,
        attachment_count: uploadedAttachments.length,
      },
    });

    await sendManagerIntakeNotification({
      refundCaseId: refundCase.id,
      publicReference: refundCase.public_reference,
      customerEmail,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      amountCents,
      paymentMethod,
      incidentAt,
      status,
    });

    const needsMoreInfo = status === "waiting_on_customer";
    const email = buildCustomerEmail({
      publicReference: refundCase.public_reference,
      customerName,
      machineLabel: publicLabels.machineLabel,
      locationName: publicLabels.locationName,
      amountCents,
      paymentMethod,
      needsMoreInfo,
    });

    const { data: messageRow } = await supabase
      .from("refund_case_messages")
      .insert({
        refund_case_id: refundCase.id,
        message_type: needsMoreInfo ? "more_info" : "confirmation",
        status: "pending",
        recipient_email: customerEmail,
        subject: email.subject,
        body: email.text,
        template_key: needsMoreInfo ? "refund_more_info_v1" : "refund_confirmation_v1",
      })
      .select("id")
      .single();

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
      });
      if (!gmailDelivery.usedGmail) {
        await sendTransactionalEmail({
          to: [customerEmail],
          cc: gmailDelivery.managerCcEmails,
          subject: email.subject,
          text: email.text,
          html: email.html,
          replyTo: getRefundReplyToEmail(),
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
            error_message: "customer_email_delivery_failed",
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
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
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
