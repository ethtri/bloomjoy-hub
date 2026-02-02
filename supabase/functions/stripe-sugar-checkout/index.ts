import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const sugarPriceId = Deno.env.get("STRIPE_SUGAR_PRICE_ID");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!sugarPriceId) {
  console.error("Missing STRIPE_SUGAR_PRICE_ID");
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
    if (!stripe || !sugarPriceId) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const successUrl = body?.successUrl;
    const cancelUrl = body?.cancelUrl;

    if (!successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing success or cancel URL." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!items.length) {
      return new Response(JSON.stringify({ error: "Cart is empty." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lineItems: { price: string; quantity: number }[] = [];
    const invalidSkus: string[] = [];

    for (const item of items) {
      const sku = item?.sku;
      const quantity = Number(item?.quantity ?? 0);
      if (sku !== "sugar-1kg") {
        invalidSkus.push(String(sku));
        continue;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        continue;
      }
      lineItems.push({ price: sugarPriceId, quantity });
    }

    if (invalidSkus.length) {
      return new Response(
        JSON.stringify({
          error: "Only sugar checkout is supported right now.",
          invalidSkus,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!lineItems.length) {
      return new Response(
        JSON.stringify({ error: "No valid items in cart." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("stripe-sugar-checkout error", error);
    return new Response(
      JSON.stringify({ error: "Unable to start checkout." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
