import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import {
  blockingPlusSubscriptionStatuses,
  resolveStripePlusBillingState,
} from "../_shared/plus-billing.mjs";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const plusPriceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");
const portalConfigurationId = Deno.env.get(
  "STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID",
);
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!plusPriceId) {
  console.error("Missing STRIPE_PLUS_PRICE_ID");
}

if (!portalConfigurationId?.startsWith("bpc_")) {
  console.error("Missing or invalid STRIPE_CUSTOMER_PORTAL_CONFIGURATION_ID");
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

    if (
      !stripe ||
      !plusPriceId ||
      !portalConfigurationId?.startsWith("bpc_")
    ) {
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
        .select("stripe_customer_id,stripe_subscription_id,status,updated_at")
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

    const billingState = await resolveStripePlusBillingState({
      stripe,
      subscriptionRecords,
      userId: authResult.user.id,
      email,
      plusPriceId,
    });

    if (billingState.ambiguous) {
      return new Response(
        JSON.stringify({
          error:
            "We found multiple Plus billing records and cannot safely choose one. Contact Bloomjoy support.",
          errorCode: "PLUS_BILLING_ACCOUNT_AMBIGUOUS",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const customerId = billingState.customerId;

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

    const authoritativeCustomerState = billingState.customerStates.find(
      (state) => state.customerId === customerId,
    );
    const blockingSubscriptions =
      authoritativeCustomerState?.subscriptions.filter((
        subscription: Stripe.Subscription,
      ) => blockingPlusSubscriptionStatuses.has(subscription?.status)) ?? [];

    if (
      blockingSubscriptions.length > 0 &&
      blockingSubscriptions.every((subscription: Stripe.Subscription) =>
        subscription?.status === "incomplete"
      )
    ) {
      return new Response(
        JSON.stringify({
          error: "Finish your existing Plus checkout before opening Billing.",
          errorCode: "PLUS_CHECKOUT_INCOMPLETE",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!billingState.hasBlockingSubscription) {
      return new Response(
        JSON.stringify({
          error:
            "Your previous Plus subscription has ended. Start a new Plus checkout to continue.",
          errorCode: "PLUS_SUBSCRIPTION_ENDED",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      configuration: portalConfigurationId,
      return_url: returnUrl,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch {
    console.error("stripe-customer-portal failed");
    return new Response(
      JSON.stringify({ error: "Unable to open customer portal." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
