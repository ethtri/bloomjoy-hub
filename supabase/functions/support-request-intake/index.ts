import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";
import { sendWeComAlertSafe } from "../_shared/wecom-alert.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const validRequestTypes = new Set(["concierge", "parts", "wechat_onboarding"]);

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

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

const parseAccessToken = (authorizationHeader: string | null): string => {
  if (!authorizationHeader) return "";
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? "";
};

const sanitizeIntakeMeta = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const raw = value as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};

  const phoneRegion = sanitizeText(raw.phone_region);
  if (phoneRegion) sanitized.phone_region = phoneRegion;

  const phoneNumber = sanitizeText(raw.phone_number);
  if (phoneNumber) sanitized.phone_number = phoneNumber;

  const deviceType = sanitizeText(raw.device_type);
  if (deviceType) sanitized.device_type = deviceType;

  const blockedStep = sanitizeText(raw.blocked_step);
  if (blockedStep) sanitized.blocked_step = blockedStep;

  const wechatId = sanitizeText(raw.wechat_id);
  if (wechatId) sanitized.wechat_id = wechatId;

  if (typeof raw.referral_needed === "boolean") {
    sanitized.referral_needed = raw.referral_needed;
  }

  return sanitized;
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
        JSON.stringify({ error: "Support intake is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const accessToken = parseAccessToken(req.headers.get("Authorization"));
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

    const requestType = sanitizeText(body?.requestType).toLowerCase();
    const subject = sanitizeText(body?.subject);
    const message = sanitizeText(body?.message);
    const intakeMeta = sanitizeIntakeMeta(body?.intakeMeta);
    const customerEmail = sanitizeText(user.email).toLowerCase();

    if (!validRequestTypes.has(requestType)) {
      return new Response(JSON.stringify({ error: "Invalid support request type." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!customerEmail) {
      return new Response(JSON.stringify({ error: "Missing account email address." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!subject) {
      return new Response(JSON.stringify({ error: "Subject is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: supportRequest, error: insertError } = await supabase
      .from("support_requests")
      .insert({
        request_type: requestType,
        customer_user_id: user.id,
        customer_email: customerEmail,
        subject,
        message,
        intake_meta: intakeMeta,
      })
      .select("*")
      .single();

    if (insertError || !supportRequest) {
      throw new Error(insertError?.message || "Unable to submit support request.");
    }

    const onboardingLines =
      supportRequest.request_type === "wechat_onboarding"
        ? [
            `Blocked Step: ${sanitizeText(intakeMeta.blocked_step) || "n/a"}`,
            `Device: ${sanitizeText(intakeMeta.device_type) || "n/a"}`,
            `Phone: ${
              [sanitizeText(intakeMeta.phone_region), sanitizeText(intakeMeta.phone_number)]
                .filter(Boolean)
                .join(" ") || "n/a"
            }`,
            `Referral Needed: ${
              typeof intakeMeta.referral_needed === "boolean"
                ? intakeMeta.referral_needed
                  ? "yes"
                  : "no"
                : "n/a"
            }`,
            `WeChat ID: ${sanitizeText(intakeMeta.wechat_id) || "n/a"}`,
          ]
        : [];

    await sendWeComAlertSafe({
      tag: "Bloomjoy Support",
      title: `New ${supportRequest.request_type} request`,
      lines: [
        `Support Request ID: ${supportRequest.id}`,
        `Submitted At (UTC): ${supportRequest.created_at}`,
        `Request Type: ${supportRequest.request_type}`,
        `Customer User ID: ${supportRequest.customer_user_id}`,
        `Customer Email: ${supportRequest.customer_email}`,
        `Subject: ${supportRequest.subject}`,
        ...onboardingLines,
        "Message:",
        supportRequest.message || "(none provided)",
      ],
    });

    return new Response(JSON.stringify({ supportRequest }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("support-request-intake error", error);
    return new Response(
      JSON.stringify({ error: "Unable to submit support request." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
