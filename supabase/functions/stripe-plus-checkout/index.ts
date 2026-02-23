import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const plusPriceId = Deno.env.get("STRIPE_PLUS_PRICE_ID");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
const MIN_MACHINE_COUNT = 1;
const MAX_MACHINE_COUNT = 25;

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
      user: null,
    };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return {
      error: "Authentication required.",
      status: 401,
      user: null,
    };
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return {
      error: "Authentication required.",
      status: 401,
      user: null,
    };
  }

  const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await supabaseClient.auth.getUser(token);
  if (error || !data.user) {
    return {
      error: "Authentication required.",
      status: 401,
      user: null,
    };
  }

  return {
    error: null,
    status: 200,
    user: data.user,
  };
};

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

    const authResult = await resolveAuthenticatedUser(req);
    if (!authResult.user) {
      return new Response(
        JSON.stringify({ error: authResult.error }),
        {
          status: authResult.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();
    const successUrl = body?.successUrl;
    const cancelUrl = body?.cancelUrl;
    const machineCount = Number(body?.machineCount);

    if (!successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing success or cancel URL." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (
      !Number.isInteger(machineCount) ||
      machineCount < MIN_MACHINE_COUNT ||
      machineCount > MAX_MACHINE_COUNT
    ) {
      return new Response(
        JSON.stringify({ error: `Machine count must be between ${MIN_MACHINE_COUNT} and ${MAX_MACHINE_COUNT}.` }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: plusPriceId, quantity: machineCount }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: authResult.user.email ?? undefined,
      client_reference_id: authResult.user.id,
      allow_promotion_codes: true,
      metadata: {
        machine_count: String(machineCount),
        user_id: authResult.user.id,
      },
      subscription_data: {
        metadata: {
          machine_count: String(machineCount),
          user_id: authResult.user.id,
        },
      },
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
