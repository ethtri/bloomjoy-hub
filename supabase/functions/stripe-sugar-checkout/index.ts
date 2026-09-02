import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveForwardedSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { normalizeStorefrontCart } from "../_shared/storefront-cart.mjs";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const legacySugarPriceId = Deno.env.get("STRIPE_SUGAR_PRICE_ID");
const memberSugarPriceId = Deno.env.get("STRIPE_SUGAR_MEMBER_PRICE_ID") ||
  legacySugarPriceId;
const nonMemberSugarPriceId = Deno.env.get("STRIPE_SUGAR_NON_MEMBER_PRICE_ID");
const microCheckoutEnabled = Deno.env.get("MICRO_CHECKOUT_ENABLED") === "true";
const miniCheckoutEnabled = Deno.env.get("MINI_CHECKOUT_ENABLED") === "true";
const miniMachinePriceId = Deno.env.get("STRIPE_MINI_PRICE_ID");
const miniMachineShippingRateId = Deno.env.get("STRIPE_MINI_SHIPPING_RATE_ID");
const microMachinePriceId = Deno.env.get("STRIPE_MICRO_PRICE_ID");
const microMachineShippingRateId = Deno.env.get(
  "STRIPE_MICRO_SHIPPING_RATE_ID",
);
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type SugarPricingTier = "member" | "standard";

type NormalizedStorefrontCart =
  | {
    ok: false;
    error: string;
    invalidSkus?: string[];
  }
  | {
    ok: true;
    orderType: "sugar" | "micro_machine" | "mini_machine" | "mixed";
    sugarBreakdown: {
      white: number;
      blue: number;
      orange: number;
      red: number;
    };
    totalSugarKg: number;
    microMachineQuantity: number;
    miniMachineQuantity: number;
  };

type ResolvedCheckoutUser = {
  id: string;
  email: string | null;
  pricingTier: SugarPricingTier;
};

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!memberSugarPriceId) {
  console.error(
    "Missing STRIPE_SUGAR_MEMBER_PRICE_ID or STRIPE_SUGAR_PRICE_ID",
  );
}

if (!nonMemberSugarPriceId) {
  console.error("Missing STRIPE_SUGAR_NON_MEMBER_PRICE_ID");
}

if (microCheckoutEnabled && !microMachinePriceId) {
  console.error("Missing STRIPE_MICRO_PRICE_ID");
}

if (microCheckoutEnabled && !microMachineShippingRateId) {
  console.error("Missing STRIPE_MICRO_SHIPPING_RATE_ID");
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
  req: Request,
): Promise<
  { error: string | null; status: number; user: ResolvedCheckoutUser | null }
