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

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const normalizeEmail = (value: unknown) => sanitizeText(value).toLowerCase();

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
  const subject = source.inviteType === "corporate_partner"
    ? "Bloomjoy Corporate Partner access"
    : "Bloomjoy Technician access";
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
    title: "Corporate Partner access is ready",
    body: `You have been added as a Corporate Partner for ${partnerName}.`,
    accessSummary:
      "Corporate Partner access can include partner reporting, training, support, member supply pricing, and Technician management for eligible portal-enabled partnership machines.",
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
    title: "Technician access is ready",
    body: `You have been added as a Technician for ${accountName}.`,
    accessSummary:
      "Technician access includes Bloomjoy training and, when assigned, reporting for the specific machine selected by the account owner or Bloomjoy admin.",
  };
}

async function insertDelivery(source: InviteSource, actorUserId: string, status: "sent" | "failed", errorMessage?: string) {
  if (!supabase) return;

  await supabase.from("access_invite_deliveries").insert({
    invite_type: source.inviteType,
    source_type: source.sourceType,
    source_id: source.sourceId,
    target_email: source.targetEmail,
    sent_by: actorUserId,
    delivery_status: status,
    error_message: errorMessage ?? null,
  });
}

async function insertAudit(
  source: InviteSource,
  actorUserId: string,
  action: "access_invite.sent" | "access_invite.failed",
  meta: Record<string, unknown>
) {
  if (!supabase) return;

  await supabase.from("admin_audit_log").insert({
    actor_user_id: actorUserId,
    action,
    entity_type: source.sourceType,
    entity_id: source.sourceId,
    target_user_id: source.targetUserId,
    before: {},
    after: {},
    meta,
  });
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

    if (!loginUrlResult.ok) {
      return new Response(JSON.stringify({ error: loginUrlResult.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const source = inviteType === "corporate_partner"
      ? await getCorporatePartnerSource(sourceId, targetEmail)
      : await getTechnicianSource(sourceId, targetEmail);
    const email = buildInviteEmail(source, loginUrlResult.url, normalizeEmail(user.email));

    try {
      await sendTransactionalEmail({
        to: [source.targetEmail],
        subject: email.subject,
        text: email.text,
        html: email.html,
      });
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : "Unable to send invite email.";
      await insertDelivery(source, user.id, "failed", message);
      await insertAudit(source, user.id, "access_invite.failed", {
        invite_type: source.inviteType,
        source_type: source.sourceType,
        source_id: source.sourceId,
        target_email: source.targetEmail,
        delivery_status: "failed",
        error_message: message,
      });
      throw sendError;
    }

    await insertDelivery(source, user.id, "sent");
    await insertAudit(source, user.id, "access_invite.sent", {
      invite_type: source.inviteType,
      source_type: source.sourceType,
      source_id: source.sourceId,
      target_email: source.targetEmail,
      delivery_status: "sent",
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("access-invite error", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to send access invite.";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
