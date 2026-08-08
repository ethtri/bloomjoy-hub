import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { resolveSupabaseAccessToken } from "../_shared/auth.ts";
import { validateBrowserUrl } from "../_shared/browser-url-allowlist.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import {
  blockingPlusSubscriptionStatuses,
  findReusableOpenPlusCheckoutSession,
  resolveReusablePlusCheckoutSession,
  resolveStripePlusBillingState,
} from "../_shared/plus-billing.mjs";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const plusPriceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!plusPriceId) {
  console.error("Missing STRIPE_PLUS_PRICE_ID");
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

    if (!stripe || !plusPriceId) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured." }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

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

    const { data: subscriptionRecords, error: subscriptionError } =
      await authResult.supabaseClient
        .from("subscriptions")
        .select("stripe_customer_id,stripe_subscription_id,status,updated_at")
        .eq("user_id", authResult.user.id)
        .order("updated_at", { ascending: false });

    if (subscriptionError) {
      console.error("Unable to resolve existing Plus billing state");
      return new Response(
        JSON.stringify({
          error: "Unable to verify your Plus billing status right now.",
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

    const reusableCheckoutState = billingState.hasBlockingSubscription
      ? { ambiguous: false, customerId: null, session: null }
      : await resolveReusablePlusCheckoutSession({
        stripe,
        customerStates: billingState.customerStates,
        userId: authResult.user.id,
      });

    if (reusableCheckoutState.ambiguous) {
      return new Response(
        JSON.stringify({
          error:
            "We found multiple open Plus checkouts and cannot safely choose one. Contact Bloomjoy support before continuing.",
          errorCode: "PLUS_BILLING_ACCOUNT_AMBIGUOUS",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (reusableCheckoutState.session?.url) {
      return new Response(
        JSON.stringify({
          url: reusableCheckoutState.session.url,
          reused: true,
          recovery: "open_checkout",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (billingState.ambiguous) {
      return new Response(
        JSON.stringify({
          error:
            "We found multiple Plus billing records and cannot safely choose one. Contact Bloomjoy support before continuing.",
          errorCode: "PLUS_BILLING_ACCOUNT_AMBIGUOUS",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    let customerId = billingState.customerId;
    const authoritativeCustomerState = billingState.customerStates.find(
      (state) => state.customerId === customerId,
    );
    const blockingSubscriptions =
      authoritativeCustomerState?.subscriptions.filter((
        subscription: Stripe.Subscription,
      ) => blockingPlusSubscriptionStatuses.has(subscription?.status)) ?? [];
    const canResumeIncompleteCheckout = blockingSubscriptions.length > 0 &&
      blockingSubscriptions.every((subscription: Stripe.Subscription) =>
        subscription?.status === "incomplete"
      );

    if (billingState.hasBlockingSubscription && customerId) {
      if (canResumeIncompleteCheckout) {
        const incompleteSessions = await stripe.checkout.sessions.list({
          customer: customerId,
          status: "open",
          limit: 100,
        });
        if (incompleteSessions.has_more) {
          throw new Error(
            "Too many open Plus Checkout Sessions to resolve safely.",
          );
        }
        const incompleteSession = findReusableOpenPlusCheckoutSession(
          incompleteSessions.data,
          authResult.user.id,
        );

        if (incompleteSession?.url) {
          return new Response(
            JSON.stringify({
              url: incompleteSession.url,
              reused: true,
              recovery: "incomplete_checkout",
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }

        return new Response(
          JSON.stringify({
            error:
              "Your earlier Plus checkout is still being finalized. Try again shortly or contact Bloomjoy support.",
            errorCode: "PLUS_CHECKOUT_INCOMPLETE",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      return new Response(
        JSON.stringify({
          error:
            "Your Plus subscription already exists. Open Billing to renew it or fix payment details.",
          errorCode: "PLUS_SUBSCRIPTION_EXISTS",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!customerId) {
      const createdCustomer = await stripe.customers.create(
        {
          email,
          metadata: { bloomjoy_user_id: authResult.user.id },
        },
        { idempotencyKey: `bloomjoy-plus-customer:${authResult.user.id}` },
      );
      customerId = createdCustomer.id;
    } else {
      await stripe.customers.update(customerId, {
        email,
        metadata: { bloomjoy_user_id: authResult.user.id },
      });
    }

    const { data: checkoutAttempt, error: checkoutAttemptError } =
      await authResult.supabaseClient.rpc("claim_my_plus_checkout_attempt");
    if (checkoutAttemptError) {
      console.error("Unable to claim Plus checkout attempt");
      return new Response(
        JSON.stringify({
          error: "Unable to safely start Plus checkout right now.",
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (
      checkoutAttempt?.status === "ready" &&
      typeof checkoutAttempt.checkoutUrl === "string"
    ) {
      return new Response(
        JSON.stringify({ url: checkoutAttempt.checkoutUrl, reused: true }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (
      checkoutAttempt?.owner !== true ||
      typeof checkoutAttempt.attemptToken !== "string"
    ) {
      return new Response(
        JSON.stringify({
          error:
            "Your Plus checkout is already starting in another tab. Try again in a moment.",
          errorCode: "PLUS_CHECKOUT_IN_PROGRESS",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const attemptToken = checkoutAttempt.attemptToken;
    try {
      const completeCheckoutAttempt = async (
        session: Stripe.Checkout.Session,
      ) => {
        if (!session?.id || !session?.url || !session?.expires_at) {
          throw new Error("Stripe Checkout Session is incomplete.");
        }

        const { data: completed, error: completionError } = await authResult
          .supabaseClient.rpc(
            "complete_my_plus_checkout_attempt",
            {
              p_attempt_token: attemptToken,
              p_stripe_checkout_session_id: session.id,
              p_checkout_url: session.url,
              p_expires_at: new Date(session.expires_at * 1000).toISOString(),
            },
          );

        if (completionError || completed !== true) {
          throw new Error("Unable to persist Plus checkout attempt.");
        }
      };

      const openSessions = await stripe.checkout.sessions.list({
        customer: customerId,
        status: "open",
        limit: 100,
      });
      if (openSessions.has_more) {
        throw new Error(
          "Too many open Plus Checkout Sessions to resolve safely.",
        );
      }
      const reusableSession = findReusableOpenPlusCheckoutSession(
        openSessions.data,
        authResult.user.id,
      );

      if (reusableSession?.url) {
        await completeCheckoutAttempt(reusableSession);
        return new Response(
          JSON.stringify({ url: reusableSession.url, reused: true }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      const session = await stripe.checkout.sessions.create(
        {
          mode: "subscription",
          payment_method_types: ["card"],
          line_items: [{ price: plusPriceId, quantity: 1 }],
          automatic_tax: { enabled: true },
          success_url: successUrl,
          cancel_url: cancelUrl,
          billing_address_collection: "required",
          customer: customerId,
          customer_update: {
            address: "auto",
            name: "auto",
          },
          client_reference_id: authResult.user.id,
          allow_promotion_codes: true,
          metadata: {
            checkout_source: "bloomjoy_storefront",
            order_type: "plus_subscription",
            billing_model: "flat_monthly",
            user_id: authResult.user.id,
          },
          subscription_data: {
            metadata: {
              checkout_source: "bloomjoy_storefront",
              order_type: "plus_subscription",
              billing_model: "flat_monthly",
              user_id: authResult.user.id,
            },
          },
        },
        {
          idempotencyKey:
            `bloomjoy-plus-checkout:${authResult.user.id}:${attemptToken}`,
        },
      );

      await completeCheckoutAttempt(session);
      return new Response(JSON.stringify({ url: session.url }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      const { error: releaseError } = await authResult.supabaseClient.rpc(
        "release_my_plus_checkout_attempt",
        { p_attempt_token: attemptToken },
      );
      if (releaseError) {
        console.error("Unable to release failed Plus checkout attempt");
      }
      throw error;
    }
  } catch {
    console.error("stripe-plus-checkout failed");
    return new Response(
      JSON.stringify({ error: "Unable to start checkout." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
