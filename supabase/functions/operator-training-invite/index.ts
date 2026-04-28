import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import { sendTransactionalEmail } from "../_shared/internal-email.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const fallbackLoginUrl = "https://app.bloomjoyusa.com/login";

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

type OperatorTrainingGrantRow = {
  id: string;
  sponsor_user_id: string;
  operator_email: string;
  revoked_at: string | null;
};

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const buildInviteEmail = ({
  operatorEmail,
  sponsorEmail,
  loginUrl,
}: {
  operatorEmail: string;
  sponsorEmail: string;
  loginUrl: string;
}) => {
  const subject = "Bloomjoy training access";
  const text = [
    "You have been given access to Bloomjoy operator training.",
    "",
    sponsorEmail
      ? `${sponsorEmail} added you as a training operator.`
      : "A Bloomjoy Plus account added you as a training operator.",
    "",
    "Open training:",
    loginUrl,
    "",
    "This access is limited to the training library. Billing, orders, support, onboarding, and Plus pricing stay with the Bloomjoy Plus account owner.",
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
                    Bloomjoy training
                  </div>
                  <h1 style="margin:10px 0 12px 0;font-size:24px;line-height:32px;color:#111827;">
                    Training access is ready
                  </h1>
                  <p style="margin:0 0 16px 0;font-size:15px;line-height:24px;color:#4b5563;">
                    ${escapeHtml(sponsorEmail || "A Bloomjoy Plus account")} added ${escapeHtml(operatorEmail)} as a training operator.
                  </p>
                  <p style="margin:0 0 24px 0;font-size:15px;line-height:24px;color:#4b5563;">
                    This access is limited to the training library. Billing, orders, support, onboarding, and Plus pricing stay with the Bloomjoy Plus account owner.
                  </p>
                  <a href="${escapeHtml(loginUrl)}" style="display:inline-block;background:#ec8aaa;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;line-height:20px;padding:12px 18px;border-radius:8px;">
                    Open training
                  </a>
                  <p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#6b7280;">
                    If the button does not work, open this link: <br />
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
      return new Response(
        JSON.stringify({ error: "Operator training invite email is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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

    const body = await req.json();
    const grantId = sanitizeText(body?.grantId);
    const loginUrlResult = validateBrowserUrl(body?.loginUrl, {
      label: "login URL",
      fallbackUrl: fallbackLoginUrl,
    });

    if (!loginUrlResult.ok) {
      return new Response(JSON.stringify({ error: loginUrlResult.error }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const loginUrl = loginUrlResult.url;

    if (!uuidPattern.test(grantId)) {
      return new Response(JSON.stringify({ error: "Operator grant ID is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: grant, error: grantError } = await supabase
      .from("operator_training_grants")
      .select("id, sponsor_user_id, operator_email, revoked_at")
      .eq("id", grantId)
      .maybeSingle();

    if (grantError || !grant) {
      return new Response(JSON.stringify({ error: "Operator training grant not found." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const operatorGrant = grant as OperatorTrainingGrantRow;
    const { data: isAdmin } = await supabase.rpc("is_super_admin", { uid: user.id });
    const canSendInvite = operatorGrant.sponsor_user_id === user.id || Boolean(isAdmin);

    if (!canSendInvite) {
      return new Response(JSON.stringify({ error: "Access denied." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (operatorGrant.revoked_at) {
      return new Response(JSON.stringify({ error: "Operator training access is revoked." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const operatorEmail = sanitizeText(operatorGrant.operator_email).toLowerCase();
    if (!emailPattern.test(operatorEmail)) {
      return new Response(JSON.stringify({ error: "Operator email is invalid." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = buildInviteEmail({
      operatorEmail,
      sponsorEmail: sanitizeText(user.email).toLowerCase(),
      loginUrl,
    });

    await sendTransactionalEmail({
      to: [operatorEmail],
      subject: email.subject,
      text: email.text,
      html: email.html,
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("operator-training-invite error", error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : "Unable to send operator training invite.";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
