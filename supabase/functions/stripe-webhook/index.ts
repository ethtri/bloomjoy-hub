import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.18.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.48.1";
import { corsHeaders } from "../_shared/cors.ts";

export const config = {
  verify_jwt: false,
};

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!stripeSecretKey) {
  console.error("Missing STRIPE_SECRET_KEY");
}

if (!webhookSecret) {
  console.error("Missing STRIPE_WEBHOOK_SECRET");
}

if (!supabaseUrl) {
  console.error("Missing SUPABASE_URL");
}

if (!supabaseServiceRoleKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
}

const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, {
      apiVersion: "2024-04-10",
    })
  : null;

const supabase = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
    })
  : null;

async function resolveUserId(userId: string | undefined) {
  if (!supabase || !userId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    return null;
  }
  return data.user.id;
}

async function resolveUserIdByEmail(email: string | null | undefined) {
  if (!supabase || !email) return null;
  const { data, error } = await supabase
    .schema("auth")
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (error || !data?.id) {
    return null;
  }

  return data.id;
}

async function upsertSubscription(subscription: Stripe.Subscription) {
  if (!supabase) return;

  const metadataUserId = subscription.metadata?.user_id;
  const customer =
    typeof subscription.customer === "string"
      ? await stripe?.customers.retrieve(subscription.customer)
      : subscription.customer;
  const customerEmail =
    typeof customer === "object" && customer && "email" in customer
      ? customer.email
      : null;

  const resolvedUserId =
    (await resolveUserId(metadataUserId)) ?? (await resolveUserIdByEmail(customerEmail));

  if (!resolvedUserId) {
    console.warn("No matching user for subscription", subscription.id);
    return;
  }

  const currentPeriodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const payload = {
    user_id: resolvedUserId,
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    status: subscription.status,
    current_period_end: currentPeriodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };

  const { error } = await supabase
    .from("subscriptions")
    .upsert(payload, { onConflict: "stripe_subscription_id" });

  if (error) {
    console.error("Failed to upsert subscription", error);
  }
}

async function upsertOrder(session: Stripe.Checkout.Session) {
  if (!stripe || !supabase) return;

  const expanded = await stripe.checkout.sessions.retrieve(session.id, {
    expand: ["line_items"],
  });

  const lineItems = expanded.line_items?.data?.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    amount_total: item.amount_total,
    currency: item.currency,
    price_id: typeof item.price === "object" && item.price ? item.price.id : null,
  })) ?? [];

  const resolvedUserId = await resolveUserIdByEmail(
    session.customer_details?.email ?? session.customer_email ?? null
  );

  const payload = {
    user_id: resolvedUserId,
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: session.payment_intent
      ? String(session.payment_intent)
      : null,
    stripe_customer_id: session.customer ? String(session.customer) : null,
    status: session.payment_status || "unpaid",
    amount_total: session.amount_total,
    currency: session.currency,
    customer_email: session.customer_details?.email ?? session.customer_email ?? null,
    receipt_url: null,
    line_items: lineItems,
  };

  const { error } = await supabase
    .from("orders")
    .upsert(payload, { onConflict: "stripe_checkout_session_id" });

  if (error) {
    console.error("Failed to upsert order", error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!stripe || !webhookSecret || !supabase) {
    return new Response(
      JSON.stringify({ error: "Webhook is not configured." }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response(JSON.stringify({ error: "Missing signature." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const payload = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
  } catch (error) {
    console.error("Invalid webhook signature", error);
    return new Response(JSON.stringify({ error: "Invalid signature." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === "payment") {
          await upsertOrder(session);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertSubscription(subscription);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    console.error("Webhook handler error", error);
    return new Response(JSON.stringify({ error: "Webhook handler error." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
