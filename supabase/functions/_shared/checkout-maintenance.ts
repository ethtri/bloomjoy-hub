import { corsHeaders } from "./cors.ts";

// Read per request so the bounded merchant change can pause all entry points.
export const checkoutMaintenanceResponse = (
  paused = Deno.env.get("STOREFRONT_CHECKOUT_PAUSED"),
): Response | null => {
  if (paused !== "true") return null;
  return new Response(
    JSON.stringify({
      error: "Checkout is briefly unavailable while billing is updated. Please try again shortly.",
      errorCode: "CHECKOUT_TEMPORARILY_PAUSED",
    }),
    {
      status: 503,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": "120",
      },
    },
  );
};
