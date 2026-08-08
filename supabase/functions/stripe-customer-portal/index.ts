import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import { selectStoredStripeCustomerId } from "../_shared/plus-billing.mjs";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseAnonKey) {
  console.error("Missing SUPABASE_ANON_KEY");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
    apiVersion: "2024-04-10",
  })
  : null;

const resolveAuthenticatedUser = async (req: Request) => {
  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      error: "Auth is not configured.",
      status: 500,
      supabaseClient: null,
      user: null,
    };
  }

  const token = resolveSupabaseAccessToken(req);
  if (!token) {
    return {
      error: "Authentication required.",
      status: 401,
      supabaseClient: null,
      user: null,
    };
  }

  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      error: "Authentication required.",
      status: 401,
      supabaseClient: null,
      user: null,
    };
  }

  return {
    error: null,
    status: 200,
    supabaseClient,
    user: data.user,
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authResult = await resolveAuthenticatedUser(req);
    if (!authResult.user || !authResult.supabaseClient) {
      return new Response(
        JSON.stringify({ error: authResult.error }),
        {
          status: authResult.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const body = await req.json();
    const returnUrlResult = validateBrowserUrl(body?.returnUrl, {
      label: "return URL",
    });
    const email = authResult.user.email?.trim().toLowerCase() ?? null;

    if (!email) {
      return new Response(
        JSON.stringify({ error: "Missing account email address." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!returnUrlResult.ok) {
      return new Response(
        JSON.stringify({ error: returnUrlResult.error }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const returnUrl = returnUrlResult.url;

    if (!stripe) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const { data: subscriptionRecords, error: subscriptionError } =
      await authResult.supabaseClient
        .from("subscriptions")
        .select("stripe_customer_id,updated_at")
        .eq("user_id", authResult.user.id)
        .order("updated_at", { ascending: false });

    if (subscriptionError) {
      console.error("Unable to resolve Plus billing account");
      return new Response(
        JSON.stringify({
          error: "Unable to verify your billing account right now.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let customerId = selectStoredStripeCustomerId(subscriptionRecords);

    if (!customerId) {
      const metadataCustomers = await stripe.customers.search({
        query: `metadata['bloomjoy_user_id']:'${authResult.user.id}'`,
        limit: 10,
      });
      customerId = metadataCustomers.data[0]?.id ?? null;
    }

    if (!customerId) {
      return new Response(
        JSON.stringify({
          error:
            "No Plus billing account was found. Start a Plus membership first.",
          errorCode: "PLUS_BILLING_ACCOUNT_NOT_FOUND",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) {
      return new Response(
        JSON.stringify({
          error: "Your Plus billing account is unavailable. Contact support.",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("stripe-customer-portal error", error);
    return new Response(
      JSON.stringify({ error: "Unable to open customer portal." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
