import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import {
  resolveForwardedSupabaseAccessToken,
} from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const legacySugarPriceId = Deno.env.get("STRIPE_SUGAR_PRICE_ID");
const memberSugarPriceId =
  Deno.env.get("STRIPE_SUGAR_MEMBER_PRICE_ID") || legacySugarPriceId;
const nonMemberSugarPriceId = Deno.env.get("STRIPE_SUGAR_NON_MEMBER_PRICE_ID");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const maxSugarKgPerCheckout = 200000;
const allowedSugarSkus = new Set([
  "sugar-1kg",
  "sugar-white-1kg",
  "sugar-blue-1kg",
  "sugar-orange-1kg",
  "sugar-red-1kg",
]);

type SugarPricingTier = "member" | "standard";

type ResolvedCheckoutUser = {
  id: string;
  email: string | null;
  pricingTier: SugarPricingTier;
};

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!memberSugarPriceId) {
  console.error("Missing STRIPE_SUGAR_MEMBER_PRICE_ID or STRIPE_SUGAR_PRICE_ID");
}

if (!nonMemberSugarPriceId) {
  console.error("Missing STRIPE_SUGAR_NON_MEMBER_PRICE_ID");
}

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseAnonKey) {
  console.error("Missing SUPABASE_ANON_KEY");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-04-10",
    })
  : null;

const getUnitPriceCents = (pricingTier: SugarPricingTier): number =>
  pricingTier === "member" ? 800 : 1000;

const getStripePriceId = (pricingTier: SugarPricingTier): string | null =>
  pricingTier === "member"
    ? memberSugarPriceId ?? null
    : nonMemberSugarPriceId ?? null;

const resolveOptionalCheckoutUser = async (
  req: Request
): Promise<{ error: string | null; status: number; user: ResolvedCheckoutUser | null }> => {
  const token = resolveForwardedSupabaseAccessToken(req);
  if (!token) {
    return {
      error: null,
      status: 200,
      user: null,
    };
  }

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    return {
      error: "Membership verification is not configured.",
      status: 500,
      user: null,
    };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) {
    return {
      error: "Authentication required.",
      status: 401,
      user: null,
    };
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data: discountTier, error: discountError } = await adminClient.rpc(
    "get_user_supply_discount_tier",
    { p_user_id: authData.user.id }
  );

  if (discountError) {
    console.error("Failed to resolve supply discount tier", discountError);
    return {
      error: "Unable to verify Bloomjoy member pricing right now.",
      status: 500,
      user: null,
    };
  }

  const pricingTier: SugarPricingTier = discountTier === "member" ? "member" : "standard";

  return {
    error: null,
    status: 200,
    user: {
      id: authData.user.id,
      email: authData.user.email ?? null,
      pricingTier,
    },
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authResult = await resolveOptionalCheckoutUser(req);
    if (!authResult.user && authResult.error) {
      return new Response(
        JSON.stringify({ error: authResult.error }),
        {
          status: authResult.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const items = Array.isArray(body?.items) ? body.items : [];
    const successUrlResult = validateBrowserUrl(body?.successUrl, {
      label: "success URL",
    });
    const cancelUrlResult = validateBrowserUrl(body?.cancelUrl, {
      label: "cancel URL",
    });

    if (!successUrlResult.ok) {
      return new Response(
        JSON.stringify({ error: successUrlResult.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!cancelUrlResult.ok) {
      return new Response(
        JSON.stringify({ error: cancelUrlResult.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const successUrl = successUrlResult.url;
    const cancelUrl = cancelUrlResult.url;

    if (!stripe || !memberSugarPriceId || !nonMemberSugarPriceId) {
      return new Response(
        JSON.stringify({ error: "Stripe sugar pricing is not configured." }),
        {
          status: 500,
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
        JSON.stringify({
          error: `Sugar quantity exceeds max checkout limit (${maxSugarKgPerCheckout} KG).`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const pricingTier = authResult.user?.pricingTier ?? "standard";
    const unitPriceCents = getUnitPriceCents(pricingTier);
    const sugarPriceId = getStripePriceId(pricingTier);

    if (!sugarPriceId) {
      return new Response(
        JSON.stringify({ error: "Sugar pricing is not configured." }),
        {
          status: 500,
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
      customer_email: authResult.user?.email ?? undefined,
      client_reference_id: authResult.user?.id ?? undefined,
      metadata: {
        order_type: "sugar",
        pricing_tier: pricingTier,
        unit_price_cents: String(unitPriceCents),
        shipping_total_cents: "0",
        sugar_total_kg: String(totalSugarKg),
        sugar_white_kg: String(sugarBreakdown.white),
        sugar_blue_kg: String(sugarBreakdown.blue),
        sugar_orange_kg: String(sugarBreakdown.orange),
        sugar_red_kg: String(sugarBreakdown.red),
        ...(authResult.user?.id ? { user_id: authResult.user.id } : {}),
        ...(authResult.user?.pricingTier
          ? { supply_discount_tier: authResult.user.pricingTier }
          : {}),
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
