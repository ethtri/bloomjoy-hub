import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

// Historical step-up records remain readable in Postgres, but this endpoint is
// deliberately inert. It returns before authentication, Auth factor work, or
// any database call, so an old client cannot revive the retired second gate.
serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return jsonResponse({
    error: "Refund approval now uses one manager confirmation. This extra verification step is retired.",
    errorCode: "manager_step_up_retired",
    actionTaken: false,
  }, 410);
});
