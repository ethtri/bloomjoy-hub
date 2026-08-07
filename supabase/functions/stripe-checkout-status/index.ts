import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";
import {
  hasAllowedCheckoutPrices,
  isBloomjoyCheckoutSession,
} from "../_shared/paid-checkout.mjs";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const legacySugarPriceId = Deno.env.get("STRIPE_SUGAR_PRICE_ID");
const memberSugarPriceId = Deno.env.get("STRIPE_SUGAR_MEMBER_PRICE_ID") || legacySugarPriceId;
const nonMemberSugarPriceId = Deno.env.get("STRIPE_SUGAR_NON_MEMBER_PRICE_ID");
const sticksPriceId = Deno.env.get("STRIPE_STICKS_PRICE_ID");
const memberSticksPriceId = Deno.env.get("STRIPE_STICKS_MEMBER_PRICE_ID");
const microMachinePriceId = Deno.env.get("STRIPE_MICRO_PRICE_ID");
const plusPriceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");
const checkoutPriceConfig = {
  sugarPriceIds: [legacySugarPriceId, memberSugarPriceId, nonMemberSugarPriceId],
  sticksPriceIds: [sticksPriceId, memberSticksPriceId],
  microMachinePriceId,
  plusPriceId,
};
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2024-04-10" })
  : null;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!stripe) {
    return new Response(JSON.stringify({ error: "Checkout status is not configured." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const sessionId = String(body?.sessionId ?? "").trim();

    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return new Response(JSON.stringify({ error: "Invalid checkout session." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    }) as Stripe.Checkout.Session & { line_items?: Stripe.ApiList<Stripe.LineItem> };

    const isRecognizedSession = isBloomjoyCheckoutSession(session) ||
      isBloomjoyCheckoutSession(session, "subscription");
    if (!isRecognizedSession || !hasAllowedCheckoutPrices(session, checkoutPriceConfig)) {
      return new Response(JSON.stringify({ error: "Unable to verify checkout status." }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        paymentStatus: session.payment_status,
        checkoutStatus: session.status,
        orderType: session.metadata?.order_type ?? "unknown",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch {
    console.error("stripe-checkout-status lookup failed");
    return new Response(JSON.stringify({ error: "Unable to verify checkout status." }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
