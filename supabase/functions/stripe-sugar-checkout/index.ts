import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const sugarPriceId = Deno.env.get("STRIPE_SUGAR_PRICE_ID");
const maxSugarKgPerCheckout = 200000;
const allowedSugarSkus = new Set([
  "sugar-1kg",
  "sugar-white-1kg",
  "sugar-blue-1kg",
  "sugar-orange-1kg",
  "sugar-red-1kg",
]);

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

    const sugarBreakdown = {
      white: 0,
      blue: 0,
      orange: 0,
      red: 0,
    };
    const invalidSkus: string[] = [];

    for (const item of items) {
      const sku = item?.sku;
      const quantity = Number(item?.quantity ?? 0);
      if (!allowedSugarSkus.has(String(sku))) {
        invalidSkus.push(String(sku));
        continue;
      }
      if (!Number.isInteger(quantity) || quantity <= 0) {
        continue;
      }
      const normalizedSku = sku === "sugar-1kg" ? "sugar-white-1kg" : String(sku);
      switch (normalizedSku) {
        case "sugar-white-1kg":
          sugarBreakdown.white += quantity;
          break;
        case "sugar-blue-1kg":
          sugarBreakdown.blue += quantity;
          break;
        case "sugar-orange-1kg":
          sugarBreakdown.orange += quantity;
          break;
        case "sugar-red-1kg":
          sugarBreakdown.red += quantity;
          break;
        default:
          break;
      }
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

    const totalSugarKg =
      sugarBreakdown.white +
      sugarBreakdown.blue +
      sugarBreakdown.orange +
      sugarBreakdown.red;

    if (!totalSugarKg) {
      return new Response(
        JSON.stringify({ error: "No valid items in cart." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (totalSugarKg > maxSugarKgPerCheckout) {
      return new Response(
        JSON.stringify({ error: `Sugar quantity exceeds max checkout limit (${maxSugarKgPerCheckout} KG).` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: sugarPriceId, quantity: totalSugarKg }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      metadata: {
        order_type: "sugar",
        sugar_total_kg: String(totalSugarKg),
        sugar_white_kg: String(sugarBreakdown.white),
        sugar_blue_kg: String(sugarBreakdown.blue),
        sugar_orange_kg: String(sugarBreakdown.orange),
        sugar_red_kg: String(sugarBreakdown.red),
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
