import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { createSnapcaseIngestHandler } from "./handler.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ingestToken = Deno.env.get("REPORTING_INGEST_TOKEN");

const supabase = supabaseUrl && serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
  : null;

serve(createSnapcaseIngestHandler({
  ingestToken,
  ingest: async (payload) => {
    if (!supabase) return { data: null, error: { message: "not_configured" } };
    return await supabase.rpc("service_ingest_snapcase_observations", {
      p_payload: payload,
    });
  },
  finalize: async (sourceAccountKey, runKey) => {
    if (!supabase) return { data: null, error: { message: "not_configured" } };
    return await supabase.rpc("service_finalize_snapcase_import_run", {
      p_source_account_key: sourceAccountKey,
      p_run_key: runKey,
    });
  },
}));