> => {
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

  const { data: authData, error: authError } = await authClient.auth.getUser(
    token,
  );
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
    { p_user_id: authData.user.id },
  );

  if (discountError) {
    console.error("Failed to resolve supply discount tier");
    return {
      error: "Unable to verify Bloomjoy member pricing right now.",
      status: 500,
      user: null,
    };
  }

  const pricingTier: SugarPricingTier = discountTier === "member"
    ? "member"
    : "standard";

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
        },
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
        },
      );
    }

    if (!cancelUrlResult.ok) {
      return new Response(
        JSON.stringify({ error: cancelUrlResult.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const successUrl = successUrlResult.url;
    const cancelUrl = cancelUrlResult.url;

    if (!stripe) {
      return new Response(
        JSON.stringify({ error: "Stripe checkout is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const cart = normalizeStorefrontCart(items) as NormalizedStorefrontCart;
    if (!cart.ok) {
      return new Response(
        JSON.stringify({
          error: cart.error,
          ...(cart.invalidSkus ? { invalidSkus: cart.invalidSkus } : {}),
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const pricingTier = authResult.user?.pricingTier ?? "standard";
    const orderPricingTier = pricingTier === "member"
      ? "plus_member"
      : "standard";
    const unitPriceCents = getUnitPriceCents(pricingTier);
    const sugarPriceId = getStripePriceId(pricingTier);

    if (cart.totalSugarKg > 0 && !sugarPriceId) {
      return new Response(
        JSON.stringify({ error: "Sugar pricing is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (cart.microMachineQuantity > 0 && !microCheckoutEnabled) {
      return new Response(
        JSON.stringify({
          error: "Micro Machine checkout is not available yet.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (
      cart.microMachineQuantity > 0 &&
      (!microMachinePriceId || !microMachineShippingRateId)
    ) {
      return new Response(
        JSON.stringify({
          error: "Micro Machine price and shipping are not configured.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (cart.miniMachineQuantity > 0 && !miniCheckoutEnabled) {
      return new Response(JSON.stringify({ error: "Mini Machine checkout is not available yet." }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (cart.miniMachineQuantity > 0 && (!miniMachinePriceId || !miniMachineShippingRateId)) {
      return new Response(JSON.stringify({ error: "Mini Machine price and shipping are not configured." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    if (cart.totalSugarKg > 0 && sugarPriceId) {
      lineItems.push({ price: sugarPriceId, quantity: cart.totalSugarKg });
    }
    if (cart.microMachineQuantity > 0 && microMachinePriceId) {
      lineItems.push({
        price: microMachinePriceId,
        quantity: cart.microMachineQuantity,
      });
    }
    if (cart.miniMachineQuantity > 0 && miniMachinePriceId) {
      // Catch an archived/misconfigured Price before charging a different amount
      // from the public $4,000 offer. Shipping must be an explicit reusable rate.
      const price = await stripe.prices.retrieve(miniMachinePriceId, { expand: ["product"] });
      const shipping = await stripe.shippingRates.retrieve(miniMachineShippingRateId!);
      const product = price.product as Stripe.Product;
      if (!price.active || price.type !== "one_time" || price.currency !== "usd" ||
        price.unit_amount !== 400000 || price.tax_behavior !== "exclusive" ||
        !product.active || !product.tax_code || !shipping.active ||
        shipping.type !== "fixed_amount" || shipping.fixed_amount?.currency !== "usd" ||
        !shipping.delivery_estimate?.minimum || !shipping.delivery_estimate?.maximum) {
        return new Response(JSON.stringify({ error: "Mini Machine checkout configuration needs attention." }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      lineItems.push({ price: miniMachinePriceId, quantity: cart.miniMachineQuantity });
    }

    const machineShippingRateId = cart.miniMachineQuantity > 0
      ? miniMachineShippingRateId
      : cart.microMachineQuantity > 0 ? microMachineShippingRateId : null;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      ...(machineShippingRateId
        ? { shipping_options: [{ shipping_rate: machineShippingRateId }] }
        : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
      shipping_address_collection: {
        allowed_countries: ["US"],
      },
      phone_number_collection: { enabled: true },
      customer_email: authResult.user?.email ?? undefined,
      client_reference_id: authResult.user?.id ?? undefined,
      metadata: {
        checkout_source: "bloomjoy_storefront",
        order_type: cart.orderType,
        pricing_tier: orderPricingTier,
        ...(cart.totalSugarKg > 0
          ? { unit_price_cents: String(unitPriceCents) }
          : {}),
        shipping_total_cents: "0",
        sugar_total_kg: String(cart.totalSugarKg),
        sugar_white_kg: String(cart.sugarBreakdown.white),
        sugar_blue_kg: String(cart.sugarBreakdown.blue),
        sugar_orange_kg: String(cart.sugarBreakdown.orange),
        sugar_red_kg: String(cart.sugarBreakdown.red),
        micro_machine_quantity: String(cart.microMachineQuantity),
        mini_machine_quantity: String(cart.miniMachineQuantity),
        ...(authResult.user?.id ? { user_id: authResult.user.id } : {}),
        supply_discount_tier: pricingTier,
      },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    console.error("stripe-sugar-checkout failed");
    return new Response(
      JSON.stringify({ error: "Unable to start checkout." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
