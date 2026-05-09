import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const nayaxLookupUrl = Deno.env.get("NAYAX_LYNX_TRANSACTION_LOOKUP_URL");
const nayaxApiToken = Deno.env.get("NAYAX_LYNX_API_TOKEN");

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false },
    })
  : null;

const sanitizeText = (value: unknown, maxLength = 300) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

const sanitizeCents = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : null;
};

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const parseIncidentAt = (value: unknown) => {
  const raw = sanitizeText(value, 80);
  const date = raw ? new Date(raw) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const sanitizeNayaxCandidates = (value: unknown) => {
  const rawCandidates = Array.isArray(value)
    ? value
    : Array.isArray((value as { candidates?: unknown[] } | null)?.candidates)
      ? (value as { candidates: unknown[] }).candidates
      : [];

  return rawCandidates.slice(0, 10).map((candidate) => {
    const record = typeof candidate === "object" && candidate !== null
      ? candidate as Record<string, unknown>
      : {};

    return {
      transactionId: sanitizeText(
        record.transactionId ?? record.transaction_id ?? record.id,
        120
      ),
      machineId: sanitizeText(record.machineId ?? record.machine_id ?? record.siteId, 120),
      authorizedAt: sanitizeText(record.authorizedAt ?? record.authDate ?? record.paymentTime, 80),
      amountCents: sanitizeCents(record.amountCents ?? record.amount_cents ?? record.amount),
      cardLast4: sanitizeText(record.cardLast4 ?? record.last4 ?? record.card_last4, 4),
      paymentStatus: sanitizeText(record.paymentStatus ?? record.status, 80),
    };
  }).filter((candidate) => candidate.transactionId);
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
      return new Response(JSON.stringify({ error: "Nayax lookup is not configured." }), {
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

    const body = await req.json();
    const machineId = sanitizeText(body?.machineId, 80);
    const incidentAt = parseIncidentAt(body?.incidentAt);
    const amountCents = sanitizeCents(body?.amountCents);
    const cardLast4 = sanitizeText(body?.cardLast4, 4);

    if (!isUuid(machineId) || !incidentAt) {
      return new Response(JSON.stringify({ error: "Machine and incident time are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: canManage, error: accessError } = await supabase.rpc(
      "can_manage_refund_machine",
      { p_user_id: user.id, p_machine_id: machineId }
    );

    if (accessError) {
      throw accessError;
    }

    if (!canManage) {
      return new Response(JSON.stringify({ error: "Refund machine access required." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!nayaxLookupUrl || !nayaxApiToken) {
      return new Response(
        JSON.stringify({
          configured: false,
          candidates: [],
          message:
            "Nayax Lynx lookup is scaffolded but waiting on server-only endpoint/token configuration.",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const windowStart = new Date(incidentAt.getTime() - 60 * 60 * 1000);
    const windowEnd = new Date(incidentAt.getTime() + 60 * 60 * 1000);
    const response = await fetch(nayaxLookupUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nayaxApiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        machineId,
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        amountCents,
        cardLast4,
        readOnly: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Nayax lookup failed (${response.status}): ${errorBody.slice(0, 500)}`);
    }

    const nayaxPayload = await response.json();
    return new Response(
      JSON.stringify({
        configured: true,
        candidates: sanitizeNayaxCandidates(nayaxPayload),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("nayax-transaction-lookup error", error);
    return new Response(JSON.stringify({ error: "Unable to look up Nayax transactions." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
