import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
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

const sanitizeText = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeEmail = (value: unknown) => sanitizeText(value).toLowerCase();
const isUuid = (value: unknown) => uuidPattern.test(sanitizeText(value));

const sanitizeErrorMessage = (value: unknown, fallback = "Unable to provision operator access.") => {
  const raw = value instanceof Error
    ? value.message
    : typeof value === "string"
      ? value
      : typeof value === "object" && value && "message" in value && typeof value.message === "string"
        ? value.message
        : fallback;

  const message = (raw || fallback)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key["':=\s]+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .slice(0, 500);

  return message || fallback;
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function getActor(req: Request) {
  if (!supabase) throw new Error("Operator payout provisioning is not configured.");

  const accessToken = resolveSupabaseAccessToken(req);
  if (!accessToken) return null;

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;

  return data.user;
}

async function findAuthUserByEmail(email: string) {
  if (!supabase) throw new Error("Operator payout provisioning is not configured.");

  const { data, error } = await supabase.rpc("admin_find_auth_user_by_email", {
    p_email: email,
  });

  if (error) {
    throw new Error(error.message || "Unable to resolve operator Auth user.");
  }

  const record = data as Record<string, unknown> | null;
  const id = sanitizeText(record?.id);
  return id && uuidPattern.test(id) ? record : null;
}

async function ensureAuthUser(email: string, displayName: string) {
  if (!supabase) throw new Error("Operator payout provisioning is not configured.");

  const existingUser = await findAuthUserByEmail(email);
  if (existingUser) {
    return {
      userId: existingUser.id as string,
      authUserCreated: false,
    };
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      full_name: displayName || email,
      provisioned_by: "operator-payout-provision",
    },
  });

  if (error || !data?.user?.id) {
    const retryUser = await findAuthUserByEmail(email);
    if (retryUser) {
      return {
        userId: retryUser.id as string,
        authUserCreated: false,
      };
    }

    throw new Error(error?.message || "Unable to create operator Auth user.");
  }

  return {
    userId: data.user.id,
    authUserCreated: true,
  };
}

async function provisionOperator(actorUserId: string, body: Record<string, unknown>) {
  if (!supabase) throw new Error("Operator payout provisioning is not configured.");

  const userEmail = normalizeEmail(body.userEmail ?? body.email);
  const accountId = sanitizeText(body.accountId);
  const displayName = sanitizeText(body.displayName);
  const workerType = sanitizeText(body.workerType);
  const payoutPolicyId = sanitizeText(body.payoutPolicyId);
  const reason = sanitizeText(body.reason);
  const machineIds = Array.isArray(body.machineIds)
    ? [...new Set(body.machineIds.map((value) => sanitizeText(value)).filter(Boolean))]
    : [];

  if (!emailPattern.test(userEmail)) {
    return jsonResponse(400, { error: "Operator email is invalid." });
  }

  if (!uuidPattern.test(accountId)) {
    return jsonResponse(400, { error: "Operator account is required." });
  }

  if (payoutPolicyId && !uuidPattern.test(payoutPolicyId)) {
    return jsonResponse(400, { error: "Payout policy is invalid." });
  }

  if (machineIds.length === 0 || machineIds.some((machineId) => !uuidPattern.test(machineId))) {
    return jsonResponse(400, { error: "Select at least one valid assigned machine." });
  }

  if (!reason) {
    return jsonResponse(400, { error: "Operator provisioning reason is required." });
  }

  const authUser = await ensureAuthUser(userEmail, displayName);
  const { data, error } = await supabase.rpc("admin_provision_operator_payout_for_user", {
    p_actor_user_id: actorUserId,
    p_target_user_id: authUser.userId,
    p_user_email: userEmail,
    p_account_id: accountId,
    p_display_name: displayName || userEmail,
    p_worker_type: workerType || null,
    p_payout_policy_id: payoutPolicyId || null,
    p_machine_ids: machineIds,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || "Unable to save operator payout access.");
  }

  return jsonResponse(200, {
    ok: true,
    authUserCreated: authUser.authUserCreated,
    ...(data as Record<string, unknown>),
  });
}

async function deactivateOperator(actorUserId: string, body: Record<string, unknown>) {
  if (!supabase) throw new Error("Operator payout provisioning is not configured.");

  const operatorProfileId = sanitizeText(body.operatorProfileId);
  const reason = sanitizeText(body.reason);

  if (!uuidPattern.test(operatorProfileId)) {
    return jsonResponse(400, { error: "Operator profile is required." });
  }

  if (!reason) {
    return jsonResponse(400, { error: "Operator deactivation reason is required." });
  }

  const { data, error } = await supabase.rpc("admin_deactivate_operator_payout_profile_for_user", {
    p_actor_user_id: actorUserId,
    p_operator_profile_id: operatorProfileId,
    p_reason: reason,
  });

  if (error || !data) {
    throw new Error(error?.message || "Unable to deactivate operator payout access.");
  }

  return jsonResponse(200, {
    ok: true,
    ...(data as Record<string, unknown>),
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed." });
    }

    if (!supabase) {
      return jsonResponse(500, { error: "Operator payout provisioning is not configured." });
    }

    const actor = await getActor(req);
    if (!actor) {
      return jsonResponse(401, { error: "Unauthorized." });
    }

    const body = await req.json() as Record<string, unknown>;
    const action = sanitizeText(body.action || "provision");

    if (action === "provision") {
      return await provisionOperator(actor.id, body);
    }

    if (action === "deactivate") {
      return await deactivateOperator(actor.id, body);
    }

    return jsonResponse(400, { error: "Unsupported operator provisioning action." });
  } catch (error) {
    const message = sanitizeErrorMessage(error);
    console.error("operator-payout-provision error", message);

    return jsonResponse(500, { error: message });
  }
});
