import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const fallbackLoginUrl = "https://app.bloomjoyusa.com/login";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

type InviteType = "corporate_partner" | "technician";
type SourceType = "corporate_partner_membership" | "technician_grant";

type InviteSource = {
  inviteType: InviteType;
  sourceType: SourceType;
  sourceId: string;
  targetEmail: string;
  targetUserId: string | null;
  title: string;
  body: string;
  accessSummary: string;
};

type InviteAttempt = {
  inviteType: InviteType;
  sourceType: SourceType;
  sourceId: string;
  targetEmail: string;
  targetUserId?: string | null;
};

type DeliveryStatus = "sent" | "failed";
type AuditAction = "access_invite.sent" | "access_invite.failed";
type InviteEvidenceMeta = Record<string, unknown>;
type EvidenceTarget = "access_invite_deliveries" | "admin_audit_log";
type EvidenceWriteFailure = {
  target: EvidenceTarget;
  message: string;
};

const sourceTypeByInviteType: Record<InviteType, SourceType> = {
  corporate_partner: "corporate_partner_membership",
  technician: "technician_grant",
};
const maxEvidenceMessageLength = 500;
const sentEvidenceFailureMessage =
  "Invite email may have been sent, but Bloomjoy could not record delivery evidence. Please verify delivery and audit logs before retrying.";

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeEmail = (value: unknown) => sanitizeText(value).toLowerCase();

class InviteEvidenceError extends Error {
  failedTargets: EvidenceTarget[];

  constructor(status: DeliveryStatus, failures: EvidenceWriteFailure[]) {
    const failedTargets = [...new Set(failures.map((failure) => failure.target))];
    super(`Unable to record access invite ${status} evidence in ${failedTargets.join(" and ")}.`);
    this.name = "InviteEvidenceError";
    this.failedTargets = failedTargets;
  }
}

