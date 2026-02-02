import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const plusPriceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!plusPriceId) {
  console.error("Missing STRIPE_PLUS_PRICE_ID");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-04-10",
    })
  : null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (!stripe || !plusPriceId) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const successUrl = body?.successUrl;
    const cancelUrl = body?.cancelUrl;
    const email = typeof body?.email === "string" ? body.email : undefined;

    if (!successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing success or cancel URL." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plusPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: email,
      allow_promotion_codes: true,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("stripe-plus-checkout error", error);
    return new Response(
      JSON.stringify({ error: "Unable to start checkout." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
