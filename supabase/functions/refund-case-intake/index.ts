import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";
import {
  buildPublicIntakeKeyHashes,
  checkPublicIntakeRateLimits,
  getPublicIntakeClientIp,
  PUBLIC_INTAKE_SUBMISSION_LIMITS,
  type PublicIntakeAbuseSupabaseClient,
} from "../_shared/public-intake-abuse-controls.ts";

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
  const binary = atob(value.includes(",") ? value.split(",").pop() ?? "" : value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
  needsMoreInfo,
}: {
  publicReference: string;
  customerName: string;
  machineLabel: string;
  locationName: string;
  amountCents: number | null;
  needsMoreInfo: boolean;
}) => {
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = needsMoreInfo
    ? `We need one more detail for your Bloomjoy refund request ${publicReference}`
    : `We received your Bloomjoy refund request ${publicReference}`;
  const nextStep = needsMoreInfo
    ? "We could not confidently match the request to a machine transaction yet. Please reply to this email with any extra details you have, such as the exact purchase time, the amount charged, the last 4 digits shown on the receipt, or a photo of the machine/payment screen."
    : "Our team will review the transaction details and follow up as soon as we have the next step.";
  const safeGreeting = escapeHtml(greeting);
  const safeReference = escapeHtml(publicReference);
  const safeMachineLabel = escapeHtml(machineLabel);
  const safeLocationName = escapeHtml(locationName);
  const safeAmount = escapeHtml(formatCurrency(amountCents));
  const safeNextStep = escapeHtml(nextStep);

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

const uploadAttachments = async (
  refundCaseId: string,
  attachments: RefundAttachmentInput[]
) => {
  if (!supabase || attachments.length === 0) return [];

  const uploaded = [];
  for (const [index, attachment] of attachments.entries()) {
    const contentType = sanitizeText(attachment.contentType, 100).toLowerCase();
    const fileName = safeFileName(sanitizeText(attachment.fileName, 160));
    const base64 = sanitizeText(attachment.base64, maxAttachmentBytes * 2);
    const declaredByteSize = Number(attachment.byteSize ?? 0);

    if (!allowedContentTypes.has(contentType) || !base64) {
      throw new Error("Attachments must be PNG, JPEG, or WebP images.");
    }

    const bytes = decodeBase64(base64);
    if (bytes.byteLength > maxAttachmentBytes) {
      throw new Error("Each attachment must be 5MB or smaller.");
    }

    if (declaredByteSize > 0 && Math.abs(declaredByteSize - bytes.byteLength) > 64) {
      throw new Error("Attachment size did not match the submitted file.");
    }

    const storagePath = `refund-cases/${refundCaseId}/${index + 1}-${crypto.randomUUID()}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from(attachmentBucket)
      .upload(storagePath, bytes, {
        contentType,
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data, error: insertError } = await supabase
      .from("refund_case_attachments")
      .insert({
        refund_case_id: refundCaseId,
        storage_bucket: attachmentBucket,
        storage_path: storagePath,
        file_name: fileName,
        content_type: contentType,
        byte_size: bytes.byteLength,
      })
      .select("*")
      .single();

    if (insertError) {
      throw insertError;
    }

    uploaded.push(data);
  }

  return uploaded;
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
    const machineId = sanitizeText(body?.machineId, 80);
    const customerEmail = sanitizeEmail(body?.customerEmail);
    const customerName = sanitizeText(body?.customerName, 160);
    const customerPhone = sanitizeText(body?.customerPhone, 80);
    const issueSummary = sanitizeText(body?.issueSummary, 2500);
    const paymentMethod = sanitizeText(body?.paymentMethod, 40).toLowerCase();
    const amountCents = centsFromAmount(body?.paymentAmount);
    const cardLast4 = sanitizeText(body?.cardLast4, 4);
    const cardWalletUsed = Boolean(body?.cardWalletUsed);
    const incidentAt = parseIncidentAt(body?.incidentAt);
    const attachments = Array.isArray(body?.attachments)
      ? (body.attachments as RefundAttachmentInput[]).slice(0, maxAttachments)
      : [];

    if (!isUuid(machineId)) {
      return new Response(JSON.stringify({ error: "Please choose a machine location." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!customerEmail || !isEmail(customerEmail)) {
      return new Response(JSON.stringify({ error: "Please enter a valid email address." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!incidentAt) {
      return new Response(JSON.stringify({ error: "Please enter the incident date and time." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["card", "cash", "unknown"].includes(paymentMethod)) {
      return new Response(JSON.stringify({ error: "Please choose a payment method." }), {
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

    if (!issueSummary) {
      return new Response(JSON.stringify({ error: "Please describe what happened." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const abuseSupabase = supabase as unknown as PublicIntakeAbuseSupabaseClient;
    const keyHashes = await buildPublicIntakeKeyHashes({
      salt: getAbuseControlSalt(),
      ip: getPublicIntakeClientIp(req),
      email: customerEmail,
      sourcePage: "/refunds/request",
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

    const { data: machine, error: machineError } = await supabase
      .from("reporting_machines")
      .select("id, machine_label, location_id, reporting_locations(id, name, timezone)")
      .eq("id", machineId)
      .eq("status", "active")
      .single();

    if (machineError || !machine) {
      return new Response(JSON.stringify({ error: "That machine is not available for refund intake." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const machineRecord = machine as {
      id: string;
      machine_label: string;
      location_id: string;
      reporting_locations?: { id: string; name: string; timezone: string } | null;
    };
    const locationName = machineRecord.reporting_locations?.name ?? "Bloomjoy location";

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
    } else {
      status = "waiting_on_customer";
      correlationStatus = "no_match";
      correlationSummary = "Payment method was not specific enough for conservative matching.";
    }

    const { data: refundCase, error: insertError } = await supabase
      .from("refund_cases")
      .insert({
        reporting_machine_id: machineRecord.id,
        reporting_location_id: machineRecord.location_id,
        customer_email: customerEmail,
        customer_name: customerName || null,
        customer_phone: customerPhone || null,
        issue_summary: issueSummary,
        incident_at: incidentAt.toISOString(),
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
        intake_meta: {
          source: "hosted_refund_intake",
          candidate_sales_fact_ids: candidateIds,
          user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
        },
      })
      .select("*")
      .single();

    if (insertError || !refundCase) {
      throw new Error(insertError?.message || "Unable to create refund case.");
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
        candidate_sales_fact_ids: candidateIds,
        attachment_count: uploadedAttachments.length,
      },
    });

    const needsMoreInfo = status === "waiting_on_customer";
    const email = buildCustomerEmail({
      publicReference: refundCase.public_reference,
      customerName,
      machineLabel: machineRecord.machine_label,
      locationName,
      amountCents,
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

    try {
      await sendTransactionalEmail({
        to: [customerEmail],
        subject: email.subject,
        text: email.text,
        html: email.html,
      });

      if (messageRow?.id) {
        await supabase
          .from("refund_case_messages")
          .update({ status: "sent", sent_at: new Date().toISOString() })
          .eq("id", messageRow.id);
      }
    } catch (emailError) {
      console.error("refund-case-intake email failed", emailError);
      if (messageRow?.id) {
        await supabase
          .from("refund_case_messages")
          .update({
            status: "failed",
            error_message: emailError instanceof Error ? emailError.message.slice(0, 500) : "Email failed.",
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
    console.error("refund-case-intake error", error);
    return new Response(JSON.stringify({ error: "Unable to submit refund request." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