const sanitizeErrorEvidence = (value: unknown, fallback = "Unable to send access invite.") => {
  const raw = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : fallback;
  const message = (raw || fallback)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key["':=\s]+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .slice(0, maxEvidenceMessageLength);

  return message || fallback;
};

const getLoginOriginMeta = (loginUrlResult: {
  url: string;
  isProductionOrigin?: boolean;
  isLocalOrigin?: boolean;
  isPreviewOrigin?: boolean;
}): InviteEvidenceMeta => {
  let loginOrigin = "unknown";
  try {
    loginOrigin = new URL(loginUrlResult.url).origin;
  } catch {
    loginOrigin = "unparseable";
  }

  const loginOriginType = loginUrlResult.isProductionOrigin
    ? "production"
    : loginUrlResult.isLocalOrigin
      ? "local"
      : loginUrlResult.isPreviewOrigin
        ? "preview"
        : "unknown";

  return {
    login_origin: loginOrigin,
    login_origin_type: loginOriginType,
  };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const getStringValue = (record: Record<string, unknown>, key: string) =>
  typeof record[key] === "string" ? record[key] as string : "";

const buildInviteEmail = (source: InviteSource, loginUrl: string, actorEmail: string) => {
  const subject = "Bloomjoy portal invitation";
  const inviter = actorEmail || "A Bloomjoy administrator";

  const text = [
    source.title,
    "",
    `${inviter} invited ${source.targetEmail} to Bloomjoy Hub.`,
    source.body,
    "",
    source.accessSummary,
    "",
    "Open Bloomjoy Hub:",
    loginUrl,
    "",
    "Use this same email address when you create an account or sign in.",
  ].join("\n");

  const html = `
    <div style="margin:0;padding:0;background:#fff7fb;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7fb;margin:0;padding:32px 16px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #f5c8d6;border-radius:8px;overflow:hidden;">
              <tr>
                <td style="padding:28px 28px 22px 28px;">
                  <div style="font-size:12px;line-height:18px;letter-spacing:1px;text-transform:uppercase;color:#be5b7b;font-weight:700;">
                    Bloomjoy Hub
                  </div>
                  <h1 style="margin:10px 0 12px 0;font-size:24px;line-height:32px;color:#111827;">
                    ${escapeHtml(source.title)}
                  </h1>
                  <p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#4b5563;">
                    ${escapeHtml(inviter)} invited ${escapeHtml(source.targetEmail)} to Bloomjoy Hub.
                  </p>
                  <p style="margin:0 0 14px 0;font-size:15px;line-height:24px;color:#4b5563;">
                    ${escapeHtml(source.body)}
                  </p>
                  <p style="margin:0 0 24px 0;font-size:15px;line-height:24px;color:#4b5563;">
                    ${escapeHtml(source.accessSummary)}
                  </p>
                  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#ec8aaa;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;line-height:20px;padding:12px 18px;border-radius:8px;">
                    Open Bloomjoy Hub
                  </a>
                  <p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#6b7280;">
                    Use this same email address when you create an account or sign in. If the button does not work, open this link:<br />
                    <a href="${escapeHtml(loginUrl)}" style="color:#be5b7b;">${escapeHtml(loginUrl)}</a>
                  </p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  return { subject, text, html };
};

async function getCorporatePartnerSource(sourceId: string, targetEmail: string): Promise<InviteSource> {
  if (!supabase) throw new Error("Access invite email is not configured.");

  const { data: membership, error: membershipError } = await supabase
    .from("corporate_partner_memberships")
    .select("id, partner_id, member_email, user_id, status, revoked_at")
    .eq("id", sourceId)
    .maybeSingle();

  if (membershipError || !membership) {
    throw new Error("Corporate Partner membership was not found.");
  }

  const membershipRecord = membership as Record<string, unknown>;
  const memberEmail = normalizeEmail(membershipRecord["member_email"]);
  if (memberEmail !== targetEmail) {
    throw new Error("Invite email does not match the Corporate Partner membership.");
  }

  if (membershipRecord["revoked_at"] || getStringValue(membershipRecord, "status") !== "active") {
    throw new Error("Corporate Partner membership is not active.");
  }

  const partnerId = getStringValue(membershipRecord, "partner_id");
  const { data: partner } = await supabase
    .from("reporting_partners")
    .select("name")
    .eq("id", partnerId)
    .maybeSingle();

  const partnerName = getStringValue((partner as Record<string, unknown> | null) ?? {}, "name") || "Bloomjoy partner";

  return {
    inviteType: "corporate_partner",
    sourceType: "corporate_partner_membership",
    sourceId,
    targetEmail,
    targetUserId: getStringValue(membershipRecord, "user_id") || null,
    title: "Your Bloomjoy portal invitation",
    body: `You have been invited to access Bloomjoy Hub for ${partnerName}.`,
    accessSummary:
      "After you sign in, Bloomjoy Hub will show the tools and information available to your account.",
  };
}

async function getTechnicianSource(sourceId: string, targetEmail: string): Promise<InviteSource> {
  if (!supabase) throw new Error("Access invite email is not configured.");

  const { data: grant, error: grantError } = await supabase
    .from("technician_grants")
    .select("id, account_id, technician_email, technician_user_id, status, revoked_at, expires_at")
    .eq("id", sourceId)
    .maybeSingle();

  if (grantError || !grant) {
    throw new Error("Technician grant was not found.");
  }

  const grantRecord = grant as Record<string, unknown>;
  const technicianEmail = normalizeEmail(grantRecord["technician_email"]);
  if (technicianEmail !== targetEmail) {
    throw new Error("Invite email does not match the Technician grant.");
  }

  if (grantRecord["revoked_at"]) {
    throw new Error("Technician grant is revoked.");
  }

  const grantStatus = getStringValue(grantRecord, "status");
  if (!["active", "pending"].includes(grantStatus)) {
    throw new Error("Technician grant is not active.");
  }

  const expiresAt = getStringValue(grantRecord, "expires_at");
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error("Technician grant is expired.");
  }

  const accountId = getStringValue(grantRecord, "account_id");
  const { data: account } = await supabase
    .from("customer_accounts")
    .select("name")
    .eq("id", accountId)
    .maybeSingle();
  const accountName = getStringValue((account as Record<string, unknown> | null) ?? {}, "name") || "a Bloomjoy account";

  return {
    inviteType: "technician",
    sourceType: "technician_grant",
    sourceId,
    targetEmail,
    targetUserId: getStringValue(grantRecord, "technician_user_id") || null,
    title: "Your Bloomjoy portal invitation",
    body: `You have been invited to access Bloomjoy Hub for ${accountName}.`,
    accessSummary:
      "After you sign in, Bloomjoy Hub will show the tools and information available to your account.",
  };
}

async function recordInviteEvidence(
  attempt: InviteAttempt,
  actorUserId: string,
  status: DeliveryStatus,
  meta: InviteEvidenceMeta = {},
  errorMessage?: string
) {
  if (!supabase) {
    throw new InviteEvidenceError(status, [
      { target: "access_invite_deliveries", message: "Supabase is not configured." },
      { target: "admin_audit_log", message: "Supabase is not configured." },
    ]);
  }

  const safeErrorMessage = errorMessage ? sanitizeErrorEvidence(errorMessage) : undefined;
  const action: AuditAction = status === "sent" ? "access_invite.sent" : "access_invite.failed";
  const auditMeta = {
    invite_type: attempt.inviteType,
    source_type: attempt.sourceType,
    source_id: attempt.sourceId,
    target_email: attempt.targetEmail,
    delivery_status: status,
    ...meta,
    ...(safeErrorMessage ? { error_message: safeErrorMessage } : {}),
  };

  const evidenceWrites: Array<{ target: EvidenceTarget; write: PromiseLike<void> }> = [
    {
      target: "access_invite_deliveries",
      write: supabase.from("access_invite_deliveries").insert({
        invite_type: attempt.inviteType,
        source_type: attempt.sourceType,
        source_id: attempt.sourceId,
        target_email: attempt.targetEmail,
        sent_by: actorUserId,
        delivery_status: status,
        error_message: safeErrorMessage ?? null,
      }).then(({ error }) => {
        if (error) throw error;
      }),
    },
    {
      target: "admin_audit_log",
      write: supabase.from("admin_audit_log").insert({
        actor_user_id: actorUserId,
        action,
        entity_type: attempt.sourceType,
        entity_id: attempt.sourceId,
        target_user_id: attempt.targetUserId ?? null,
        before: {},
        after: {},
        meta: auditMeta,
      }).then(({ error }) => {
        if (error) throw error;
      }),
    },
  ];

  const writes = await Promise.allSettled(evidenceWrites.map(({ write }) => write));
  const failedWrites = writes.flatMap((result, index): EvidenceWriteFailure[] =>
    result.status === "rejected"
      ? [{
          target: evidenceWrites[index].target,
          message: sanitizeErrorEvidence(result.reason, "Unable to record invite evidence."),
        }]
      : []
  );

  if (failedWrites.length > 0) {
    console.warn("access-invite evidence write failed", {
      failed_targets: failedWrites.map((failure) => failure.target),
      failures: failedWrites,
      source_type: attempt.sourceType,
      source_id: attempt.sourceId,
      delivery_status: status,
    });
    throw new InviteEvidenceError(status, failedWrites);
  }
}

async function recordFailureEvidence(
  attempt: InviteAttempt,
  actorUserId: string,
  meta: InviteEvidenceMeta,
  failure: unknown,
  fallback: string,
) {
  const message = sanitizeErrorEvidence(failure, fallback);

  try {
    await recordInviteEvidence(attempt, actorUserId, "failed", meta, message);
  } catch (evidenceError) {
    console.error("access-invite failure evidence unavailable", {
      original_error_message: message,
      evidence_error_message: sanitizeErrorEvidence(
        evidenceError,
        "Unable to record invite failure evidence.",
      ),
    });
  }

  return message;
}

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
      return new Response(JSON.stringify({ error: "Access invite email is not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = resolveSupabaseAccessToken(req);
    if (!accessToken) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const user = authData?.user;
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: isAdmin } = await supabase.rpc("is_super_admin", { uid: user.id });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Super Admin access required." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const inviteType = sanitizeText(body?.inviteType) as InviteType;
    const sourceId = sanitizeText(body?.sourceId);
    const targetEmail = normalizeEmail(body?.targetEmail);
    const loginUrlResult = validateBrowserUrl(body?.loginUrl, {
      label: "login URL",
      fallbackUrl: fallbackLoginUrl,
      allowConfiguredPreviewOrigins: true,
    });

    if (!["corporate_partner", "technician"].includes(inviteType)) {
      return new Response(JSON.stringify({ error: "Unsupported invite type." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!uuidPattern.test(sourceId)) {
      return new Response(JSON.stringify({ error: "Invite source ID is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!emailPattern.test(targetEmail)) {
      return new Response(JSON.stringify({ error: "Invite email is invalid." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const inviteAttempt: InviteAttempt = {
      inviteType,
      sourceType: sourceTypeByInviteType[inviteType],
      sourceId,
      targetEmail,
    };

    if (!loginUrlResult.ok) {
      await recordFailureEvidence(
        inviteAttempt,
        user.id,
        { login_origin_type: "invalid" },
        loginUrlResult.error,
        "Login URL is invalid.",
      );

      return new Response(JSON.stringify({ error: loginUrlResult.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const loginOriginMeta = getLoginOriginMeta(loginUrlResult);
    let source: InviteSource;
    try {
      source = inviteType === "corporate_partner"
        ? await getCorporatePartnerSource(sourceId, targetEmail)
        : await getTechnicianSource(sourceId, targetEmail);
    } catch (sourceError) {
      await recordFailureEvidence(
        inviteAttempt,
        user.id,
        loginOriginMeta,
        sourceError,
        "Unable to load invite source.",
      );
      throw sourceError;
    }

    const email = buildInviteEmail(source, loginUrlResult.url, normalizeEmail(user.email));

    try {
      await sendTransactionalEmail({
        to: [source.targetEmail],
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (sendError) {
      const message = await recordFailureEvidence(
        source,
        user.id,
        loginOriginMeta,
        sendError,
        "Unable to send invite email.",
      );
      throw new Error(message);
    }

    try {
      await recordInviteEvidence(source, user.id, "sent", loginOriginMeta);
    } catch (evidenceError) {
      console.error("access-invite sent evidence unavailable", {
        evidence_error_message: sanitizeErrorEvidence(
          evidenceError,
          "Unable to record invite sent evidence.",
        ),
        source_type: source.sourceType,
        source_id: source.sourceId,
      });

      return new Response(JSON.stringify({ error: sentEvidenceFailureMessage }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = sanitizeErrorEvidence(error, "Unable to send access invite.");
    console.error("access-invite error", message);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
