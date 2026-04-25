import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const schedulerSecret = Deno.env.get("REPORT_SCHEDULER_SECRET");

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
      source_reference: "deprecated:sunze-sales-sync",
      rows_seen: 0,
      rows_imported: 0,
      rows_skipped: 0,
      error_message: errorMessage ?? null,
      meta: {
        automation: "github-actions-playwright",
        replacement_function: "sunze-sales-ingest",
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

    const runId = await recordRun({
      status: "failed",
      errorMessage: "Sunze browser extraction now runs from GitHub Actions and ingests through sunze-sales-ingest.",
    });

    return jsonResponse({
      status: "deprecated",
      runId,
      message: "Use the scheduled Sunze Sales Sync GitHub Action instead.",
    }, 410);
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
