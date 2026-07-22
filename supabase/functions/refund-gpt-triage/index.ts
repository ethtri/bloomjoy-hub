import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  buildRefundGptTriageInput,
  REFUND_GPT_TRIAGE_PROMPT_VERSION,
  REFUND_GPT_TRIAGE_SCHEMA_VERSION,
} from "../_shared/refund-gpt-triage-policy.mjs";
import {
  REFUND_GPT_TRIAGE_DEFAULT_MODEL,
  RefundGptProviderError,
  isOpenAiRefundTriageConfigured,
  runOpenAiRefundTriage,
} from "../_shared/refund-gpt-triage-provider.mjs";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const syncSecret = (Deno.env.get("REFUND_GPT_TRIAGE_SYNC_SECRET") ?? "").trim();
const openAiApiKey = (Deno.env.get("OPENAI_API_KEY") ?? "").trim();
const safetySalt = (Deno.env.get("OPENAI_REFUND_TRIAGE_SAFETY_SALT") ?? "").trim();
const configuredModel = (Deno.env.get("OPENAI_REFUND_TRIAGE_MODEL") ?? REFUND_GPT_TRIAGE_DEFAULT_MODEL).trim();
const dataControlsApproved = ["1", "true", "yes", "on"].includes(
  (Deno.env.get("OPENAI_REFUND_TRIAGE_DATA_CONTROLS_APPROVED") ?? "").trim().toLowerCase(),
);

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
  ["1", "true", "yes", "on"].includes(
    (Deno.env.get("REFUND_GPT_TRIAGE_ENABLED") ?? "").trim().toLowerCase(),
  );

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

const sha256Hex = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const rpc = async (name: string, params: Record<string, unknown>) => {
  if (!supabase) throw new Error("service_configuration_missing");
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return data as Record<string, unknown> | Array<Record<string, unknown>> | null;
};

type ClaimedJob = {
  jobId: string;
  refundCaseId: string;
  sourceMessageId: string;
  publicReference: string;
  subject: string;
  messages: Array<{
    direction: "inbound";
    kind: "message";
    body: string;
    receivedAt: string | null;
    sensitiveDataRedacted: boolean;
  }>;
};

const failJob = async (jobId: string, category: string, code: string) => {
  try {
    await rpc("service_fail_refund_gpt_triage_job", {
      p_job_id: jobId,
      p_failure_category: category,
      p_error_code: code,
    });
  } catch {
    console.error("refund-gpt-triage failed to record a redacted job failure", {
      failureCategory: "database_validation",
      payloadRedacted: true,
    });
  }
};

serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);
  if (!authorize(request)) return jsonResponse({ error: "Unauthorized." }, 401);
  if (!supabase) return jsonResponse({ error: "Refund GPT triage is not configured." }, 500);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const triggerSource = sanitizeText(body.trigger, 40).toLowerCase() || "scheduled";
  const runKey = sanitizeText(body.runKey, 160);
  const requestedLimit = Number(body.limit ?? Deno.env.get("REFUND_GPT_TRIAGE_MAX_JOBS_PER_RUN") ?? 5);
  const limit = Math.min(Math.max(Number.isInteger(requestedLimit) ? requestedLimit : 5, 1), 10);
  if (!runKey || !["scheduled", "manual", "failure_test"].includes(triggerSource)) {
    return jsonResponse({ error: "Valid run key and trigger are required." }, 400);
  }

  if (triggerSource === "failure_test") {
    return jsonResponse({ status: "failed", failureTest: true, payloadRedacted: true }, 503);
  }

  if (!isEnabled()) {
    return jsonResponse({ status: "disabled", claimed: 0, completed: 0, failed: 0, payloadRedacted: true });
  }
  if (!isOpenAiRefundTriageConfigured({
    apiKey: openAiApiKey,
    safetySalt,
    model: configuredModel,
    dataControlsApproved,
  })) {
    return jsonResponse({
      status: "configuration_error",
      errorCode: "provider_configuration_missing",
      payloadRedacted: true,
    }, 503);
  }

  await rpc("service_purge_refund_gpt_triage_jobs", { p_limit: 200 });
  const claim = await rpc("service_claim_refund_gpt_triage_jobs", {
    p_run_key: runKey,
    p_model_name: configuredModel,
    p_prompt_version: REFUND_GPT_TRIAGE_PROMPT_VERSION,
    p_schema_version: REFUND_GPT_TRIAGE_SCHEMA_VERSION,
    p_limit: limit,
  }) as Record<string, unknown> | null;
  if (claim?.enabled !== true) {
    return jsonResponse({ status: "disabled", claimed: 0, completed: 0, failed: 0, payloadRedacted: true });
  }

  const jobs = Array.isArray(claim.jobs) ? claim.jobs as ClaimedJob[] : [];
  const counters = { claimed: jobs.length, completed: 0, reviewReady: 0, humanReview: 0, failed: 0 };

  for (const job of jobs) {
    const jobId = sanitizeText(job.jobId, 80);
    const refundCaseId = sanitizeText(job.refundCaseId, 80);
    const sourceMessageId = sanitizeText(job.sourceMessageId, 80);
    if (!jobId || !refundCaseId || !sourceMessageId) {
      counters.failed += 1;
      if (jobId) await failJob(jobId, "database_validation", "claim_shape_invalid");
      continue;
    }

    try {
      const input = buildRefundGptTriageInput({ subject: job.subject, messages: job.messages });
      const inputFingerprint = await sha256Hex(JSON.stringify(input));
      const safetyIdentifier = await sha256Hex(`refund-case:${refundCaseId}:${safetySalt}`);
      const result = await runOpenAiRefundTriage({
        apiKey: openAiApiKey,
        input,
        model: configuredModel,
        safetyIdentifier,
      });
      const completed = await rpc("service_complete_refund_gpt_triage_job", {
        p_job_id: jobId,
        p_input_fingerprint: inputFingerprint,
        p_model_snapshot: result.modelSnapshot,
        p_result: result.suggestion,
      }) as Record<string, unknown> | null;
      counters.completed += 1;
      if (completed?.status === "ready_for_review") counters.reviewReady += 1;
      else counters.humanReview += 1;
    } catch (error) {
      const providerError = error instanceof RefundGptProviderError ? error : null;
      const category = sanitizeText(providerError?.category ?? "internal", 40) || "internal";
      const code = sanitizeText(providerError?.code ?? "triage_job_failed", 80) || "triage_job_failed";
      await failJob(jobId, category, code);
      counters.failed += 1;
    }
  }

  console.info("refund-gpt-triage completed", {
    status: counters.failed > 0 ? "partial_failure" : "succeeded",
    ...counters,
    payloadRedacted: true,
  });
  return jsonResponse({
    status: counters.failed > 0 ? "partial_failure" : "succeeded",
    ...counters,
    payloadRedacted: true,
  }, counters.failed > 0 ? 503 : 200);
});
