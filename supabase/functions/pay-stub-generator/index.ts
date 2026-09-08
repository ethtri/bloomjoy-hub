import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  buildPayStubPdf,
  PAY_STUB_PDF_GENERATOR_VERSION,
  type PayStubPayload,
} from "../_shared/pay-stub-pdf.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("PAY_STUB_CRON_SECRET");
const bucket = "operator-pay-statements";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const service = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const toBlobPart = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

type ClaimedRequest = { requestId: string };
type PreparedStatement = {
  requestId: string;
  status: "prepared" | "blocked";
  statementId?: string;
  storageBucket?: string;
  storagePath?: string;
  payload?: PayStubPayload;
  blockers?: unknown[];
};

const processRequest = async (requestId: string) => {
  if (!service) throw new Error("Pay Stub generation is not configured.");

  const { data: prepared, error: prepareError } = await service.rpc(
    "service_prepare_pay_stub",
    { p_request_id: requestId },
  );
  if (prepareError) throw new Error(prepareError.message);

  const statement = prepared as PreparedStatement;
  if (statement.status === "blocked") return statement;
  if (!statement.statementId || !statement.storagePath || !statement.payload) {
    throw new Error("Prepared Pay Stub is missing its PDF inputs.");
  }

  const pdfBytes = await buildPayStubPdf(statement.payload);
  const { error: uploadError } = await service.storage
    .from(statement.storageBucket || bucket)
    .upload(
      statement.storagePath,
      new Blob([toBlobPart(pdfBytes)], { type: "application/pdf" }),
      { contentType: "application/pdf", upsert: false },
    );
  if (uploadError) throw new Error(uploadError.message);

  const { data: completed, error: completeError } = await service.rpc(
    "service_complete_pay_stub",
    {
      p_request_id: requestId,
      p_pay_statement_id: statement.statementId,
      p_storage_path: statement.storagePath,
    },
  );
  if (completeError) throw new Error(completeError.message);
  return completed;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!supabaseUrl || !supabaseAnonKey || !service) {
    return json({ error: "Pay Stub generation is not configured." }, 500);
  }

  let activeRequestId: string | null = null;
  try {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const requestedId = String(body.requestId ?? "").trim();
    const suppliedCronSecret = req.headers.get("x-pay-stub-cron-secret") ?? "";
    const isCron = Boolean(cronSecret && suppliedCronSecret === cronSecret);

    let claimed: ClaimedRequest[] = [];
    if (isCron) {
      const { error: enqueueError } = await service.rpc("service_enqueue_automatic_pay_stubs", {});
      if (enqueueError) throw new Error(enqueueError.message);
      const { data, error } = await service.rpc("service_claim_pay_stub_generation_requests", { p_limit: 10 });
      if (error) throw new Error(error.message);
      claimed = (data ?? []) as ClaimedRequest[];
    } else {
      const accessToken = resolveSupabaseAccessToken(req);
      if (!accessToken || !uuidPattern.test(requestedId)) return json({ error: "Unauthorized." }, 401);
      const { data: authData, error: authError } = await service.auth.getUser(accessToken);
      if (authError || !authData.user) return json({ error: "Unauthorized." }, 401);

      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      });
      const { data: visibleRequest, error: visibilityError } = await userClient
        .from("pay_stub_generation_requests")
        .select("id")
        .eq("id", requestedId)
        .maybeSingle();
      if (visibilityError || !visibleRequest) return json({ error: "Pay Stub request access required." }, 403);

      const { data, error } = await service.rpc("service_claim_pay_stub_generation_request", {
        p_request_id: requestedId,
      });
      if (error) throw new Error(error.message);
      claimed = [data as ClaimedRequest];
    }

    const results = [];
    for (const request of claimed) {
      activeRequestId = request.requestId;
      try {
        results.push(await processRequest(request.requestId));
      } catch (error) {
        await service.rpc("service_fail_pay_stub", {
          p_request_id: request.requestId,
          p_error_message: error instanceof Error ? error.message : "Pay Stub generation failed",
        });
        throw error;
      } finally {
        activeRequestId = null;
      }
    }

    return json({
      processedCount: results.length,
      results,
      pdfGeneratorVersion: PAY_STUB_PDF_GENERATOR_VERSION,
    });
  } catch (error) {
    if (activeRequestId) {
      await service.rpc("service_fail_pay_stub", {
        p_request_id: activeRequestId,
        p_error_message: error instanceof Error ? error.message : "Pay Stub generation failed",
      });
    }
    console.error("pay-stub-generator error", error);
    return json({ error: error instanceof Error ? error.message : "Unable to generate Pay Stub." }, 500);
  }
});
