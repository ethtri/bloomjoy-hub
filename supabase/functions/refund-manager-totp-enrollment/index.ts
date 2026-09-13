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

// Refund-specific TOTP enrollment is retired. This route remains only as a
// fail-closed compatibility response and never creates, verifies, or deletes
// an Auth factor and never writes to the database.
serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return jsonResponse({
    error: "Refund authenticator setup is no longer used.",
    errorCode: "refund_totp_retired",
    actionTaken: false,
  }, 410);
});
