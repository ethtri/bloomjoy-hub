import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");
const sunzeLoginUrl = Deno.env.get("SUNZE_LOGIN_URL");
const sunzeEmail = Deno.env.get("SUNZE_REPORTING_EMAIL");
const sunzePassword = Deno.env.get("SUNZE_REPORTING_PASSWORD");

const supabase =
  supabaseUrl && supabaseServiceRoleKey
    ? createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false },
      })
    : null;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const recordRun = async ({
  status,
  errorMessage,
}: {
  status: "completed" | "failed";
  errorMessage?: string;
}) => {
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("sales_import_runs")
    .insert({
      source: "sunze_browser",
      status,
      source_reference: sunzeLoginUrl ?? null,
      rows_seen: 0,
      rows_imported: 0,
      rows_skipped: 0,
      error_message: errorMessage ?? null,
      meta: {
        automation: "playwright",
        service_account_configured: Boolean(sunzeLoginUrl && sunzeEmail && sunzePassword),
      },
      completed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    console.error("sunze-sales-sync import run insert error", error);
    return null;
  }

  return data?.id ?? null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed." }, 405);
    }

    if (!schedulerSecret) {
      return jsonResponse({ error: "REPORT_SCHEDULER_SECRET is not configured." }, 500);
    }

    if (req.headers.get("Authorization") !== `Bearer ${schedulerSecret}`) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }

    if (!supabase) {
      return jsonResponse({ error: "Sunze sync is not configured." }, 500);
    }

    if (!sunzeLoginUrl || !sunzeEmail || !sunzePassword) {
      const runId = await recordRun({
        status: "failed",
        errorMessage: "Sunze service account credentials are not configured.",
      });
      return jsonResponse({
        status: "not_configured",
        runId,
        message: "Sunze service account credentials are required before browser sync can run.",
      });
    }

    const runId = await recordRun({
      status: "failed",
      errorMessage:
        "Sunze browser extraction is intentionally stubbed until the service account flow is validated.",
    });

    return jsonResponse({
      status: "stubbed",
      runId,
      message:
        "Service account settings are present. Implement the Playwright extractor after Sunze screen/export discovery is complete.",
    });
  } catch (error) {
    console.error("sunze-sales-sync error", error);
    return jsonResponse(
      {
        error:
          error instanceof Error && error.message ? error.message : "Unable to run Sunze sync.",
      },
      500
    );
  }
});
