import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveForwardedSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const sticksPriceId = Deno.env.get("STRIPE_STICKS_PRICE_ID");
const memberSticksPriceId = Deno.env.get("STRIPE_STICKS_MEMBER_PRICE_ID");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const allowedStickSizes = new Set(["commercial_10x300", "mini_10x220"]);
const allowedAddressTypes = new Set(["business", "residential"]);
const freeShippingBoxThreshold = 5;
const piecesPerBox = 2000;

type StickPricingTier = "member" | "standard";

type ResolvedCheckoutUser = {
  id: string;
  email: string | null;
  pricingTier: StickPricingTier;
};

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!sticksPriceId) {
  console.error("Missing STRIPE_STICKS_PRICE_ID");
}

if (!memberSticksPriceId) {
  console.error("Missing STRIPE_STICKS_MEMBER_PRICE_ID");
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

const getShippingRatePerBox = (addressType: "business" | "residential") =>
  addressType === "business" ? 35 : 40;

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
      error: "Member pricing verification is not configured.",
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
    console.error("Failed to resolve sticks discount tier", discountError);
    return {
      error: "Unable to verify Bloomjoy member pricing right now.",
      status: 500,
      user: null,
    };
  }

  return {
    error: null,
    status: 200,
    user: {
      id: authData.user.id,
      email: authData.user.email ?? null,
      pricingTier: discountTier === "member" ? "member" : "standard",
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
    const successUrlResult = validateBrowserUrl(body?.successUrl, {
      label: "success URL",
    });
    const cancelUrlResult = validateBrowserUrl(body?.cancelUrl, {
      label: "cancel URL",
    });
    const boxCount = Number(body?.boxCount ?? 0);
    const stickSize = String(body?.stickSize ?? "");
    const addressType = String(body?.addressType ?? "");
    const variant = body?.variant ? String(body.variant) : "plain";

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

    const pricingTier = authResult.user?.pricingTier ?? "standard";
    const orderPricingTier = pricingTier === "member" ? "plus_member" : "standard";
    const selectedSticksPriceId = pricingTier === "member"
      ? memberSticksPriceId
      : sticksPriceId;

    if (!stripe || !selectedSticksPriceId) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (variant !== "plain") {
      return new Response(
        JSON.stringify({ error: "Custom sticks must be handled through procurement review." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!Number.isSafeInteger(boxCount) || boxCount <= 0) {
      return new Response(
        JSON.stringify({ error: "Invalid box count." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!allowedStickSizes.has(stickSize)) {
      return new Response(
        JSON.stringify({ error: "Invalid stick size." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!allowedAddressTypes.has(addressType)) {
      return new Response(
        JSON.stringify({ error: "Invalid address type." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const normalizedAddressType = addressType as "business" | "residential";
    const isFreeShipping = boxCount >= freeShippingBoxThreshold;
    const shippingRatePerBoxUsd = isFreeShipping
      ? 0
      : getShippingRatePerBox(normalizedAddressType);
    const shippingTotalCents = shippingRatePerBoxUsd * boxCount * 100;
    const shippingDisplayName = isFreeShipping
      ? "Free shipping (5+ boxes)"
      : normalizedAddressType === "business"
        ? "Business shipping ($35/box)"
        : "Residential shipping ($40/box)";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: selectedSticksPriceId, quantity: boxCount }],
      shipping_options: [
        {
          shipping_rate_data: {
            display_name: shippingDisplayName,
            type: "fixed_amount",
            fixed_amount: {
              amount: shippingTotalCents,
              currency: "usd",
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      customer_email: authResult.user?.email ?? undefined,
      client_reference_id: authResult.user?.id ?? undefined,
      metadata: {
        order_type: "blank_sticks",
        pricing_tier: orderPricingTier,
        supply_discount_tier: pricingTier,
        sticks_type: "bloomjoy_branded",
        stick_size: stickSize,
        sticks_box_count: String(boxCount),
        sticks_pieces_per_box: String(piecesPerBox),
        sticks_address_type: normalizedAddressType,
        sticks_shipping_rate_per_box_usd: String(shippingRatePerBoxUsd),
        sticks_shipping_total_cents: String(shippingTotalCents),
        sticks_free_shipping: String(isFreeShipping),
        ...(authResult.user?.id ? { user_id: authResult.user.id } : {}),
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("stripe-sticks-checkout error", error);
    return new Response(
      JSON.stringify({ error: "Unable to start checkout." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
